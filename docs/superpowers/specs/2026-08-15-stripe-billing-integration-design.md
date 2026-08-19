# Stripe billing integration — design spec

Status: approved by user 2026-08-15, pending implementation plan.

## Context

`src/pages/app/settings/SettingsBillingPage.tsx`'s "Payment" section has been a
deliberate stub since it was written: "Billing is not connected yet. No
payment method is stored, no invoices have been issued, and nothing will be
taken." The surrounding schema was built ready for a provider (`subscriptions.provider`/`provider_ref`
are an explicit empty seam) but no provider was ever wired in.

Two things changed that motivate doing this now:

1. The user has decided the provider is Stripe, and has a Stripe account
   already (no Products/Prices created yet).
2. Investigating the "fix the Payment section" request surfaced that the
   codebase already contains a **real, more authoritative pricing model**
   than the one on the public marketing pages — `supabase/migrations/0023_commercials.sql`
   built a `plans` table, an `invoices` table, RLS, and a working
   `subscription_mrr_pence()` function that the Platform Console
   (`AdminBillingPage.tsx`, `AdminSubscriptionsPage.tsx`) already reads for
   revenue reporting. It has always returned zero, because nothing has ever
   written a real invoice. `src/lib/marketing.ts`'s public pricing
   (`Starter free / Team £2.50-per-seat / Enterprise custom`) is a different,
   older, self-admittedly provisional model that was never reconciled with
   0023's design. This spec adopts 0023's model as correct and rewrites
   marketing copy to match, rather than the reverse — 0023 already has a real
   plans table, a real invoices table, and a Platform Console built against
   it; rebuilding that around per-seat pricing would throw away working
   schema for no benefit.

## Decisions made during brainstorming (with the user, 2026-08-14/15)

| Question | Decision |
|---|---|
| Stripe account state | Exists; no Products/Prices created yet — this work proposes the structure, user creates them in Stripe test mode, we wire in the Price IDs |
| Which plans get self-serve checkout | All four: starter, professional, business, enterprise (enterprise stops being sales-assisted-only) |
| Enterprise's price (was "let us talk") | Flat monthly price — **use 0023's already-seeded £790/mo**, not a newly invented number |
| Pricing model | 0023's DB model: 4 flat monthly tiers (£29 / £129 / £299 / £790), seat/location numbers are caps, not per-seat billing — **not** marketing.ts's £2.50-per-seat model |
| Seat-count sync to Stripe | None needed — flat pricing means no Stripe subscription quantity to keep in sync |
| Invoice history / payment method UI | Stripe's own hosted Customer Portal — no new invoices/payment-methods UI built in RotaFlow. (Note: `invoices` table still gets populated by the webhook, for the Platform Console's existing reporting — the Portal decision only affects the *org owner's* UI, not the data model.) |
| Trial-on-signup | Out of scope. New orgs still get no subscription row, unchanged from today. Only the upgrade/pay flow from Settings is built. |
| Seat/location cap enforcement | Out of scope. `plans.seat_limit`/`location_limit` remain informational; staff/location creation is unaffected. |

## Architecture

### Schema changes (new migration, `0050_stripe_billing.sql`)

- `plans.stripe_price_id text` — nullable until the user creates each Price
  in Stripe and provides the ID; one column, not a separate mapping table,
  since `plans` already is the price list.
- `subscriptions.stripe_customer_id text` — separate from the existing
  `provider_ref` (which holds the *subscription* id once one exists); the
  customer id is needed to create a Portal session even between
  subscriptions (e.g. after a cancellation, before a resubscribe).

No changes to `invoices` — 0023's shape already fits (`provider`/`provider_ref`
columns exist, unused until now).

### Edge Functions (new)

All three follow existing conventions in `supabase/functions/` (Deno,
`ai-rota-assistant`/`send-notification` as the JWT-forwarding pattern to
follow for the first two; `inngest`'s `--no-verify-jwt` deployment as the
pattern for the third).

1. **`create-checkout-session`** (`verify_jwt: true`) — forwards the
   caller's JWT so RLS confirms they're the org's owner (mirrors
   `ai-rota-assistant`'s pattern, not `service_role`). Input: `org_id`,
   `plan_code`. Looks up `plans.stripe_price_id` for the code, creates (or
   reuses, via `subscriptions.stripe_customer_id`) a Stripe Customer,
   creates a Checkout Session (`mode: 'subscription'`, the one price,
   quantity 1, success/cancel URLs back to `/app/settings/billing`).
   Returns `{ url }`; client does a full-page redirect, no Stripe.js needed.

2. **`create-portal-session`** (`verify_jwt: true`) — same JWT-forwarding
   pattern. Looks up the caller's org's `subscriptions.stripe_customer_id`;
   404s with a clear message if none exists yet (never subscribed). Creates
   a Stripe Billing Portal session, returns `{ url }`.

3. **`stripe-webhook`** (`verify_jwt: false`) — Stripe's own signature
   (`STRIPE_WEBHOOK_SECRET`, verified via `stripe.webhooks.constructEvent`)
   is the only authentication, exactly like `inngest`'s own signing-key
   check; Supabase's gateway JWT check would only ever reject Stripe's real
   requests. Uses the `service_role` client — legitimately, since there is
   no end-user session for a provider webhook to forward. Handles:
   - `checkout.session.completed` → upsert `subscriptions` keyed on
     `org_id` (from Checkout Session metadata, set when the session was
     created): `provider='stripe'`, `provider_ref=<subscription id>`,
     `stripe_customer_id`, `plan`, `status='active'`, `started_at`,
     `current_period_end`.
   - `customer.subscription.updated` → sync `status`/`plan`/`current_period_end`/`canceled_at`.
   - `customer.subscription.deleted` → `status='canceled'`, `canceled_at`.
   - `invoice.paid` → insert into `invoices`: `provider='stripe'`,
     `provider_ref=<stripe invoice id>`, `org_id`, `period_start`/`period_end`
     (from the Stripe invoice's line items), `amount_pence`, `status='paid'`,
     `paid_at`, `issued_on`, `due_on`. This is a **second writer** into
     `invoices` alongside the existing manual `issue_invoice()`/
     `set_invoice_status()` RPCs (platform-finance-issued invoices stay a
     separate, still-manual path — e.g. for off-Stripe deals). Idempotent:
     upsert keyed on `provider_ref`, safe against Stripe's at-least-once
     delivery.
   - `invoice.payment_failed` → update the matching invoice
     (`status='past_due'`, `failure_reason` from Stripe's own message,
     `attempts += 1`), and the subscription (`status='past_due'`).

### Secrets

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Supabase Edge Function
secrets (`supabase secrets set`), never in `.env`/`.env.example` — there is
no client-side Stripe key needed at all, since Checkout/Portal are both
server-created redirects, no Stripe.js in the browser.

### Client changes

- `SettingsBillingPage.tsx`: replace the "Payment" `SettingsSection` stub.
  - No active subscription: render the 4 plans (from a new org-facing
    `listPlans()` — `plans` is already `select`-able by any signed-in user
    per 0023's RLS) with an "Upgrade" button per tier, calling
    `create-checkout-session` and redirecting to the returned URL.
  - Active subscription: render current plan (existing code, unchanged)
    plus one "Manage billing" button calling `create-portal-session` and
    redirecting.
- New service functions in `subscriptionService.ts` (or a new
  `billingCheckoutService.ts` to keep the platform-console-scoped
  `services/billingService.ts` distinct from this org-facing one — naming
  TBD at implementation time, not a design-level decision).

### Marketing copy

- `src/lib/marketing.ts`'s `PLANS` array rewritten to the real 4 tiers and
  real prices. Prefer fetching from `plans` at build/runtime over a second
  hardcoded copy if `PricingPage.tsx`'s rendering allows it without a
  significant restructure; if that's a bigger change than warranted here,
  hardcode the matching numbers with a comment pointing at 0023 as the
  source of truth, and accept the duplication as a known, documented seam.
- `SettingsBillingPage.tsx`'s `PLAN_NAMES` map: add the missing `'enterprise'`
  key (currently only has starter/professional/business).
- `docs/SCHEMA.md`'s line "Provider is pluggable (Apple Pay / Google Pay /
  PayPal); charging is built last" corrected to reflect Stripe.

## Data flow

Org owner → Settings → Billing → sees no active subscription → picks a plan
→ `create-checkout-session` → Stripe Checkout (hosted) → pays with a test
card → Stripe fires `checkout.session.completed` → webhook upserts
`subscriptions` → owner is redirected back, sees the active plan. On each
billing cycle, Stripe fires `invoice.paid` → webhook writes a real
`invoices` row → Platform Console's MRR/revenue screens (`AdminBillingPage`,
`AdminSubscriptionsPage`, already built against this exact table) go from
permanently-zero to real, with no changes needed on that side.

## Error handling

- Webhook signature verification failure → reject with 400, `reportError`
  to Sentry, no DB write attempted.
- `create-checkout-session` called for a plan with no `stripe_price_id` set
  yet → clear "this plan isn't available for checkout yet" error, not a raw
  Stripe API error surfaced to the owner.
- `create-portal-session` called with no `stripe_customer_id` on file →
  404 with a clear message; client hides/disables the "Manage billing"
  button until a real subscription exists rather than showing a dead end.
- All webhook DB writes are upserts keyed on Stripe's own id
  (`provider_ref`), so Stripe's documented at-least-once retry behavior
  cannot create duplicate subscriptions or invoices.

## Testing

- Local: Stripe CLI (`stripe listen --forward-to <local-or-dev-function-url>`)
  against the dev Supabase project's `stripe-webhook` function, using
  Stripe's documented test cards.
- Manual QA pass before considering this done: full checkout in Stripe test
  mode for at least one plan, confirm the resulting `subscriptions` row,
  confirm a subsequent `invoice.paid` test event produces a real `invoices`
  row, confirm `AdminBillingPage`'s MRR figure reflects it, confirm the
  Portal session opens and shows the same subscription/invoice.

## Explicitly out of scope (not silently dropped)

- Trial-on-signup automation (subscription auto-created at org creation,
  trial length, expiry behavior) — a real product decision of its own,
  deferred.
- `plans.seat_limit`/`location_limit` enforcement in `staffService`/
  `locationService` — deferred; caps remain informational only.
- Any custom in-app invoice list or payment-method UI — using Stripe's
  Portal instead, per the decision above.
- Reconciling `marketing.ts`'s old £2.50-per-seat framing anywhere beyond
  the `PLANS` array itself (e.g. any other page/copy that references
  per-seat pricing) — flag if found during implementation, not assumed
  exhaustive here.
