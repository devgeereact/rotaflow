-- =====================================================================
-- 0125 · A billing event is processed once, in one namespace
--
-- Closes the 5 September 2026 audit's RF-04 and RF-05.
--
-- RF-04. The webhook kept no record of which Stripe events it had seen.
-- Stripe documents delivery as at-least-once and explicitly unordered, so
-- the handler had to be idempotent and was not: `invoice.payment_failed`
-- wrote `past_due` and incremented `attempts` unconditionally. The audit
-- replayed `invoice.paid`, then an OLDER `invoice.payment_failed`, then that
-- same failure again, and the organisation finished `past_due` with
-- `attempts = 2` and `paid_at` still set — a paid customer suspended by a
-- redelivery of a failure they had already recovered from, and a dunning
-- count inflated by Stripe's own retry of its webhook rather than by a
-- second attempt on the card.
--
-- RF-05. `handleInvoicePaymentFailed` updated `subscriptions` filtered on
-- `org_id` alone, while the handler deliberately accepts events from BOTH
-- Stripe modes at one URL. A test-mode fixture carrying a live
-- organisation's id in its metadata could therefore mark that live
-- subscription past due, and an invoice belonging to a replaced
-- subscription could suspend its replacement. Every other handler in the
-- file already scoped by `provider_ref`; this one did not.
--
-- What this migration adds is the receipt. The handler records an event
-- before acting on it and marks it processed only once its effects have
-- committed, so a crash between the two leaves the event visibly unfinished
-- and Stripe's retry completes it, while a duplicate of an event already
-- finished is acknowledged and does nothing.
--
-- SAFETY(additive): one new table, one new function. Nothing existing is
-- altered or removed.
-- =====================================================================

create table if not exists public.billing_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'stripe',
  -- Test and live events arrive at the same URL and are both processed.
  -- Without the mode in the key, a test event and a live event that shared
  -- an id would be treated as the same delivery.
  mode         text not null check (mode in ('test', 'live')),
  event_id     text not null,
  event_type   text not null,
  org_id       uuid references public.organisations(id) on delete set null,
  -- Stripe's own `created`, not our receipt time. This is what makes
  -- "is this event older than what we have already applied?" answerable,
  -- which is the whole of the out-of-order defence.
  event_created_at timestamptz,
  received_at  timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  deliveries   integer not null default 1 check (deliveries >= 1),
  last_error   text,

  constraint billing_events_identity unique (provider, mode, event_id)
);

comment on table public.billing_events is
  'One row per webhook event Stripe has delivered, keyed by provider, mode and event id. processed_at null means received but not finished: a crash between receipt and commit, which Stripe''s retry completes. Not tenant content — see the exclusion note in orgLifecycleService.';
comment on column public.billing_events.deliveries is
  'How many times Stripe delivered this same event. Distinct from invoices.attempts, which counts attempts on the CARD. Conflating the two is RF-04: a webhook retry inflated the dunning count.';
comment on column public.billing_events.processed_at is
  'Set only after the event''s database effects have committed. An event with a null value here has not been applied and may be safely reapplied.';

create index if not exists billing_events_org_idx
  on public.billing_events (org_id, received_at desc);
create index if not exists billing_events_unprocessed_idx
  on public.billing_events (received_at)
  where processed_at is null;

-- RLS on, and no grant to anyone but service_role. The webhook is the only
-- writer and there is no screen that reads this: it is an operational
-- ledger, and a tenant reading another tenant's delivery history would be a
-- disclosure with no upside. `rls_invariants` requires a policy only for a
-- table `authenticated` can read, and it cannot.
alter table public.billing_events enable row level security;
revoke all on public.billing_events from public, anon, authenticated;
grant select, insert, update on public.billing_events to service_role;

-- ── Claiming an event ────────────────────────────────────────────────
-- Returns true when the caller should process this event, false when it has
-- already been processed to completion. A redelivery of an unfinished event
-- returns true, because finishing it is exactly what the retry is for.
create or replace function public.claim_billing_event(
  p_provider   text,
  p_mode       text,
  p_event_id   text,
  p_event_type text,
  p_org        uuid,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_processed timestamptz;
begin
  insert into public.billing_events (
    provider, mode, event_id, event_type, org_id, event_created_at)
  values (p_provider, p_mode, p_event_id, p_event_type, p_org, p_created_at)
  on conflict on constraint billing_events_identity do update
    set deliveries = public.billing_events.deliveries + 1,
        -- Keep the org and type from the first sighting unless they were
        -- unknown then; a redelivery carries the same payload.
        org_id     = coalesce(public.billing_events.org_id, excluded.org_id)
  returning processed_at into v_processed;

  return v_processed is null;
end;
$$;

comment on function public.claim_billing_event(text, text, text, text, uuid, timestamptz) is
  'Record a webhook delivery and say whether it still needs processing. False means an identical event has already been applied to completion, so the handler must do nothing and return 200 (RF-04).';

create or replace function public.complete_billing_event(
  p_provider text,
  p_mode     text,
  p_event_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.billing_events
     set processed_at = timezone('utc', now()), last_error = null
   where provider = p_provider and mode = p_mode and event_id = p_event_id;
$$;

create or replace function public.fail_billing_event(
  p_provider text,
  p_mode     text,
  p_event_id text,
  p_error    text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.billing_events
     set last_error = left(p_error, 2000)
   where provider = p_provider and mode = p_mode and event_id = p_event_id;
$$;

revoke all on function public.claim_billing_event(text, text, text, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_billing_event(text, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_billing_event(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_billing_event(text, text, text, text, uuid, timestamptz)
  to service_role;
grant execute on function public.complete_billing_event(text, text, text) to service_role;
grant execute on function public.fail_billing_event(text, text, text, text) to service_role;
