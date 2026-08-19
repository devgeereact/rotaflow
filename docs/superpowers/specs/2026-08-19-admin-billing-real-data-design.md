# Admin console: real billing/revenue data — design spec

Status: approved by user 2026-08-19, pending implementation plan.

## Context

`src/lib/adminOverviewDemo.ts` (1285 lines) is fabricated placeholder data
that predates this session's Stripe billing work (`0023_commercials.sql`'s
`plans`/`invoices` tables, `subscription_mrr_pence()`, and the checkout/
portal/webhook Edge Functions from PR #117). Its own header comment claims
"no payment provider is connected... there is nothing to total" — no longer
true. It is imported live into 7 authenticated Platform Console pages, so
whoever uses the console today sees invented MRR, churn, and revenue figures
presented as real.

The full file spans ~13 distinct product areas (Overview, Organisations,
Users, Subscriptions/Billing, Support, Platform Health, Integrations,
Notifications, Feature Flags, GDPR, Platform Settings, Org/User detail,
Incidents) — too large for one design. This spec covers **billing/revenue
only**: the one domain where real infrastructure already exists end-to-end
from this session's Stripe work, and the highest-value piece to fix first.

## Decisions made during brainstorming (with the user, 2026-08-19)

| Question | Decision |
|---|---|
| Trend charts with <12 months of real history | Honest empty state ("not enough history yet") until 3 real months of invoice data exist, then a real (however short) line — never padded/fabricated |
| Dunning/failed-payment policy copy | Not just a display change — configure real Stripe Smart Retries (days 1/3/7) to match the copy, and extend the webhook to actually suspend an organisation when dunning is exhausted (not just leave the subscription canceled) |
| Churn definition | Revenue churn: lost MRR ÷ MRR-at-period-start (not logo/count-based churn) |
| `set_org_status()` permission check blocks the webhook | `set_org_status()` (0017) requires `has_platform_role()`, which resolves via `auth.uid()` — `null` in the webhook's `service_role` context, so it would always fail. Confirmed with the user: extend the permission check to also accept a `service_role` caller (`auth.uid() is null`), matching the exact pattern `audit_write()` already uses in this codebase. Keeps the real `'org.suspended'` critical-severity audit entry intact rather than bypassing the function with a raw `UPDATE`. |

## Scope

**In scope** (all in `src/pages/admin/AdminOverviewPage.tsx`,
`AdminSubscriptionsPage.tsx`, and the MRR line in
`AdminOrganisationDetailPage.tsx`):

- Overview: monthly revenue tile + trend, subscription mix (donut by plan),
  churn line on the growth chart
- Subscriptions: MRR, MRR change, ARR, active/trialing/past-due counts (+
  hints), churn rate + change, collected/outstanding/refunds + hints, ARPO,
  revenue by plan, invoices list, failed payments list, dunning note
- Org Detail: the single MRR line (`DEMO_ORG_MRR`)
- `stripe-webhook`'s `customer.subscription.deleted` handler: distinguish
  dunning-exhaustion cancellation from voluntary cancellation, suspend the
  org on the former

**Explicitly out of scope** (separate future sub-projects, not touched
here): `DEMO_ORG_PROFILE`/`DEMO_ORG_STORAGE`/`DEMO_USER_ACCOUNT` (org/user
detail fields beyond MRR), org health scoring, everything in Support,
Platform Health, Integrations, Notifications, Feature Flags, GDPR,
Platform Settings, Incidents, and Users pages.

## Architecture

### New pure-logic module: `src/lib/billingMetrics.ts`

Mirrors the existing pattern (`src/lib/revenue.ts` already has
`monthlyRecurringPence`/`annualRunRatePence`/etc. for the *platform-wide*
Subscriptions page — reuse those directly rather than duplicating). New
functions needed there or in `revenue.ts` (implementer's call which file,
based on what's already there — read `revenue.ts` first):

- `revenueChurnRate(subscriptions, invoices, monthStart, monthEnd): number` —
  sum `subscription_mrr_pence`-equivalent for subs with `canceled_at` in
  the window, divide by total MRR at window start. Pure function, unit
  tested like every other file in `src/lib`.
- `monthlyTrend(invoices, minMonths = 3): { month: string, pence: number
  }[] | null` — returns `null` (→ empty state) when fewer than
  `minMonths` distinct months of `status='paid'` invoices exist, otherwise
  one point per real month.

### Data layer: extend `src/services/billingService.ts` (already exists,
platform-console-scoped, has `listPlans`/`listInvoices`) with whatever
aggregate queries the above two pages need — e.g. `getSubscriptionCounts()`,
`getRevenueByPlan()`. Follow that file's existing pattern (thin Supabase
query wrappers, `Tables<'...'>` types).

### Client pages

`AdminOverviewPage.tsx`, `AdminSubscriptionsPage.tsx`,
`AdminOrganisationDetailPage.tsx`: replace each `DEMO_*` import with a real
query result (loaded via `Promise.all` alongside whatever they already
load) or a real computed value from `billingMetrics.ts`. Where
`monthlyTrend` returns `null`, render the existing empty-state pattern used
elsewhere in this codebase (e.g. `SettingsBillingPage.tsx`'s "not connected
yet" card) — a real message explaining *why* the chart is empty, not a
broken-looking blank chart.

### Schema change: `supabase/migrations/0051_org_status_service_role.sql`
(exact number TBD at implementation time, next free one)

`set_org_status(p_org, p_status, p_reason)` (0017) currently only accepts
`has_platform_role(['platform_owner','platform_admin'])`. Extend the
permission check:

```sql
if not (
  public.has_platform_role(array['platform_owner','platform_admin'])
  or auth.uid() is null  -- service_role caller (e.g. stripe-webhook after
                          -- dunning is exhausted) — no user JWT exists to
                          -- check, matches audit_write()'s own convention
) then
  raise exception 'Only a platform owner or administrator can change an organisation''s status'
    using errcode = '42501';
end if;
```

Everything else about the function (the reason-length requirement, the
idempotency short-circuit, the `audit_write` call) stays exactly as-is —
the webhook calls it exactly the way an authenticated platform admin would,
just with `p_reason` set to something like `'Stripe dunning exhausted after
N attempts'`. `grant execute ... to service_role` may also be needed
depending on whether this Supabase project's `service_role` already
bypasses function-level grants the way it bypasses RLS — confirm at
implementation time (a quick call from a scratch Edge Function or the
Management API's SQL endpoint settles it) rather than assuming either way.

### Webhook change: `supabase/functions/stripe-webhook/index.ts`

`handleSubscriptionDeleted` currently just sets `status='canceled'` in
`subscriptions`. Extend it to read the Stripe `Subscription` object's
cancellation reason (Stripe's `cancellation_details.reason` field —
**verify this exact field name and shape against the pinned API version,
`2025-02-24.acacia`, during implementation via `deno check` and the
installed package types, the same way this session's other Stripe fields
were verified; do not assume it without checking**). If the reason
indicates payment failure (dunning exhausted), call
`public.set_org_status(org_id, 'suspended', 'Stripe dunning exhausted...')`
via RPC in the same handler, after the existing `subscriptions` update —
not a raw `UPDATE organisations`, per the decision above.

### Stripe dashboard config (manual, by the user, not code)

Configure Smart Retries in Stripe Dashboard → Settings → Billing → Manage
failed payments: retry schedule days 1, 3, 7, then mark the invoice
uncollectible / cancel the subscription on day 14 (whichever Stripe's UI
calls the terminal action — implementer/user confirms exact wording at
config time). This is what makes the webhook's `payment_failed` branch
above actually fire, and what makes the Failed Payments section's copy
factually true instead of aspirational.

## Data flow

Real invoice/subscription data already flows in via the existing
`stripe-webhook` (Task 5 of the original Stripe billing plan) — this
sub-project adds no new data sources, only new *readers* of data that
already exists, plus the one webhook extension above for dunning-driven
suspension.

## Error handling

- `monthlyTrend`/`revenueChurnRate` are pure functions over already-fetched
  data — no new error paths, existing page-level `.catch()` patterns cover
  fetch failures the same way they already do for real fields on these
  pages.
- The webhook's org-suspension update follows the same pattern already
  established in that file: `if (error) throw new Error(...)`, letting the
  outer handler return 500 so Stripe retries (per the earlier fix in
  PR #117's final review).

## Testing

- `billingMetrics.ts` (or wherever the functions land) gets real unit
  tests — this codebase's actual convention (`src/lib/revenue.test.ts`
  already exists and is the pattern to extend/mirror), covering: the
  3-month empty-state threshold exactly at the boundary (2 months → null,
  3 months → real data), revenue churn's calculation against a hand-worked
  example, and edge cases (zero subscriptions, all-trialing org).
- No test precedent for `src/pages/admin/*.tsx` or `src/services/*.ts` in
  this codebase (confirmed repeatedly earlier this session) — verification
  for those is `npm run typecheck` plus a manual Platform Console check,
  not new test files.
- The webhook change: `deno check`, manual review (this file has no
  automated test precedent either, per repo convention), and a real
  end-to-end check once Smart Retries is configured — trigger a real
  test-mode payment failure through to exhaustion and confirm the org
  actually gets suspended, not just that the code compiles.
- The `set_org_status()` permission-check migration: verify live (matching
  this session's own established practice) that a platform admin's own
  call still requires their role — the new `or auth.uid() is null` branch
  must not accidentally admit `anon`/`authenticated` callers with no
  platform role. Test both paths after applying: an authenticated
  non-admin call still 42501s, and a service_role call (simulated via the
  Management API's SQL endpoint, which runs with elevated privilege)
  succeeds.

## Explicitly out of scope (not silently dropped)

- Everything listed under "Explicitly out of scope" in the Scope section
  above — separate future sub-projects.
- Any change to how RotaFlow enforces `organisations.status = 'suspended'`
  elsewhere in the app (login gating, etc.) — if suspension doesn't already
  block a suspended org's users from working, that's a pre-existing gap
  this sub-project surfaces but does not fix.
