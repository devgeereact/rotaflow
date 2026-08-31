-- =====================================================================
-- repeat_rota_weeks.test.sql — CAP-006
--
-- The builder had copy-previous-week and a single duplicate, so a
-- quarter meant twelve rounds of copy, navigate, paste.
--
--   1. it creates the weeks;
--   2. and the shifts in them;
--   3. a shift keeps its LOCAL time across the clocks changing. Doing
--      the arithmetic in UTC would move a 07:00 shift to 08:00 after the
--      last Sunday in March, which is the kind of wrong nobody notices
--      until somebody turns up late;
--   4. a cancelled shift is not repeated;
--   5. an assigned one keeps its person — repeating it unassigned would
--      make the feature useless for the case it exists for;
--   6. a week with a PUBLISHED rota is skipped and counted, never
--      written to: staff are working to it;
--   7. a week whose draft already has work in it is skipped too —
--      merging was not asked for, and two of every shift is the worst
--      possible answer;
--   8. a staff member cannot repeat a rota;
--   9. nor can anybody ask for more than 26 weeks from one click.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('f1111111-1111-1111-1111-111111111111'::uuid, 'owner-rep@example.test'),
  ('f2222222-2222-2222-2222-222222222222'::uuid, 'staff-rep@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('f1000000-0000-0000-0000-000000000001', 'Org Rep', 'org-rep',
   'f1111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('f1000000-0000-0000-0000-000000000001', 'f2222222-2222-2222-2222-222222222222', 'staff')
on conflict do nothing;

insert into public.locations (id, org_id, name, timezone) values
  ('f1100000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'Ward D', 'Europe/London');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('f1200000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'Rep', 'Person');

-- The source week is chosen to straddle the March clock change: 2027-03-22
-- to 2027-03-28, with the change on Sunday 2027-03-28. Repeating it once
-- lands the copies AFTER the change.
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('f1300000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'f1100000-0000-0000-0000-000000000001', 'Source week',
   '2027-03-22', '2027-03-28', 'draft', 'f1111111-1111-1111-1111-111111111111');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
values
  -- 07:00 local on Monday 22 March, which is 07:00 UTC (GMT).
  ('f1400000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'f1300000-0000-0000-0000-000000000001', 'f1100000-0000-0000-0000-000000000001',
   'f1200000-0000-0000-0000-000000000001',
   '2027-03-22T07:00:00Z', '2027-03-22T15:00:00Z', 'assigned'),
  ('f1400000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001',
   'f1300000-0000-0000-0000-000000000001', 'f1100000-0000-0000-0000-000000000001',
   null,
   '2027-03-23T07:00:00Z', '2027-03-23T15:00:00Z', 'cancelled');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

create temporary table repeated on commit drop as
select * from public.repeat_rota_weeks('f1300000-0000-0000-0000-000000000001', 2);

select is(
  (select weeks_created from repeated),
  2,
  'it creates the weeks'
);

select is(
  (select shifts_created from repeated),
  2,
  'and one shift in each — the cancelled one is not repeated'
);

-- The assertion this design turns on. 29 March 2027 is BST, so 07:00 local
-- is 06:00 UTC. Adding 7 days in UTC would have produced 07:00 UTC, which
-- is 08:00 on the ward.
select is(
  (select s.starts_at from public.shifts s
     join public.rotas r on r.id = s.rota_id
    where r.period_start = '2027-03-29'),
  '2027-03-29T06:00:00Z'::timestamptz,
  'a 07:00 shift is still 07:00 on the ward after the clocks change'
);

select is(
  (select count(*)::int from public.shifts s
     join public.rotas r on r.id = s.rota_id
    where r.period_start = '2027-03-29' and s.status = 'cancelled'),
  0,
  'a cancelled shift is not repeated'
);

select is(
  (select s.staff_profile_id from public.shifts s
     join public.rotas r on r.id = s.rota_id
    where r.period_start = '2027-03-29'),
  'f1200000-0000-0000-0000-000000000001'::uuid,
  'and an assigned shift keeps its person'
);

-- ── what it will not write over ───────────────────────────────────────

reset role;
insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('f1300000-0000-0000-0000-000000000009', 'f1000000-0000-0000-0000-000000000001',
   'f1100000-0000-0000-0000-000000000001', 'Already published',
   '2027-04-19', '2027-04-25', 'published', 'f1111111-1111-1111-1111-111111111111');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

-- Repeating four weeks now hits three weeks it must not touch: the two
-- drafts the first repeat filled, and the published one.
select is(
  (select weeks_skipped from public.repeat_rota_weeks(
     'f1300000-0000-0000-0000-000000000001', 4)),
  3,
  'a published week is skipped and counted, and so is a draft already holding work'
);

select is(
  (select count(*)::int from public.shifts s
     join public.rotas r on r.id = s.rota_id
    where r.id = 'f1300000-0000-0000-0000-000000000009'),
  0,
  'nothing was written into the published week'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select * from public.repeat_rota_weeks('f1300000-0000-0000-0000-000000000001', 1) $$,
  '42501',
  'Only an owner or manager may repeat a rota',
  'a staff member cannot repeat a rota'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'f1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ select * from public.repeat_rota_weeks('f1300000-0000-0000-0000-000000000001', 200) $$,
  '22023',
  'Repeat between 1 and 26 weeks',
  'and nobody writes half a year of rows from one click'
);

select * from finish();
rollback;
