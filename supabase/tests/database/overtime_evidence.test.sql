-- =====================================================================
-- overtime_evidence.test.sql — CAP-087
--
-- `overtime_requests.hours` is a number somebody types, and nothing has
-- ever compared it to anything. The row goes to payroll.
--
-- `overtime_evidence` does not replace the typed number — clock data is
-- least complete exactly when overtime happens, and a derived figure
-- would be the authoritative-looking wrong answer. It gives an approver
-- something to judge against.
--
--   1. a straightforward in/out pair is counted;
--   2. the scheduled minutes come back net of the break, because that
--      is what "scheduled to work" means on a payslip;
--   3. two pairs in a day are added, not overwritten;
--   4. an UNPAIRED `in` — the forgotten clock-out, and the single most
--      likely gap on exactly the day somebody stayed late — contributes
--      no minutes and is REPORTED. "They worked nothing" and "we do not
--      know" must be distinguishable;
--   5. a cancelled shift is not scheduled time;
--   6. a different day's events do not leak into this one;
--   7. a non-member cannot read it at all — this is one person's
--      attendance, the kind of row cross-tenant isolation exists for.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('d0111111-1111-1111-1111-111111111111'::uuid, 'owner-ot@example.test'),
  ('d0222222-2222-2222-2222-222222222222'::uuid, 'outsider-ot@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('d0000000-0000-0000-0000-000000000001', 'Org OT', 'org-overtime',
   'd0111111-1111-1111-1111-111111111111', 'enterprise'),
  ('d0000000-0000-0000-0000-000000000002', 'Org Other', 'org-overtime-other',
   'd0222222-2222-2222-2222-222222222222', 'enterprise');

insert into public.locations (id, org_id, name, timezone) values
  ('d0100000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'Ward A', 'Europe/London');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('d0200000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'Ada', 'Overtime');

-- A scheduled 09:00-17:00 with a 30-minute break: 450 minutes of paid time.
-- Fixed winter dates, so British Summer Time cannot shift the day boundary
-- under the test.
insert into public.shifts
  (id, org_id, location_id, staff_profile_id, starts_at, ends_at, break_minutes, status)
values
  ('d0300000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'd0100000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   timestamptz '2027-01-12 09:00+00', timestamptz '2027-01-12 17:00+00', 30, 'assigned'),
  -- Cancelled, and on the same day: it must not count as scheduled time.
  ('d0300000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'd0100000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   timestamptz '2027-01-12 18:00+00', timestamptz '2027-01-12 22:00+00', 0, 'cancelled');

-- Worked 08:45-17:30 (525 minutes), then came back 18:30-19:30 (60).
insert into public.clock_events (org_id, staff_profile_id, type, event_at) values
  ('d0000000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   'in',  timestamptz '2027-01-12 08:45+00'),
  ('d0000000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   'out', timestamptz '2027-01-12 17:30+00'),
  ('d0000000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   'in',  timestamptz '2027-01-12 18:30+00'),
  ('d0000000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   'out', timestamptz '2027-01-12 19:30+00'),
  -- A different day entirely.
  ('d0000000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   'in',  timestamptz '2027-01-13 09:00+00'),
  ('d0000000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   'out', timestamptz '2027-01-13 17:00+00');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd0111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select worked_minutes from public.overtime_evidence(
     'd0000000-0000-0000-0000-000000000001',
     'd0200000-0000-0000-0000-000000000001', date '2027-01-12')),
  585,
  'both pairs are counted — 525 plus 60, not just the first'
);

select is(
  (select scheduled_minutes from public.overtime_evidence(
     'd0000000-0000-0000-0000-000000000001',
     'd0200000-0000-0000-0000-000000000001', date '2027-01-12')),
  450,
  'scheduled time is net of the break, and the cancelled shift is not scheduled'
);

select is(
  (select unpaired_events from public.overtime_evidence(
     'd0000000-0000-0000-0000-000000000001',
     'd0200000-0000-0000-0000-000000000001', date '2027-01-12')),
  0,
  'nothing is unpaired on a tidy day'
);

select is(
  (select worked_minutes from public.overtime_evidence(
     'd0000000-0000-0000-0000-000000000001',
     'd0200000-0000-0000-0000-000000000001', date '2027-01-13')),
  480,
  'another day is counted on its own, with no leakage from the day before'
);

reset role;

-- The forgotten clock-out, on its own day.
insert into public.clock_events (org_id, staff_profile_id, type, event_at) values
  ('d0000000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
   'in', timestamptz '2027-01-14 09:00+00');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd0111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select worked_minutes from public.overtime_evidence(
     'd0000000-0000-0000-0000-000000000001',
     'd0200000-0000-0000-0000-000000000001', date '2027-01-14')),
  0,
  'an unpaired in contributes no minutes rather than running to midnight'
);

select is(
  (select unpaired_events from public.overtime_evidence(
     'd0000000-0000-0000-0000-000000000001',
     'd0200000-0000-0000-0000-000000000001', date '2027-01-14')),
  1,
  'and it is REPORTED — "worked nothing" and "we do not know" are different answers'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'd0222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$select * from public.overtime_evidence(
      'd0000000-0000-0000-0000-000000000001',
      'd0200000-0000-0000-0000-000000000001', date '2027-01-12')$$,
  '42501',
  'Not permitted',
  'somebody outside the organisation cannot read one of its people''s attendance'
);

reset role;
select * from finish();
rollback;
