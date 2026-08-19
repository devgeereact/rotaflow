-- =====================================================================
-- 0050_stripe_billing.sql — the two columns Stripe checkout/portal need
--
-- plans and invoices (0023) and subscriptions' provider/provider_ref seam
-- (0003) already fit a real payment provider. Two things are missing:
-- which Stripe Price each plan sells as (plans has no such column), and
-- which Stripe Customer an org is (subscriptions.provider_ref holds the
-- *subscription* id once one exists, but a Portal session needs the
-- customer id even between subscriptions — e.g. after a cancellation,
-- before a resubscribe, when provider_ref is null but the customer still
-- exists on Stripe's side).
-- =====================================================================

alter table public.plans
  add column if not exists stripe_price_id text;

comment on column public.plans.stripe_price_id is
  'The Stripe Price this plan checks out as. Null until created in Stripe and backfilled by hand — see docs/superpowers/plans/2026-08-15-stripe-billing-integration.md Task 9.';

alter table public.subscriptions
  add column if not exists stripe_customer_id text;

comment on column public.subscriptions.stripe_customer_id is
  'Stripe Customer id, set on first checkout. Survives cancellation (unlike provider_ref, which is the subscription id and goes stale once the subscription ends) so a Portal session can still be created for a former subscriber.';
