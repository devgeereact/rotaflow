-- =====================================================================
-- 0058_stripe_dual_mode.sql — let Stripe test and live credentials
-- coexist, so billing can be exercised end to end without pointing the
-- production Edge Functions at a live key.
--
-- 0050 assumed a single Stripe mode: one `plans.stripe_price_id`, one
-- `subscriptions.stripe_customer_id`. Test and live are separate Stripe
-- namespaces — a test Price ID does not exist in live mode and vice
-- versa — so running a test checkout previously meant overwriting the
-- live Price IDs and then remembering to put them back. Forgetting is
-- silent until a real customer's checkout fails with "No such price".
--
-- Two columns fix that:
--
--   plans.stripe_test_price_id  — the test-mode twin of stripe_price_id.
--     STRIPE_MODE picks which one create-checkout-session reads, so
--     neither mode's IDs are ever overwritten to run the other.
--
--   subscriptions.stripe_mode   — which Stripe namespace this row's
--     stripe_customer_id and provider_ref belong to. A live customer id
--     handed to a test-mode Portal session is a "No such customer"
--     error, so the functions refuse to reuse a customer from the other
--     mode rather than failing at Stripe.
--
-- Existing rows predate test mode and are therefore live. The column
-- defaults to 'live' for exactly that reason: a backfill and the default
-- agree, so no existing subscription changes meaning.
-- =====================================================================

alter table public.plans
  add column if not exists stripe_test_price_id text;

comment on column public.plans.stripe_test_price_id is
  'The Stripe TEST-mode Price this plan checks out as, used when STRIPE_MODE=test. Null until the test-mode product is created in Stripe and backfilled by hand. Kept separate from stripe_price_id so a QA run never overwrites the live Price ID.';

alter table public.subscriptions
  add column if not exists stripe_mode text not null default 'live';

alter table public.subscriptions
  drop constraint if exists subscriptions_stripe_mode_check;

alter table public.subscriptions
  add constraint subscriptions_stripe_mode_check
  check (stripe_mode in ('test', 'live'));

comment on column public.subscriptions.stripe_mode is
  'Which Stripe namespace stripe_customer_id and provider_ref belong to: test or live. Written by the stripe-webhook function from the event''s own livemode flag. create-checkout-session and create-portal-session refuse to reuse a customer recorded under the other mode, because Stripe would reject it as "No such customer".';
