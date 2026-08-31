-- =====================================================================
-- pay_rates.test.sql — CAP-086
--
-- There was no rate column anywhere, so every number the product
-- reported about a rota was a number of hours. The reason a rate is not
-- simply a column on `staff_profiles` is the first assertion here:
-- that table is readable by every colleague, so a rate on it would
-- publish everybody's pay to everybody.
--
--   1. a manager sees the organisation's rates;
--   2. a staff member sees their OWN rate;
--   3. and NOT a colleague's. This is the assertion the table's
--      existence is justified by;
--   4. a staff member cannot call `labour_cost` at all — the function
--      returns money derived from rates most people may not read, so
--      the role check is inside it as well as on the table;
--   5. the cost uses the rate in force ON THE DAY of the shift, not
--      today's. Without this a raise in April silently rewrites what
--      March cost, after March was reported;
--   6. breaks come out by default;
--   7. and stay in when the organisation pays them;
--   8. a person with no rate is COUNTED rather than treated as free —
--      a total that quietly prices somebody at zero is worse than no
--      total;
--   9. a draft rota is not costed: it is a working copy, and nobody has
--      committed to it;
--  10. nor is a cancelled shift;
--  11. `anon` can reach none of it.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('a1111111-1111-1111-1111-111111111111'::uuid, 'owner-pay@example.test'),
  ('a2222222-2222-2222-2222-222222222222'::uuid, 'staff-pay@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('a0000000-0000-0000-0000-000000000001', 'Org Pay', 'org-pay',
   'a1111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'staff')
on conflict do nothing;

insert into public.locations (id, org_id, name, timezone) values
  ('a0100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'Ward C', 'Europe/London');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('a0200000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a2222222-2222-2222-2222-222222222222', 'Sam', 'Staff'),
  ('a0200000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
   null, 'Unrated', 'Person');

-- Sam: £10/hour from January, £12/hour from June.
insert into public.staff_pay_rates
  (org_id, staff_profile_id, hourly_rate_pence, effective_from)
values
  ('a0000000-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000001',
   1000, '2026-01-01'),
  ('a0000000-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000001',
   1200, '2026-06-01');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('a0300000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0100000-0000-0000-0000-000000000001', 'March', '2026-03-01', '2026-03-07',
   'published', 'a1111111-1111-1111-1111-111111111111'),
  ('a0300000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'a0100000-0000-0000-0000-000000000001', 'Draft July', '2026-07-01', '2026-07-07',
   'draft', 'a1111111-1111-1111-1111-111111111111');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, break_minutes, status)
values
  -- March, 8 hours with a 60-minute break: 7 paid hours at £10 = £70.
  ('a0400000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0300000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
   'a0200000-0000-0000-0000-000000000001',
   '2026-03-02T09:00:00Z', '2026-03-02T17:00:00Z', 60, 'assigned'),
  -- Cancelled, same week.
  ('a0400000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
   'a0300000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
   'a0200000-0000-0000-0000-000000000001',
   '2026-03-03T09:00:00Z', '2026-03-03T17:00:00Z', 0, 'cancelled'),
  -- The unrated person, same week, 8 hours no break.
  ('a0400000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001',
   'a0300000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
   'a0200000-0000-0000-0000-000000000002',
   '2026-03-04T09:00:00Z', '2026-03-04T17:00:00Z', 0, 'assigned'),
  -- On the DRAFT rota.
  ('a0400000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001',
   'a0300000-0000-0000-0000-000000000002', 'a0100000-0000-0000-0000-000000000001',
   'a0200000-0000-0000-0000-000000000001',
   '2026-07-02T09:00:00Z', '2026-07-02T17:00:00Z', 0, 'assigned');

set local role authenticated;

-- ── who may read a rate ───────────────────────────────────────────────

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.staff_pay_rates),
  2,
  'a manager sees the organisation''s rates'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.staff_pay_rates
    where staff_profile_id = 'a0200000-0000-0000-0000-000000000001'),
  2,
  'a staff member sees their own rate history'
);

-- Give the colleague a rate they must not be able to see.
reset role;
insert into public.staff_pay_rates
  (org_id, staff_profile_id, hourly_rate_pence, effective_from)
-- Dated DECEMBER on purpose. The colleague must have a rate for the
-- visibility assertion below, and must still be unpriced in March for the
-- "counted, never silently free" one — a rate from January would have made
-- them rated for the whole test, which is how this was first written.
values ('a0000000-0000-0000-0000-000000000001', 'a0200000-0000-0000-0000-000000000002',
        9999, '2026-12-01');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.staff_pay_rates
    where staff_profile_id = 'a0200000-0000-0000-0000-000000000002'),
  0,
  'and NOT a colleague''s — the reason this is not a column on staff_profiles'
);

select throws_ok(
  $$ select * from public.labour_cost('a0000000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date, '2026-03-07'::date) $$,
  '42501',
  'Only an owner or manager may see labour cost',
  'a staff member cannot derive the rates by asking for the cost instead'
);

-- ── what a week costs ─────────────────────────────────────────────────

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select is(
  (select cost_pence from public.labour_cost(
     'a0000000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date, '2026-03-07'::date)),
  7000::bigint,
  'costed at the March rate, not the June one — a raise must not rewrite March'
);

select is(
  (select scheduled_minutes from public.labour_cost(
     'a0000000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date, '2026-03-07'::date)),
  900::bigint,
  'breaks come out: 7 paid hours plus the unrated person''s 8'
);

select is(
  (select scheduled_minutes from public.labour_cost(
     'a0000000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date, '2026-03-07'::date, true)),
  960::bigint,
  'and stay in when the organisation pays for them'
);

select is(
  (select unrated_staff from public.labour_cost(
     'a0000000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date, '2026-03-07'::date)),
  1,
  'a person with no rate is counted, never priced at zero in silence'
);

select is(
  (select count(*)::int from public.labour_cost(
     'a0000000-0000-0000-0000-000000000001'::uuid, '2026-07-01'::date, '2026-07-07'::date)),
  0,
  'a draft rota is not costed — nobody has committed to it'
);

select is(
  (select count(*)::int from public.shifts
    where id = 'a0400000-0000-0000-0000-000000000002' and status = 'cancelled'),
  1,
  'the cancelled shift is still there, and its £80 is not in the total above'
);

reset role;

select ok(
  not has_function_privilege('anon', 'public.labour_cost(uuid, date, date, boolean)', 'EXECUTE'),
  'anon can reach none of it'
);

select * from finish();
rollback;
