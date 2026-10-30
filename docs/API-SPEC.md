# API specification

RotaFlow has no public API (a Phase 2 item in `docs/SAAS.md` §9). This file owns
the contracts the product's own client depends on: the nine Supabase Edge
Functions and the client-callable Postgres RPCs whose behaviour a caller has to
know. Tables, RLS policies and triggers are in `docs/DATA-MODEL.md`; the
notification functions are in `docs/NOTIFICATIONS-SPEC.md`.

Created on 11 October 2026. The Edge Function table below was read from
`supabase/functions/*/index.ts` on that date; the billing and inventory text was
moved from `docs/ARCHITECTURE.md` (§9c and §10), and the RPC text from
`docs/DATA-MODEL.md` §6.

## Edge Functions

`supabase/functions/**` is the only server compute in the product. It is Deno, and
it is excluded from `pnpm run typecheck` and `pnpm run lint` (`eslint.config.js`).
CI's `edge-types` job typechecks all twelve entry points with a pinned Deno 2.9.5
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

| Function                  | JWT verified | Caller and auth model                                                                                                                                                                                                                                                                                                                                                                                                                          | Input                                                                                                                                                                         | Output on success                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-rota-assistant`       | yes          | Owner or manager (`has_org_role`), plan entitlement `ai_rota_assistant` (`org_has_feature`, 403 `plan_required`), per-user and per-org rate limits. Caller's JWT; `service_role` only for `audit_write`                                                                                                                                                                                                                                        | `{ orgId, prompt, periodStart, periodEnd, task? }`, dates `YYYY-MM-DD`, `task` is `rota` (default) or `announcement`                                                          | `rota`: `{ summary, suggestions[] }`, each suggestion validated against the org's real staff and shift types. `announcement`: `{ title, body, urgent, reasoning, ... }`. 503 when `OPENROUTER_API_KEY` is unset                                                                                                                                                            |
| `send-notification`       | yes          | Called only by `dispatch_notification_outbox()`. Presents `x-notification-secret`, compared in the database against `vault` (`verify_notification_secret`, `0091`). `service_role` client                                                                                                                                                                                                                                                      | `{ orgId, userIds[], type, title, body?, channels? }`, `channels` is `push` and/or `email`                                                                                    | `{ ok: true, results, dropped, recorded }`. Recipients not in the org are dropped. 503 when the secret cannot be checked                                                                                                                                                                                                                                                   |
| `purge-storage`           | yes          | Called only by `dispatch_storage_deletions()` (`0159`), the pg_cron drain of `storage_deletions`. Presents `x-notification-secret`, compared in the database against `vault` (`verify_notification_secret`, `0091`). `service_role` client, for the Storage API alone                                                                                                                                                                          | `{ bucket: 'staff-documents'                                                                                                                                                  | 'staff-photos' (0162), path, isFolder }`. `request.ts` accepts only an organisation folder, a person folder or an object inside one                                                                                                                                                                                                                                        | `{ removed: n }`. A missing object counts as removed, so a retry is harmless. 400 for any other bucket or path shape, 401 bad secret, 503 when the secret cannot be checked |
| `delete-account`          | yes          | Called only by `dispatch_account_deletions()` (`0162`), the pg_cron drain of `account_deletions`. Presents `x-notification-secret`, compared in the database against `vault` (`verify_notification_secret`, `0091`). `service_role` client, for the Auth Admin API alone                                                                                                                                                                       | `{ userId }`, a lower-case UUID; `request.ts` accepts nothing else                                                                                                            | `{ deleted: true }`. A user already gone counts as deleted, so a retry is harmless. 400 for anything that is not a user id, 401 bad secret, 503 when the secret cannot be checked                                                                                                                                                                                          |
| `send-invite`             | yes          | Signed-in user who can read the invite under RLS. Caller's JWT for the invite; `service_role` only for the organisation's mail credentials                                                                                                                                                                                                                                                                                                     | `{ orgId, inviteId, token }`                                                                                                                                                  | `{ sent: true, email }`. 404 unknown invite, 409 revoked, accepted or expired                                                                                                                                                                                                                                                                                              |
| `create-checkout-session` | yes          | Organisation owner, checked against `memberships` with `status = 'active'`. Caller's JWT                                                                                                                                                                                                                                                                                                                                                       | `{ orgId, planCode }`                                                                                                                                                         | `{ url }`, a hosted Stripe Checkout page for a full-page redirect. 409 `{ error: 'already_subscribed' }` while the organisation holds a `trialing`, `active` or `past_due` Stripe subscription in the same mode. Inside the organisation's own trial, `subscription_data.trial_end` carries its end into Stripe, so the card is first charged when the trial ends (`0154`) |
| `create-portal-session`   | yes          | Organisation owner, as above                                                                                                                                                                                                                                                                                                                                                                                                                   | `{ orgId }`                                                                                                                                                                   | `{ url }`, the Stripe Billing Portal. 404 when the organisation has no Stripe customer yet                                                                                                                                                                                                                                                                                 |
| `billing-account`         | yes          | Organisation owner, as `create-portal-session`. Caller's JWT for every read (organisation, subscription, invoice), so RLS scopes them; only stored values reach Stripe                                                                                                                                                                                                                                                                         | `{ orgId, action: 'sync_contact' }` or `{ orgId, action: 'invoice_links', invoiceId }` (RotaFlow's invoice id, never a Stripe id)                                             | `sync_contact`: `{ email }`, the address now on the Stripe customer; 422 when the organisation has no usable contact email. `invoice_links`: `{ hosted_invoice_url, invoice_pdf }`, each kept only if on a Stripe document host, returned and not stored; 422 for an invoice not issued through Stripe. 404 with no Stripe customer, 409 on a Stripe mode mismatch         |
| `stripe-webhook`          | **no**       | Stripe, verified by the `stripe-signature` header against `STRIPE_WEBHOOK_SECRET`. `service_role` client                                                                                                                                                                                                                                                                                                                                       | Stripe events: `checkout.session.completed`, `customer.subscription.updated`, `.deleted` and `.trial_will_end`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed` | `{ received: true }`, or `{ received: true, duplicate: true }` for an event already recorded. 400 on a bad signature                                                                                                                                                                                                                                                       |
| `calendar-feed`           | **no**       | A calendar client, which cannot send a header. The `token` query parameter is checked by `calendar_feed_shifts`, granted to `service_role` alone                                                                                                                                                                                                                                                                                               | `GET ?token=<uuid>`                                                                                                                                                           | `text/calendar` (iCalendar), `Cache-Control: private, max-age=900`. A bad, revoked or idle token (unread for 90 days, `0158`) or an internal error returns an **empty** calendar with 200. The one error status: more than 120 reads an hour for one person returns **429** with `Retry-After: 3600` (GAP-052)                                                             |
| `test-smtp`               | yes          | Organisation owner (`has_org_role`). Caller's JWT; `service_role` only to read the SMTP password                                                                                                                                                                                                                                                                                                                                               | `{ orgId }`                                                                                                                                                                   | `{ ok: true, sentTo }`, or `{ ok: false, error }` with 200 when the mail server refused. 404 when no SMTP settings are saved                                                                                                                                                                                                                                               |
| `public-enquiry`          | **no**       | Anyone on the public contact form. No session and no JWT check: an `Origin` outside the `_shared/cors.ts` allowlist is refused 403, the body is validated by `validate.ts`, a filled honeypot gets a 201 and is stored nowhere, Cloudflare Turnstile is verified when `TURNSTILE_SECRET_KEY` is set, and `receive_enquiry` rate-limits per HMAC-hashed address (5 an hour) and in total (100 an hour). `service_role` client, for that one RPC | `POST` JSON under 16 KB: `{ name, workEmail, organisation, teamSize?, sector?, message, wantsDemo?, marketingConsent?, website?, turnstileToken? }`                           | `201 { ok: true }`. Never echoes input. 400 `{ error: 'invalid', fields }` (names only) or `verification_failed`, 403 `origin_not_allowed`, 405, 413, 415, 429 `rate_limited`, 503 `unavailable`                                                                                                                                                                           |

The three with `verify_jwt: false` are deliberate and each has its own boundary
above. None is a gap: Supabase's gateway check would reject the only callers
`stripe-webhook` and `calendar-feed` have, and for `public-enquiry` it would
prove nothing, because its callers are visitors and the anon key it would check
is public. `public-enquiry` is the only one of the three with a block in
`supabase/config.toml` (`[functions.public-enquiry] verify_jwt = false`); the
other two rely on `--no-verify-jwt` at deploy.

### The public enquiry function (`0155`)

CAP-126, from the 2026 plan pack. It replaced a `mailto:` form that reached nobody on
a device with no mail client. `anon` holds no privilege on `enquiries`; the
function is the only way in, and the order of its checks is in its header.

- **Rate limit.** Inside `receive_enquiry`, in the same transaction as the
  insert, through the existing `consume_rate_limit` (`0085`). The subject is an
  HMAC-SHA256 of the client address keyed by `ENQUIRY_IP_SALT`, falling back to
  the service-role key behind a fixed label when that secret is unset. The
  address is `cf-connecting-ip` (set by Cloudflare, in front of hosted Supabase),
  else the first `x-forwarded-for` entry, else one shared `unknown` subject.
- **Turnstile.** Optional, and both halves or neither: `TURNSTILE_SECRET_KEY` on
  the function and `VITE_TURNSTILE_SITE_KEY` in the build. With the secret set
  and no widget on the page, every enquiry is refused. Verification follows
  Cloudflare's server-side validation documentation
  (developers.cloudflare.com/turnstile/get-started/server-side-validation, read
  2026-10-12): `secret`, `response`, `remoteip` and an `idempotency_key` posted
  to siteverify, and only `success: true` accepted. A network failure is a
  refusal.
- **Notification.** One email to `ENQUIRY_NOTIFY_EMAIL` over the platform SMTP
  account after the row commits, sent with `EdgeRuntime.waitUntil` so it never
  delays the response. It carries no text the visitor typed. Not through
  `notification_outbox`: see `docs/NOTIFICATIONS-SPEC.md`.
- **Tested.** `validate.ts` by vitest (`validate.test.ts`, 19 tests, including
  that the form's lists match the function's); the table and limiter by
  `supabase/tests/database/enquiries.test.sql`. The handler itself (origin
  refusal, Turnstile, the RPC call) is Deno and was reviewed by hand and
  `deno check`ed, not executed.

### The rule about which key they use

A function acting on a user's behalf builds its Supabase client with the
**caller's forwarded JWT**, so RLS scopes every query for free. `service_role`
is for genuinely cross-tenant work (a billing webhook, a scheduled drain, a feed
with no session) and is the exception.

`ai-rota-assistant` is the worked example: the JWT for everything, and
`service_role` for the single `audit_write` call that `authenticated` is
deliberately not allowed to make. Its data flow is `docs/ARCHITECTURE.md` §9b.

**What it sends to OpenRouter (`PROMPT_VERSION` 2, 2026-10-11, plan S3).** No
staff name and no staff profile id leaves the function. `staffAliases.ts`
assigns each active staff member a short alias (`S1`, `S2`...) in staff-id
order, so the same roster gives the same aliases on every call. The context's
`staff[].id`, `existingShifts[].staffProfileId`, `approvedLeave[].staffProfileId`
and `unavailability[].staffProfileId` carry the alias, and `staff[]` has no
`name` field. The manager's prompt is masked too: a full name, or a first name
only one person has, becomes that person's alias; a nickname, misspelling or
shared first name is sent as typed. On the way back, `suggestions[].staffProfileId`
is mapped from alias to the real id (anything else, including a real UUID, is
dropped as an unknown person), and aliases in `summary`, `reasoning`, `title`
and `body` are replaced with full names before the grounding check and the
response. The response shape to the browser is unchanged. Tested in
`staffAliases.test.ts`, including that a serialised context holds no name.

### Billing functions

Three Edge Functions, added with migration `0050`, share `supabase/functions/_shared/stripe.ts`:

- **`create-checkout-session`** — org owner picks a plan on Settings > Billing;
  runs as the calling user (JWT forwarded, RLS-scoped, owner-role checked
  against `memberships` directly) and returns a hosted Stripe Checkout URL for
  a full-page redirect. No Stripe.js on the client. It refuses with **409
  `{ error: 'already_subscribed' }`** when the organisation already holds a
  Stripe subscription (a `provider_ref`) in the same Stripe mode with status
  `trialing`, `active` or `past_due`: a second Checkout would create a second
  Stripe subscription, and the webhook's upsert on `org_id` would orphan the
  first while it kept charging. A row with no `provider_ref` (an admin-created
  organisation, `0084`) or one in the other mode does not block. Settings >
  Billing reacts to the 409 by opening the Billing Portal, where plan changes
  belong. The decision is `create-checkout-session/guard.ts`, tested by vitest.
  It reads only the stored row, so two Checkouts opened before the first
  `checkout.session.completed` arrives are not caught (BUG-107).

  **Trial.** Every organisation starts a 30-day trial recorded in
  `organisations.trial_ends_at` (`0154`). When an owner reaches Checkout
  inside it, the session passes `subscription_data.trial_end` (Unix seconds)
  set to that date, so Stripe collects the card now and first charges it when
  the promised trial ends. Stripe documents the parameter on
  https://docs.stripe.com/api/checkout/sessions/create and under "Add trial
  periods" on https://docs.stripe.com/get-started/use-cases/saas-subscriptions,
  and refuses a Checkout trial less than two days ahead
  (https://docs.stripe.com/billing/testing), so inside 49 hours, or after the
  trial, no trial is sent and the customer pays from today.
  `trial_period_days` is not used because it would start a fresh 30 days.
  `payment_method_collection` stays at its default, `always`: the no-card
  trial is the database's, and an owner at Checkout has chosen to pay. The
  decision is `checkoutTrialEnd` in `guard.ts`, tested by vitest. Checked
  against the Stripe documentation through Context7 on 12 October 2026.

- **`create-portal-session`** — same auth pattern, returns a Stripe Billing
  Portal URL so an owner can manage payment methods / cancel without a
  custom UI.
- **`billing-account`** (GAP-128, GAP-129) — same auth pattern, two small
  owner actions that need a Stripe key: `sync_contact` writes the
  organisation's contact email (read on the server, column first, then the
  legacy `settings.contact_email`) to the Stripe customer, and
  `invoice_links` retrieves one invoice by its stored `provider_ref` and
  returns its current hosted page and PDF links, because Stripe expires a
  stored hosted link 30 to 120 days after the due date. The request check
  and the contact rule are `request.ts`, tested by vitest; the link filter is
  the webhook's `invoiceDocuments`. Deployed by name; merging does not.
- **`stripe-webhook`** — the one function in this feature that runs as
  `service_role` (deployed `--no-verify-jwt`), since Stripe calls it directly
  with no end-user session; authenticated instead by Stripe's own request
  signature (`STRIPE_WEBHOOK_SECRET`). Handles
  `checkout.session.completed`, `customer.subscription.updated/deleted`,
  `customer.subscription.trial_will_end`, `invoice.paid`,
  `invoice.payment_failed` — upserts `subscriptions`
  (keyed on `org_id`/`(org_id, provider_ref)` since Stripe delivery is
  at-least-once), writes `invoices` as a second, automated writer alongside
  the manual platform-finance path, and calls `set_org_status()` (via its
  `0051` service-role exception, see "RPC contracts" below) to suspend an org once
  Stripe's dunning is exhausted.

  **Event ordering.** Stripe does not deliver events in order, and its
  documentation says not to order them by `created`
  (https://docs.stripe.com/webhooks#event-ordering). So
  `customer.subscription.updated` does not write the event's own copy of the
  subscription: it retrieves the subscription from Stripe and writes what Stripe
  holds at processing time, and a stale delivery therefore writes current state.
  A failed retrieval is a 500, so Stripe retries, rather than a fallback to the
  stale payload. `customer.subscription.deleted` writes only the row whose
  `provider_ref` it names, and suspends the organisation only when that write
  matched a row, so a late `deleted` for a replaced subscription cannot suspend
  its paying replacement. Both rules are in `stripe-webhook/reconcile.ts`, tested
  by vitest. No new column was needed. `checkout.session.completed` still
  upserts on `org_id` without an ordering check (BUG-108).

  **Trial and payment notices (`0154`, plan F16).** `checkout.session.completed`
  and `customer.subscription.updated` write `subscriptions.trial_ends_at` from
  Stripe's `trial_end`. `customer.subscription.trial_will_end`, which Stripe
  sends three days before a trial ends, queues "Your trial ends in 3 days" to
  the organisation's active owners through `notification_outbox`.
  `invoice.payment_failed` queues "Payment failed" once per invoice, also to
  the owners. Both are written only when the event names the subscription the
  organisation holds in that mode, and both carry a `dedupe_key`
  (`stripe:<event>:<mode>:<id>`), so a redelivery queues nothing twice. The
  rows are built by `trialEndingNotification` and `paymentFailedNotification`
  in `reconcile.ts`, tested by vitest.

  **Invoice documents (`0156`, plan F3).** `invoice.paid` and
  `invoice.payment_failed` also write the invoice's `hosted_invoice_url` and
  `invoice_pdf`. A finalised invoice carries both in the event; when one is
  missing the handler retrieves the invoice from Stripe (a draft is never
  retrieved, it has no links). Each URL is kept only if it is https on
  `invoice.stripe.com` or `pay.stripe.com`, the same rule as the column CHECK,
  so an unexpected host is dropped with a log line instead of failing the
  write. A link neither copy carries is left out of the write, never written
  as null, so a thin redelivery cannot erase a stored link. A failed retrieval
  is logged and does not fail the event: the payment is the part that matters.
  The rules are `invoiceDocuments`, `needsDocumentRetrieval` and
  `documentsToWrite` in `reconcile.ts`, tested by vitest.

  **`invoice.finalized` (GAP-129).** Records an unpaid invoice as `open`, with
  its links, the moment Stripe finalises it, so the owner sees it before it is
  paid or fails. It never changes a status already held: a row that exists
  (because `invoice.paid` or `invoice.payment_failed` arrived first, or this is
  a redelivery) only has its links filled in. Only an invoice Stripe sends as
  `open` is inserted; a zero-amount invoice finalised already `paid` is left to
  `invoice.paid`. A new row needs the organisation to hold the invoice's
  subscription in the event's mode, so a test-mode invoice cannot appear on a
  live organisation's list. Rules: `decideInvoiceFinalized` in `reconcile.ts`.
  The Stripe endpoint must be subscribed to `invoice.finalized` in both modes
  (owner action O3); until it is, nothing changes.

Deploy: `supabase functions deploy <name>` (`stripe-webhook`, `calendar-feed` and
`public-enquiry` need `--no-verify-jwt`).
Secrets: `STRIPE_SECRET_KEY` (shared by all three), `STRIPE_WEBHOOK_SECRET`
(webhook only, from the Stripe dashboard's endpoint config). After deploying
the webhook, register its URL in the Stripe dashboard against the six events
above (`customer.subscription.trial_will_end` was added with `0154`).

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
- **`request_my_data(kind, org?)`** and **`my_data_requests()`** (`0160`,
  `security definer`, `authenticated`): a person's own UK GDPR request, from My
  account, Your data. `request_my_data` files `access`, `portability`,
  `rectification` or `erasure` in the `0020` register for the caller; the subject
  email is read from `auth.users`, never passed, so there is no way to name somebody
  else. `org` is optional and must pass `is_org_member` (`42501` otherwise). Returns
  `{id, due_on, already_open}`: a second request of a kind already open returns the
  open case with `already_open = true` rather than starting a second clock. Refusals:
  signed out (`42501`), restriction or objection (`22023`, they stay with the email
  route), five requests already open (`54000`). `my_data_requests()` takes no
  argument and returns the caller's own cases: kind, status, received, due, extended
  and closed dates, never the outcome note. pgTAP:
  `supabase/tests/database/own_data_requests.test.sql`.
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

## PHP API (target, slice S2 of the merge)

Status: **PARTIAL.** These endpoints exist in `backend/` and are tested, but the product still runs on the
Edge Functions and RPCs above until the cutover (`docs/RESTRUCTURE-PLAN.md`). When an endpoint replaces an
RPC or function, the entry above is removed in the same change.

Conventions. Base path `/api`. GET and POST only; a mutation is a POST with the verb in the path.
`Authorization: Bearer <Clerk session token>` on everything except routes marked public. JSON in, JSON out.
Every error is `{"error":{"code","message"}}` with a stable `code`; a 500 adds a `correlation_id` and never a
trace. Placeholders (`{o}` organisation, `{m}` membership, `{i}` invite, `{d}` delegation) are UUIDs. An
organisation id the caller does not belong to, a malformed id and an unknown route all answer 404 once
signed in, and 401 when not, so ids and routes cannot be probed. Limits: 300 per minute per address on public
routes, 600 per minute per person elsewhere, request body 256 KB.

| Method and path | Who | Does | Notable codes |
| --------------- | --- | ---- | ------------- |
| `GET /health` | anyone | Entrypoint is alive; answered before config is read | |
| `GET /me` | signed in | The person, their active and invited memberships, and their platform role | `email_in_use` 409 |
| `POST /orgs` | signed in, **only when `org_creation` is `open` or the caller is a platform owner or admin** | Create an organisation (30-day trial, `professional`, support access off); the caller becomes owner. 5 per hour. In production the default is `invite_only`, so ordinary people get `org_creation_closed` | `org_creation_closed` 403, `rate_limited` 429, `invalid_input` 422 |
| `GET /orgs/{o}` | member | The organisation and the caller's own membership | |
| `POST /orgs/{o}` | owner | Rename | `org_not_active` 403 |
| `GET /orgs/{o}/members` | member | Members; email and name only for owner and manager | |
| `POST /orgs/{o}/members/{m}/role` | owner | Set `manager` or `staff`. Owner changes only by transfer | `forbidden` 403 |
| `POST /orgs/{o}/members/{m}/status` | owner | `active` or `suspended`; an owner cannot be suspended | `not_accepted` 409 |
| `POST /orgs/{o}/transfer-ownership` | owner | `{membership_id}`; promotes first, then demotes the caller to manager, in one transaction | `invalid_input` 422 |
| `GET /orgs/{o}/delegations` | member | Live manager cover | |
| `POST /orgs/{o}/delegations` | owner, manager (real role) | `{membership_id, ends_at, note?}`; at most 90 days; replaces any live cover for the pair | `invalid_input` 422 |
| `POST /orgs/{o}/delegations/{d}/revoke` | lender, or real owner or manager | End cover now | |
| `GET /orgs/{o}/invites` | owner, manager | Invitations with a derived `state`; never a token | |
| `POST /orgs/{o}/invites` | owner, manager | `{email, role: manager|staff}`; returns the token once. 60 per hour per organisation, 3 per address per day | `invite_pending`, `already_member` 409 |
| `POST /orgs/{o}/invites/{i}/revoke` | owner, manager | Revoke a pending invitation | |
| `POST /platform/orgs` | platform owner, admin (everyone else 404) | `{name, owner_email}`: creates an organisation with no members and an owner invitation; returns the token once. 20 per hour | `invalid_input` 422 |
| `POST /platform/orgs/{o}/owner-invites` | platform owner, admin | `{owner_email}`: replaces the pending owner invitation, only while the organisation has no members | `org_has_members` 409 |
| `POST /invites/preview` | public | `{token}` returns organisation name, role, email, expiry. 30 per minute per address | `invite_invalid` 404 |
| `POST /invites/accept` | signed in | `{token}`; the verified email must equal the invited address; an owner invitation is refused if the organisation already has an owner | `invite_email_mismatch` 403, `invite_invalid` 404, `owner_exists` 409 |

A role check uses the **effective** role: a live delegation lifts a staff member to manager (never owner) and
ends the moment its lender stops being an owner or manager. Acts a delegate must never perform (lending cover
onwards, transferring ownership, ending a colleague's cover) check the **real** role.

### Slice S3: people and places

All under `/api`, all org-scoped (`{o}`); `{l}` location, `{d}` department, `{t}` job title, `{s}` staff record,
`{c}` emergency contact. Reads need membership. Writes need owner or manager unless stated, and are refused with
`org_not_active` while the organisation is suspended.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /orgs/{o}/locations`, `POST /orgs/{o}/locations`, `POST .../{l}`, `POST .../{l}/delete` | read: member; write: owner, manager | Sites. Time zone must be IANA, latitude and longitude go together, radius 10 to 10000 m (a new bound). Deleting unplaces its departments |
| `GET/POST /orgs/{o}/departments`, `POST .../{d}`, `POST .../{d}/delete` | read: member; write: owner, manager | Departments, optionally in a location of the same organisation. Deleting unplaces its staff |
| `GET /orgs/{o}/job-titles`, `POST /orgs/{o}/job-titles`, `POST .../{t}`, `POST .../{t}/delete` | read: member; write: owner, or manager if the organisation allows | The catalogue. `title_exists` and `colour_in_use` 409. Renaming updates the text copy on staff |
| `GET /orgs/{o}/staff[?active=1]`, `GET .../{s}` | member | Staff records. Payroll id, start date, phone, email and holiday allowance are `null` unless the caller is an owner or manager or the record is theirs. `location_ids` included |
| `POST /orgs/{o}/staff` | owner, manager | Create. A matching member without a record is linked. `payroll_id_taken` 409 |
| `POST /orgs/{o}/staff/{s}` | owner, manager; or the person for `phone` and `photo_url` only | Update. Other fields from the person: `self_edit_restricted` 403. Payroll id once set: `payroll_id_locked` 409 |
| `POST /orgs/{o}/staff/{s}/locations` | owner, manager | `{location_ids}` replaces the set |
| `GET/POST /orgs/{o}/staff/{s}/pay-rates` | read: owner, manager, the person; write: owner, manager | History of whole-pence hourly rates by start date. `rate_exists` 409 |
| `GET/POST /orgs/{o}/staff/{s}/emergency-contacts`, `POST .../{c}`, `POST .../{c}/delete` | the person, owner, manager | Name and phone required |
| `GET/POST /me/settings` | the person | Theme, time format, week start, digest frequency |
| `POST /orgs/{o}/onboarding/complete` | owner | Idempotent; keeps the first time |
| `GET /orgs/{o}/audit[?limit&before_id]` | owner: the organisation's trail; others: only their own acts | Platform-only entries never shown. Newest first, 1 to 100 per page |

An invitation (`POST /orgs/{o}/invites`) may also carry `department_id` and `location_id`; accepting applies them to the person's staff record.

### Slice S4: the rota

Placeholders: `{r}` rota, `{h}` shift, `{y}` shift type, `{a}` availability. Times are ISO 8601 **with an offset**
(a time with none is refused); they are stored in UTC and returned with a trailing `Z`. Writes need owner or manager unless stated.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /orgs/{o}/rotas[?location_id&from&to]` | member | Rotas. Staff see published and archived only |
| `POST /orgs/{o}/rotas` | owner, manager | `{name, period_start, period_end, location_id?}`: a draft. One draft per site and period (`rota_exists` 409); at most a year |
| `POST /orgs/{o}/rotas/{r}` | owner, manager | Rename or re-date a draft (`rota_not_draft` 409 otherwise) |
| `POST /orgs/{o}/rotas/{r}/publish` | owner, manager | Draft to published. Refused with `cover_below_minimum` 409 (message names the site, day and shortfall) while a future day is under its minimum. Idempotent. Publishing an amendment archives the rota it supersedes in the same step |
| `POST /orgs/{o}/rotas/{r}/unpublish` | owner, manager | Published back to a draft. `open_amendment` 409 while an amendment exists |
| `POST /orgs/{o}/rotas/{r}/revision` | owner, manager | Start or resume an amendment of a published rota: a draft that supersedes it, with a copy of its shifts |
| `POST /orgs/{o}/rotas/{r}/discard` | owner, manager | Delete an open amendment and its shifts; returns the published rota. `not_an_amendment` 409 |
| `POST /orgs/{o}/rotas/{r}/repeat` | owner, manager | `{weeks: 1..26}`: copy into the following weeks, skipping published weeks and weeks that already have shifts. Returns `weeks_created`, `shifts_created`, `weeks_skipped` |
| `GET /orgs/{o}/shifts` | member | `?rota_ids=a,b` (up to 50; cancelled included), or `?from=&to=` (shifts starting in the window; add `&overlapping=1` for shifts running during it), each with optional `location_id`, `staff_profile_id`. Up to 5000 rows (`truncated: true` beyond). Each shift carries `rota: {status, supersedes_rota_id}` |
| `POST /orgs/{o}/shifts`, `POST .../shifts/batch` | owner, manager | One shift, or `{shifts: [...]}` of up to 500, all or nothing. A shift with no `rota_id` is a loose shift. `rota_published` or `rota_archived` 409 for a rota that cannot take changes |
| `POST /orgs/{o}/shifts/{h}`, `.../{h}/delete` | owner, manager | Edit (including moving between draft rotas) or delete |
| `GET/POST /orgs/{o}/shift-types`, `POST .../{y}`, `.../{y}/delete` | read: member; write: owner, manager | `shift_type_in_use` 409 on delete |
| `GET/POST /orgs/{o}/availability`, `POST .../{a}/delete` | the person (own); owner and manager (anyone) | A weekday (0 = Sunday) or one date, optional start and end together, status `available`, `unavailable` or `preferred` |
| `GET/POST /orgs/{o}/minimum-cover` | read: member; write: owner, manager | `{location_id, weekday, min_staff}`; one rule per site per weekday |

Request bodies may be up to 256 KB. Deleting a location or department that rotas or shifts use is refused
(`location_in_use`, `department_in_use`): mark the location inactive instead.

### Slice S5: time and requests

Placeholders: `{e}` clock event, `{l}` leave request, `{v}` overtime request, `{w}` swap, `{h}` shift, `{t}` timesheet.
**Idempotency:** `POST` clock events, leave and swaps accept an optional `client_event_id` (a UUID the device mints before its first attempt).
A replay answers `200` with `already_applied: true` and the original record; the same key used by someone else answers `409 client_event_conflict`.
Nothing about a unique index is exposed. A member reads only their own records on every list below; owner and manager read anyone's.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /orgs/{o}/clock-events[?staff_profile_id&from&to&limit&latest=1]` | member (own), owner, manager | Events, newest first |
| `POST /orgs/{o}/clock-events` | the person (own), owner, manager (anyone) | `{type: in|out|break_start|break_end, event_at?, latitude?, longitude?, accuracy?, method?, location_name?, shift_id?, staff_profile_id?}`. A person's time more than 5 minutes ahead or 72 hours behind is replaced by the server's (the claim is kept as `event_at_reported`). `already_clocked_in` 409 |
| `POST /orgs/{o}/clock-events/{e}/correct` | owner, manager | `{reason (3 to 500), event_at?, type?, expected_updated_at?}`; `record_changed` 409; flags approved timesheets. `GET .../{e}/corrections` lists the history. `POST .../{e}/delete` deletes |
| `GET/POST /orgs/{o}/leave`, `POST .../{l}/review`, `.../{l}/cancel` | request: the person, or owner and manager for anyone; review: owner, manager | `{type?, start_date, end_date, starts_half?, ends_half?, reason?}`; `leave_overlap` 409; a pending request is decided once (`already_decided` 409); responses include `days` |
| `GET/POST /orgs/{o}/overtime`, `POST .../{v}/review`, `.../{v}/cancel` | as leave; cancel: pending only | `{date, hours (0.25 to 24), note?}` |
| `GET /orgs/{o}/overtime/evidence?staff_profile_id&date` | owner, manager, the person | `scheduled_minutes`, `worked_minutes`, `unpaired_events` |
| `GET /orgs/{o}/attention` | owner, manager | `leave_pending`, `overtime_pending`, `swaps_pending` for the nav badges |
| `GET /orgs/{o}/swaps[?status]`, `POST /orgs/{o}/swaps` | member (those involved, plus the open board); owner and manager see all | `{shift_id, target_staff_profile_id?, note?}`; the shift must be yours and not cancelled |
| `POST .../swaps/{w}/respond` | the target | `{status: accepted|rejected}` while pending |
| `POST .../swaps/{w}/claim` | any member except the requester | Take an open-board swap; `swap_unavailable` 409 if it has gone |
| `POST .../swaps/{w}/cancel` | the requester, owner, manager | Before a decision |
| `POST .../swaps/{w}/decide` | owner, manager; the requester once the colleague accepted | `{status: approved|rejected}`. Approving moves the shift atomically. Returns `outcome` (`approved`, `declined`, `already-decided`), `reassigned`. `shift_reassigned`, `target_inactive`, `rota_archived`, `shift_gone` 409 change nothing |
| `POST .../swaps/{w}/reassign` | the requester, owner, manager | Move the shift of an approved swap that never moved it |
| `GET /orgs/{o}/open-shifts` | member | Future, unassigned, open shifts on published rotas, with `clashes_with_mine` |
| `POST /orgs/{o}/open-shifts/{h}/claim` | a member with a staff record | `shift_taken`, `already_working` 409; `not_published`, `already_started` 403 |
| `GET /orgs/{o}/timesheets[?period_start&period_end&staff_profile_id&status]` | member (own), owner, manager | |
| `POST /orgs/{o}/timesheets/submit` | the person | `{period_start, period_end, total_minutes}`; `timesheet_locked` 409 once approved or exported |
| `POST /orgs/{o}/timesheets/approve` | owner, manager | `{period_start, period_end, approvals: [{staff_profile_id, total_minutes}]}`, up to 500, all or nothing; bumps `version`, clears `recalculation_required_at` |
| `POST /orgs/{o}/timesheets/{t}/reopen` | owner, manager | Back to `open`; the approval history stays |

Deleting a shift removes the swaps that offered it; clock events that pointed at it keep their record and lose the link.

### Slice S6: communication

Placeholders: `{n}` announcement. The Dispatcher and the cron entry have no HTTP surface.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /orgs/{o}/notifications[?unread=1&limit]` | the person (own) | Inbox, newest first, with `unread_count` |
| `POST /orgs/{o}/notifications/read` | the person (own) | `{all: true}` or `{ids: [up to 100]}` |
| `POST /me/push-subscriptions` | the person | `{endpoint (https), keys: {p256dh, auth}}`; registering a device another person had takes it over |
| `POST /me/push-subscriptions/delete` | the person | `{endpoint}`; only their own |
| `POST /orgs/{o}/settings` | owner | `{notification_defaults?, job_titles_managed_by?}`; the matrix is 5 events (`rota_published`, `shift_reminder`, `swap_requests`, `leave_updates`, `announcements`) by 3 channels (`in_app`, `email`, `push`), booleans only |
| `GET/POST /orgs/{o}/smtp`, `POST .../smtp/test`, `POST .../smtp/delete` | owner | The organisation's own mail account. A read says `has_password`, never the password. Saving without `smtp_pass` keeps the stored one; changing host, port, user or password clears `verified_at`. The test mails only the owner's own address and returns `{ok}` or a short `error` |
| `GET/POST /orgs/{o}/announcements`, `POST .../{n}`, `.../{n}/publish`, `.../{n}/delete` | read: member (staff see published only); write: owner, manager | `{title, body, urgent?, scope: org|location|department, location_id?, department_id?, publish?}`. Publishing the first time notifies the audience once |
| `POST .../announcements/{n}/read` | a member with a staff record | Idempotent |
| `GET .../announcements/{n}/reads`, `POST .../{n}/remind` | owner, manager | Who has read it and how many in the audience have not; remind those who have not (6 an hour) |
| `GET /orgs/{o}/calendar-feed`, `POST .../issue`, `POST .../revoke` | the person (own) | Issue returns the secret token once; issuing a new one revokes the old |
| `GET /ics?token=` | public | The person's published, uncancelled shifts from 30 days ago to 180 ahead, as `text/calendar`. A bad token is a bare 404; guessing is rate limited; an unused feed ends after 90 days |
| `POST /orgs/{o}/invites/{i}/resend` | owner, manager | A fresh link for a pending invitation, emailed; the old link stops working |

Creating or resending an invitation now also reports `email_sent` and `email_error` (`no_mail_account`, `connect_failed`, `smtp_550`, ...).

### Slice S7: billing

Placeholders: `{i}` invoice. Stripe is in test mode until `stripe.mode` is changed in private config. `GET /plans` and the owner routes answer 503 `billing_unavailable` where Stripe is not set up.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /plans` | any signed-in person | The price list: code, name, monthly price in pence, seat and location limits (`null` is unlimited), features, and whether it can be bought now. Stripe ids are never returned |
| `GET /orgs/{o}/billing/state` | any member | `{state, plan, trial_ends_at, grace_until}`; `state` is `active`, `trialing`, `grace`, `trial` or `read_only` |
| `GET /orgs/{o}/billing` | owner | The state, the subscription's status and period, the latest 36 invoices (without Stripe ids) and `stripe_configured` |
| `POST /orgs/{o}/billing/checkout` | owner | `{plan: starter|professional|business}` returns `{url}` for Stripe Checkout. 409 `already_subscribed` if this mode already holds a live subscription; 409 `plan_unavailable` if the plan has no price yet; 422 for enterprise (by arrangement). Return URLs are on `app_url` |
| `POST /orgs/{o}/billing/portal` | owner | `{url}` for the Stripe billing portal for the organisation's own customer. 404 before a first checkout; 409 if the customer belongs to the other mode |
| `POST /orgs/{o}/billing/sync-contact` | owner | Writes the organisation's contact email (column, else `settings.contact_email`) to the Stripe customer; 422 `no_contact_email` |
| `POST /orgs/{o}/billing/invoices/{i}/links` | owner | Fresh `{hosted_invoice_url, invoice_pdf}` from Stripe, only ever Stripe's own hosts |
| `POST /stripe/webhook` | public, **signed** | Raw body and `Stripe-Signature` (HMAC-SHA256, 300 s tolerance, secret per mode). 400 on a bad signature; 200 and ignored for an event of the other mode; 200 `duplicate` for one already processed; 500 (Stripe retries) when handling failed. Events handled: `checkout.session.completed`, `customer.subscription.updated`, `.deleted`, `.trial_will_end`, `invoice.finalized`, `.paid`, `.payment_failed` |

Plan limits answer **402** with `seat_limit` or `location_limit`; a read-only organisation answers **402** `billing_read_only` to building a rota or shifts and to inviting.

### Slice S8a: the console

Placeholders: `{u}` user, `{s}` support session, `{c}` support case, `{i}` incident, `{e}` enquiry. Everything under `/platform` is 404 to anyone who is not the right kind of platform staff.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /platform/settings` | any signed-in person | Platform name, support email, URL, time zone, registration, maintenance notice |
| `POST /platform/settings` | owner, admin | Any of those fields; audited |
| `GET /platform/admins`, `POST /platform/admins` `{email, role}`, `POST /platform/admins/{u}/revoke` | read: all staff; write: owner | The roster. The person must have signed in once. The last owner cannot be demoted or revoked; revoking ends their support sessions |
| `GET /platform/summary` | all staff | Counts: organisations by status and plan, subscriptions, users, active staff, monthly recurring pence, open support sessions |
| `GET /platform/orgs[?q&status&plan&limit&offset]`, `GET /platform/orgs/{o}` | all staff | Directory and one organisation's counts, with billing state. Never tenant rows |
| `POST /platform/orgs/{o}/status` `{status: active|suspended, reason}` | owner, admin, finance | Suspend (reason of 5+ characters) or reinstate |
| `GET /platform/users[?q]` | owner, admin, support | People directory (not finance) |
| `POST /platform/orgs/{o}/support-sessions` `{reason, case_ref, scope, minutes}` | owner, admin, support | Needs the organisation's consent; 409 `session_open` if one is open |
| `GET /platform/support-sessions`, `POST /platform/support-sessions/{s}/revoke` | owner, admin, support | List; end one (own, or any if owner or admin) |
| `POST /orgs/{o}/support-access` `{allowed}` | owner (a real owner) | The customer's consent. Turning it off ends every open session |
| `GET /orgs/{o}/support-sessions`, `POST .../{s}/revoke` | owner, manager read; owner end | Who has been inside, why, and for how long |
| `POST /support/cases` `{subject, body, category, priority?, org_id?, requester_email?}` | signed in | `requester_email` is honoured for staff only. Returns `CASE-4120`-style `reference` |
| `GET /support/cases`, `GET /support/cases/{c}` | the requester; an owner of the case's organisation; staff (who also see internal notes and the assignee) | Messages and the SLA state (`on_track|due_soon|met|breached`, minutes remaining) |
| `POST /support/cases/{c}/reply` `{body, internal?}` | as above; `internal` is staff only | The first public staff reply stamps the response and moves open to pending; the requester is notified |
| `POST /support/cases/{c}/rate` `{score 1-5, comment?}` | the requester, once resolved | A re-rating overwrites; a reopen keeps it |
| `GET /platform/support/cases[?status&priority&category&assigned&q&limit]`, `POST .../{c}/status` `{status, note?}`, `POST .../{c}/assign` `{agent_user_id|null}` | owner, admin, support | The queue (urgent first, each with its SLA), status, assignment |
| `GET/POST /platform/support/sla` | read: operational; write: owner, admin | Response and resolution promises by priority |
| `GET /platform/incidents[?open=1]`, `GET .../{i}`, `POST /platform/incidents`, `POST .../{i}/updates`, `POST .../{i}/resolve` | operational | `INC-0138`-style references; resolving needs a note |
| `GET /orgs/{o}/features` | any member | Features on for this organisation: `flag` and `plan` sources |
| `GET /platform/flags`, `GET /platform/flags/changes?key=` | all staff | Flags and their history |
| `POST /platform/flags` `{key, enabled?, rollout?, plans?}`, `POST /platform/flags/targets` `{key, org_id, targeted}` | owner, admin | Absent means unchanged; a retired flag is refused |
| `POST /enquiries` | public | The contact form: JSON up to 16 KB, honeypot `website`, optional Turnstile `turnstileToken`. 201 `{ok:true}`; 400 `invalid` with field names only, or `verification_failed`; 403 `origin_not_allowed`; 413; 415; 429 |
| `GET /platform/enquiries[?status]`, `POST .../{e}/status` | operational | The inbox (no address hash or user agent) and its status |

### Slice S8b-1: data lifecycle

Placeholders: `{g}` data-subject request.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /platform/gdpr[?open=1]`, `POST /platform/gdpr` `{email, kind, name?, org_id?, received_on?}` | owner, admin, support | The register (due date order, 200 at most); log a request. Due one calendar month after receipt |
| `POST /platform/gdpr/{g}/status` `{status, note?}` | owner, admin, support | Completing or refusing needs a note. Completing an erasure queues the login, or refuses with `holds_platform_role` / `sole_owner` |
| `POST /platform/gdpr/{g}/extend` `{reason}` | owner, admin | Once only, two months from the original due date; reason of 15+ characters |
| `GET /orgs/{o}/gdpr` | owner | Requests that name the organisation |
| `POST /me/data-requests` `{kind: access|portability|rectification|erasure, org_id?}`, `GET /me/data-requests` | the person | 200 `already_open` for a repeat; 429 `too_many_open` at five; status only |
| `POST /orgs/{o}/staff/{s}/erase` | owner (a real owner) | Anonymises the staff record in place; the login and membership are left |
| `GET /orgs/{o}/deletion-preview`, `POST /orgs/{o}/delete` `{confirm_name}` | owner | Counts; delete with the exact name (422 `name_mismatch`). Immediate and irreversible |
| `GET /platform/orgs/{o}/deletion-preview`, `POST /platform/orgs/{o}/delete` | owner, admin | The same, for a platform administrator |
| `GET /platform/retention`, `POST /platform/retention/dry-run` | read: all staff; dry run: owner, admin | Policies and the last 50 runs; count what the next run would remove |

### Slice S8c-1: the AI rota assistant

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `POST /orgs/{o}/ai/rota` `{prompt, periodStart, periodEnd}` | owner, manager (not a support session); plan with `ai_rota_assistant`; flag on | `{summary, suggestions[]}`. 403 `plan_required` / `feature_off`, 503 `ai_unavailable`, 429 `rate_limited`, 413 `context_too_large` |
| `POST /orgs/{o}/ai/announcement` `{prompt, periodStart, periodEnd}` | the same | `{title, body, urgent, reasoning, unverified[]}`; refused with `ai_ungrounded_date` if the draft names a date it was not given |

### Slice S8b-2: announcements, credits, audit

Placeholders: `{a}` platform announcement, `{i}` invoice.

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /platform/announcements`, `POST /platform/announcements` `{title, body, kind, audience: all|plans, plans?, scheduled_for?}` | read: all staff (counts for operational only); write: owner, admin | Draft, or scheduled when a time is given |
| `POST /platform/announcements/{a}/publish`, `.../cancel` | owner, admin | Publish returns how many organisations were queued; 409 `already_sent` / `cancelled` |
| `GET /orgs/{o}/platform-announcements`, `POST .../{a}/read` | owner, manager | What the platform sent the organisation; mark read |
| `POST /orgs/{o}/platform-announcements/opt-out` `{opted_out}` | owner | Silences product, billing and policy notices |
| `GET /platform/billing/summary` | owner, admin, finance | Per currency: MRR, collected this and last month, outstanding, past due, refunded |
| `GET /platform/invoices[?q&status&currency&org_id&from&to&limit&offset]` | owner, admin, finance | The invoice directory with `credited_pence` and a `total` |
| `GET/POST /platform/invoices/{i}/credits` `{amount_pence, reason, idempotency_key?}` | owner, admin, finance | Record a credit (201; 200 `already_recorded` for a repeated key); 422 `not_creditable` |
| `GET /orgs/{o}/invoices/{i}/credits` | owner | The credits on the organisation's own invoice |
| `GET /platform/audit[?scope&actor&severity&q&from&to&limit&offset]` | owner, admin, support | The trail across organisations: `scope=platform` or an organisation id; severity is a comma list |

### Slice S8c-2: photos and templates

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `POST /orgs/{o}/staff/{s}/photo` `{data: base64}` | the person, owner, manager | JPEG, PNG or WebP up to 2 MB, judged by its bytes (this route accepts a body up to 3 MiB). 413 `photo_too_large`, 415 `photo_type` |
| `POST /orgs/{o}/staff/{s}/photo/delete` | the person, owner, manager | Clears it; the file is removed by cron |
| `GET /orgs/{o}/staff/{s}/photo-link` | any member | `{url, expires_at}` good for an hour, or `{url: null}` |
| `GET /api/files?b&p&e&s` | public, signed | The picture itself; 404 for any bad, expired or stale link |
| `GET /platform/notification-templates`, `POST .../` `{key, subject, body, org_id?}`, `POST .../delete` `{key, org_id?}` | read: owner, admin, support; write: owner, admin | Email wording, platform-wide or for one organisation (which wins). Placeholders: `org_name`, `staff_name`, `title`, `body`, `body_line`, `app_url` |


### Slice S9: the React app moves onto the API

The browser now talks only to this API (`src/lib/api.ts`, `/api` on the same origin, the Clerk session token as
`Authorization: Bearer`). Every response's `YYYY-MM-DD HH:MM:SS` timestamps are read as UTC (`src/lib/apiDates.ts`).
Routes added because a screen needed them and they were R1 scope:

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `POST /orgs/{o}` (extended) | owner | Any of `name`, `slug` (409 `slug_taken`), `industry`, `country`, `timezone` (IANA), `contact_email`, `contact_phone`; only fields sent change. `GET /orgs/{o}` returns them and `onboarding_completed_at` |
| `GET /slug-available?slug&exclude` | signed in | `{available}` only; `exclude` must be an organisation the caller belongs to (404 otherwise); 60 a minute |
| `POST /orgs/{o}/settings` (extended) | owner | Also the organisation preferences: `size`, `org_type`, `website`, `address_line`, `registration_no`, `primary_contact`, `role_labels`, the scheduling policies, `intended_plan`, `billing_period`, each type-checked; anything unknown is 422 |
| `GET /orgs/{o}/labour-cost?from&to&paid_breaks` | owner, manager | Per site: minutes, cost at the rate in force on the day of each shift (rounded per shift), unrated people counted; published and archived rotas only; at most 400 days |
| `GET /orgs/{o}/pay-rates/current` | owner, manager | Each person's rate in force today |
| `POST /me/profile` `{full_name}` | signed in | The person's display name (email is Clerk's) |
| `GET/POST /me/settings` (extended) | signed in | Adds `notifications_enabled` (boolean) |
| `POST /orgs/{o}/audit` `{action, entity_type?, entity_id?, metadata?}` | any member | Records an export or review the person did; allow-listed actions, metadata at most 2000 bytes, 120 an hour |
| `GET /platform/users/{u}` | owner, admin, support | The person and every membership |
| `GET /platform/orgs/{o}/structure` | owner, admin, support | Members (name, email), sites, departments, counts (staff, published rotas, this month's shifts) |
| `GET /platform/notifications/activity?limit` | owner, admin, support | Recent notifications without title or body, and the push subscription count |
| `GET /platform/summary` (extended) | platform staff | Adds `published_rotas` and `shifts_this_month` |

Not on the API, by decision: manual invoice issue and status (Stripe's webhook owns invoices); the platform
require-MFA switch (Clerk's dashboard); integrations, the IP allow-list and stored health probes (cut list).
Staff documents arrived with S10, below; the screens stay behind the `staff_documents` feature flag.

### Slice S10 (R2): compliance

Owners and managers include delegates (a staff member lent manager authority). A platform support session gets 403 on
every route here. Writes refuse a suspended organisation (`org_not_active`). Dates are `YYYY-MM-DD` in the
organisation's timezone; a document row carries `status` (computed: an approved or pending row past its expiry reads
`expired`) and `stored_status`, never its storage path (`stored: true` instead).

| Method and path | Who | Does |
| --------------- | --- | ---- |
| `GET /orgs/{o}/document-types` | any member | Active types; owners and managers also get archived ones and `presets` (UK examples with `added`) |
| `POST /orgs/{o}/document-types` `{name, description?, requires_expiry?, default_validity_months?, required?}` | owner, manager | 201 `{type}`; 409 `duplicate_name`, `type_limit` (100 active); 60 an hour |
| `POST /orgs/{o}/document-types/presets` `{key}` | owner, manager | Adds a UK example; 422 unknown key; 409 if already there |
| `POST /orgs/{o}/document-types/{t}/update` `{..., expected_version}` | owner, manager | 409 `version_conflict` or `archived` |
| `POST /orgs/{o}/document-types/{t}/archive` `{expected_version}` | owner, manager | Lifts the requirement; filed documents stay |
| `GET /orgs/{o}/documents[?staff_profile_id]` | owner, manager: anyone's or all; staff: their own (404 for someone else's) | Rows newest first, history included, at most 500 |
| `POST /orgs/{o}/documents` `{staff_profile_id?, document_type_id, name?, issued_at?, expires_at?, submit?, data}` | the person for their own record; owner, manager for any active record | `data` is the file, base64: PDF, JPEG, PNG, WebP or HEIC up to 10 MB, judged by its bytes (this route accepts a body up to 14 MiB). 201 `{document}` as `awaiting_review` (or `uploaded`, a draft, with `submit: false`). 413 `document_too_large`, 415 `document_type`, 422 for a future issue date, an expiry before issue or already past, a missing expiry the type needs; 60 an hour |
| `GET /orgs/{o}/documents/queue` | owner, manager | Awaiting review, oldest first, with `staff_name`, `own`, `can_approve` |
| `POST /orgs/{o}/documents/{d}/submit` `{expected_version?}` | the person, owner, manager | A draft to review; 409 `wrong_status`, `document_expired` |
| `POST /orgs/{o}/documents/{d}/review` `{decision: approve\|reject, reason?, expected_version}` | owner, manager | Four eyes: 403 for the person the document is about (owners too) and for a manager approving what they uploaded (an owner may). Approving supersedes the earlier approved row of the type. A reason (3 to 500 characters) is required to reject. 409 `wrong_status`, `version_conflict`, `document_expired` |
| `POST /orgs/{o}/documents/{d}/withdraw` `{expected_version?}` | the person (draft, pending, rejected); owner, manager (also approved) | Kept as history; 403 for staff on an approved document |
| `GET /orgs/{o}/documents/{d}/link` | the person, owner, manager | `{url, expires_at}` good for a minute; a moved row's pasted link is returned as it is |
| `GET /api/document-files?p&e&s` | public, signed | The file itself, `Cache-Control: private, no-store`; 404 for any bad, expired or stale link |
| `GET /orgs/{o}/compliance/me` | any member | `{today, staff_profile_id, requirements[{type_id, name, state, expires_at}], counts, documents}`; a member with no staff record has nothing required |
| `GET /orgs/{o}/compliance/summary` | owner, manager: `scope: org` with `counts`, `by_type` and `people[{staff_profile_id, eligible, missing, expiring}]`; staff: `scope: me` with their own `counts` | The numbers behind the Compliance page and the rota builder's eligibility chip |

Eligibility is an internal service, not an endpoint: `Compliance::eligible(pdo, org, staffProfileId, atUtc)` returns
`{ok, missing}` for the organisation-local date of that instant. S12 (cover, and the instant claim on open shifts)
consumes it.

