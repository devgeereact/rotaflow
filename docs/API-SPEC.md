# API specification

RotaFlow has no public API (a Phase 2 item in `docs/SAAS.md` §9). This file owns
the contracts the product's own client depends on: the eight Supabase Edge
Functions and the client-callable Postgres RPCs whose behaviour a caller has to
know. Tables, RLS policies and triggers are in `docs/DATA-MODEL.md`; the
notification functions are in `docs/NOTIFICATIONS-SPEC.md`.

Created on 11 October 2026. The Edge Function table below was read from
`supabase/functions/*/index.ts` on that date; the billing and inventory text was
moved from `docs/ARCHITECTURE.md` (§9c and §10), and the RPC text from
`docs/DATA-MODEL.md` §6.

## Edge Functions

`supabase/functions/**` is the only server compute in the product. It is Deno, and
it is excluded from `npm run typecheck` and `npm run lint` (`eslint.config.js`).
CI's `edge-types` job typechecks all eight entry points with a pinned Deno 2.9.5
and the committed `deno.lock`, which proves they compile and nothing more:
**reading these files is still the only check on what they do**.

**They do not deploy on merge.** Migrations do, through the Supabase GitHub
integration, with a lag. Functions are a separate manual
`supabase functions deploy <name>`. A merged function that nobody deployed is the
most common way this repository's documentation goes stale, so the deployed
version of each is recorded in `docs/SAAS.md` §2 with the date it was read.

Every JSON function answers `OPTIONS` for CORS and returns `{ error: string }` with
a 4xx or 5xx status on failure. `orgId` is always checked against the caller's
membership, never trusted.

| Function                  | JWT verified | Caller and auth model                                                                                                                                                                                   | Input                                                                                                                                 | Output on success                                                                                                                                                                                               |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-rota-assistant`       | yes          | Owner or manager (`has_org_role`), plan entitlement `ai_rota_assistant` (`org_has_feature`, 403 `plan_required`), per-user and per-org rate limits. Caller's JWT; `service_role` only for `audit_write` | `{ orgId, prompt, periodStart, periodEnd, task? }`, dates `YYYY-MM-DD`, `task` is `rota` (default) or `announcement`                  | `rota`: `{ summary, suggestions[] }`, each suggestion validated against the org's real staff and shift types. `announcement`: `{ title, body, urgent, reasoning, ... }`. 503 when `OPENROUTER_API_KEY` is unset |
| `send-notification`       | yes          | Called only by `dispatch_notification_outbox()`. Presents `x-notification-secret`, compared in the database against `vault` (`verify_notification_secret`, `0091`). `service_role` client               | `{ orgId, userIds[], type, title, body?, channels? }`, `channels` is `push` and/or `email`                                            | `{ ok: true, results, dropped, recorded }`. Recipients not in the org are dropped. 503 when the secret cannot be checked                                                                                        |
| `send-invite`             | yes          | Signed-in user who can read the invite under RLS. Caller's JWT for the invite; `service_role` only for the organisation's mail credentials                                                              | `{ orgId, inviteId, token }`                                                                                                          | `{ sent: true, email }`. 404 unknown invite, 409 revoked, accepted or expired                                                                                                                                   |
| `create-checkout-session` | yes          | Organisation owner, checked against `memberships` with `status = 'active'`. Caller's JWT                                                                                                                | `{ orgId, planCode }`                                                                                                                 | `{ url }`, a hosted Stripe Checkout page for a full-page redirect                                                                                                                                               |
| `create-portal-session`   | yes          | Organisation owner, as above                                                                                                                                                                            | `{ orgId }`                                                                                                                           | `{ url }`, the Stripe Billing Portal. 404 when the organisation has no Stripe customer yet                                                                                                                      |
| `stripe-webhook`          | **no**       | Stripe, verified by the `stripe-signature` header against `STRIPE_WEBHOOK_SECRET`. `service_role` client                                                                                                | Stripe events: `checkout.session.completed`, `customer.subscription.updated` and `.deleted`, `invoice.paid`, `invoice.payment_failed` | `{ received: true }`, or `{ received: true, duplicate: true }` for an event already recorded. 400 on a bad signature                                                                                            |
| `calendar-feed`           | **no**       | A calendar client, which cannot send a header. The `token` query parameter is checked by `calendar_feed_shifts`, granted to `service_role` alone                                                        | `GET ?token=<uuid>`                                                                                                                   | `text/calendar` (iCalendar), `Cache-Control: private, max-age=900`. A bad token or an internal error returns an **empty** calendar with 200, never an error status                                              |
| `test-smtp`               | yes          | Organisation owner (`has_org_role`). Caller's JWT; `service_role` only to read the SMTP password                                                                                                        | `{ orgId }`                                                                                                                           | `{ ok: true, sentTo }`, or `{ ok: false, error }` with 200 when the mail server refused. 404 when no SMTP settings are saved                                                                                    |

The two with `verify_jwt: false` are deliberate and each has its own boundary
above. Neither is a gap: Supabase's gateway check would reject the only callers
those two have.

### The rule about which key they use

A function acting on a user's behalf builds its Supabase client with the
**caller's forwarded JWT**, so RLS scopes every query for free. `service_role`
is for genuinely cross-tenant work (a billing webhook, a scheduled drain, a feed
with no session) and is the exception.

`ai-rota-assistant` is the worked example: the JWT for everything, and
`service_role` for the single `audit_write` call that `authenticated` is
deliberately not allowed to make. Its data flow is `docs/ARCHITECTURE.md` §9b.

### Billing functions

Three Edge Functions, added with migration `0050`, share `supabase/functions/_shared/stripe.ts`:

- **`create-checkout-session`** — org owner picks a plan on Settings > Billing;
  runs as the calling user (JWT forwarded, RLS-scoped, owner-role checked
  against `memberships` directly) and returns a hosted Stripe Checkout URL for
  a full-page redirect. No Stripe.js on the client.
- **`create-portal-session`** — same auth pattern, returns a Stripe Billing
  Portal URL so an owner can manage payment methods / cancel without a
  custom UI.
- **`stripe-webhook`** — the one function in this feature that runs as
  `service_role` (deployed `--no-verify-jwt`), since Stripe calls it directly
  with no end-user session; authenticated instead by Stripe's own request
  signature (`STRIPE_WEBHOOK_SECRET`). Handles
  `checkout.session.completed`, `customer.subscription.updated/deleted`,
  `invoice.paid`, `invoice.payment_failed` — upserts `subscriptions`
  (keyed on `org_id`/`(org_id, provider_ref)` since Stripe delivery is
  at-least-once), writes `invoices` as a second, automated writer alongside
  the manual platform-finance path, and calls `set_org_status()` (via its
  `0051` service-role exception, see "RPC contracts" below) to suspend an org once
  Stripe's dunning is exhausted.

Deploy: `supabase functions deploy <name>` (webhook needs `--no-verify-jwt`).
Secrets: `STRIPE_SECRET_KEY` (shared by all three), `STRIPE_WEBHOOK_SECRET`
(webhook only, from the Stripe dashboard's endpoint config). After deploying
the webhook, register its URL in the Stripe dashboard against the five events
above.

## RPC contracts

Postgres functions the client or an Edge Function calls through `supabase.rpc`.
This list is selective, like `docs/DATA-MODEL.md` §6 was: it names the functions
whose behaviour a caller has to know. The full list of functions is one query,
given in `docs/DATA-MODEL.md` §6. The rota publication RPCs are in
`docs/DATA-MODEL.md` §6a, beside the lifecycle they enforce.

- **`set_org_status(org, status, reason?)`** (`0017`, `security definer`): the only
  write path that can move an `organisations.status` into `suspended`/`archived`.
  Gated to a platform owner/admin's own JWT — **except** `auth.uid() is null`
  (`0051_org_status_service_role.sql`), which lets `supabase/functions/stripe-webhook`
  call it too: that function runs as `service_role` with no end-user session, since
  Stripe calls it directly, so it uses this to suspend an organisation once Stripe's
  dunning (Smart Retries) is exhausted. Every real admin caller has a real
  `auth.uid()`, so the exception never widens what an authenticated user can do.
- **`platform_tenant_counts(org)`** (`0028`, `security definer`): the one function
  that reads _past_ the `0028` gate — returns staff/location/rota/shift counts for
  an org with no open support session required, gated on `is_platform_admin()`
  directly. A number, never a row: sizing a tenant doesn't require knowing who's in it.
- **`consume_org_rate_limit(bucket, org, limit, window)`** (`0089`,
  `security definer`, `authenticated`): a per-ORGANISATION limiter, alongside
  `consume_my_rate_limit`'s per-user one. It is the only client-callable
  limiter that takes its subject as an argument, and it checks `is_org_member`
  before using it — that check is the entire reason naming a subject is safe
  here, since a member can only spend an allowance they could spend anyway by
  making the requests. Buckets are a fixed list (`ai_assistant_org`), because
  an invented bucket name would be an unlimited private allowance.
- **`rate_support_case(case, score, comment?)`** (`0024`, message clarified in
  `0077`): the requester's satisfaction score for a _resolved_ case, 1-5. Three
  refusals, all with their own wording since `0077`: not the requester (`42501`),
  not yet resolved (`22023`), score out of range (`22023` — it used to fall through
  to the column CHECK and read as `support_cases_csat_check`). Re-rating is allowed
  deliberately, so a mis-tap is correctable. Called from `/app/help`; it had no
  caller at all between `0024` and 2026-08-30, which is why `csat` was always null.
- **`platform_staff_counts()`** (`0078`, `security definer`, platform-admin-only):
  active staff per organisation across every tenant, aggregate only. This is the
  population `plans.seat_limit` is enforced on by `enforce_seat_limit()` (`0070`) —
  the console's Usage bar used **memberships** until 2026-08-30, which is a
  different and much smaller number because `staff_profiles.user_id` is nullable
  (BUG-062). Aggregate-only for the reason `platform_location_counts()` gives: since
  `0028` a platform administrator needs a support session to read tenant rows, so a
  direct select would return a confident zero for every organisation without one.
- **`flag_enabled_for_org(key, org)`** (`0022`): hashes `key` + `org_id` so the same
  org always lands on the same side of a percentage rollout. Nothing in `src/` calls
  it directly; the client-facing entry point is **`my_feature_access(org)`** (`0030`),
  read by `useFeatureAccess`.
- **`org_has_feature(org, feature)`** (`0030`): a plan entitlement, not a flag —
  true when `plans.features` lists it. Enforced server-side by
  `supabase/functions/ai-rota-assistant`, which refuses `ai_rota_assistant` with a
  403 and `code: 'plan_required'` before reading any tenant data or contacting
  OpenRouter. The UI gate is a courtesy; this is the control, because the endpoint is
  reachable with any member's JWT and every call spends money.
- Both entitlement functions are guarded by `is_org_member` since **`0074`**. They
  are `security definer`, so RLS does not apply inside them, and before that guard
  any signed-in user could read which plan tier any organisation was on by passing
  its id. The predicate is `is_org_member` **alone**: per `0028` that already covers
  a platform administrator holding an active support-access session, and adding
  `or is_platform_admin()` would re-open the standing cross-tenant access `0028`
  exists to close. A non-member gets `false` and an empty set rather than an error,
  so the refusal does not confirm the organisation exists.
- Every name in `plans.features` is read by something (`0090`, BUG-064).
  `ai_rota_assistant` is enforced in the Edge Function that spends the money
  (`0074`); `advanced_reporting` gates the Reports screen; `gps_clock_in` was
  **removed from every plan**, because every plan included it and a gate that can
  never refuse is not a gate. It now resolves to `false`, deliberately: a name that
  answers "false" fails visibly if somebody wires it up, where one answering "true
  for everyone" would not.
- **`advanced_reporting` is enforced in the client, and that is the honest ceiling.**
  The Reports screen computes every row in the browser from `clock_events` and
  `staff_profiles` — rows RLS already grants the organisation because they are its
  own records. There is no server-side report endpoint to refuse, and withholding a
  customer's own data from them would be a worse product than an unlocked screen. It
  is packaging, not a control, and the difference matters: `seat_limit` and
  `location_limit` govern writes and are enforced by triggers (`0070`), and
  `ai_rota_assistant` spends money per use and is enforced server-side (`0074`).
- **`admin_create_organisation_with_invite(...)`** (`0052`, `security definer`,
  platform-admin-only): atomically inserts an organisation with `created_by = null`
  (so `on_org_created` never fires and no membership row is created), creates its
  subscription at the negotiated price, and issues the owner invite for the real
  contact — for the case where a prospect contacted sales directly instead of
  self-serve signup (`organisations_insert`, `0002`, which requires
  `auth.uid() = created_by`). The platform admin never holds membership, not even
  transiently within the transaction.
- **`create_invite(org, email, role)`** (`0006`; bootstrap exception in `0052`): both
  of its permission gates now also accept a platform owner/admin inviting the very
  first `owner` into a genuinely member-less org — the counterpart the admin-created
  org above needs to actually reach its real owner. Every other caller is unaffected;
  the exception only fires when no membership row exists yet for that org.
- **`accept_invite(token)`** (`0006`; account-linking added `0053`): now also links
  any `staff_profiles` row in the invite's org still waiting on that email — the
  other half of the auto-link trigger above, for whichever order the HR record and
  the invite acceptance happen in.
- **`platform_location_counts()`** (`0054`, `security definer`, platform-admin-only):
  per-org location counts with no open support session required, the same shape as
  `platform_tenant_counts` above — `locations_select` itself stayed gated behind
  `is_org_member()` (`0028`)/`0031`'s carve-out never covered it, so a direct count
  silently read zero for every org without an open session.
