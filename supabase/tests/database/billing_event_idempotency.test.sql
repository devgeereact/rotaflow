-- =====================================================================
-- billing_event_idempotency.test.sql — regression guard for RF-04, fixed
-- by 0125_a_billing_event_is_processed_once.sql.
--
-- The webhook kept no record of which Stripe events it had already
-- applied. Stripe documents delivery as at-least-once and unordered, and
-- retries its own webhook until it receives a 200, so an event that
-- succeeded and then lost its response was applied a second time.
--
-- What this file holds is the ledger's contract, which is the half a unit
-- test cannot reach: the identity key spans provider, mode and event id;
-- a redelivery of a FINISHED event is refused; a redelivery of an
-- INTERRUPTED one is allowed, because completing it is what the retry is
-- for; and nothing but service_role can see any of it.
--
-- The decision logic itself — whether a failure applies at all, and how
-- attempts are counted — is in
-- `supabase/functions/stripe-webhook/reconcile.test.ts`.
-- =====================================================================

begin;
select plan(10);

-- ---------- the table is closed to tenants ---------------------------
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.billing_events'::regclass),
  'billing_events has row level security enabled'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'billing_events'
      and grantee in ('anon', 'authenticated')),
  0,
  'and no tenant role can read another tenant''s delivery history'
);

-- ---------- claiming ---------------------------------------------------
set local role service_role;

select ok(
  public.claim_billing_event('stripe', 'live', 'evt_1', 'invoice.paid',
                             null, '2026-09-01T10:00:00Z'),
  'a first delivery is claimed for processing'
);

select ok(
  public.claim_billing_event('stripe', 'live', 'evt_1', 'invoice.paid',
                             null, '2026-09-01T10:00:00Z'),
  'a redelivery of an UNFINISHED event is claimed again — finishing it is what the retry is for'
);

select is(
  (select deliveries from public.billing_events where event_id = 'evt_1'),
  2,
  'and the delivery count records that Stripe sent it twice'
);

select is(
  (select count(*)::int from public.billing_events where event_id = 'evt_1'),
  1,
  'without creating a second receipt'
);

-- ---------- completion is what closes it -------------------------------
select public.complete_billing_event('stripe', 'live', 'evt_1');

select ok(
  not public.claim_billing_event('stripe', 'live', 'evt_1', 'invoice.paid',
                                 null, '2026-09-01T10:00:00Z'),
  'a redelivery of a FINISHED event is refused, so its effects are not applied twice'
);

-- ---------- the modes are separate namespaces --------------------------
select ok(
  public.claim_billing_event('stripe', 'test', 'evt_1', 'invoice.paid',
                             null, '2026-09-01T10:00:00Z'),
  'a TEST event sharing an id with a finished LIVE one is a different event'
);

select is(
  (select count(*)::int from public.billing_events where event_id = 'evt_1'),
  2,
  'and gets its own receipt'
);

-- ---------- a failure leaves it open -----------------------------------
select public.claim_billing_event('stripe', 'live', 'evt_2', 'invoice.payment_failed',
                                  null, '2026-09-02T10:00:00Z');
select public.fail_billing_event('stripe', 'live', 'evt_2', 'database unavailable');

select ok(
  public.claim_billing_event('stripe', 'live', 'evt_2', 'invoice.payment_failed',
                             null, '2026-09-02T10:00:00Z'),
  'an event that failed mid-flight stays claimable, so Stripe''s retry completes it'
);

select * from finish();
rollback;
