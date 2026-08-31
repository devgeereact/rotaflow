-- =====================================================================
-- half_day_leave.test.sql — CAP-085
--
-- Leave was counted in whole calendar days, so a Friday afternoon for an
-- appointment cost a whole day of somebody's allowance. Over a year that
-- is the difference between a balance people trust and one they replace
-- with a spreadsheet.
--
-- `leave_days()` mirrors `leaveDayCount` in the browser — two
-- implementations of one rule, which is a risk, so the cases here are
-- deliberately the same cases the unit tests use:
--
--   1. a whole range is unchanged;
--   2. half off the first day;
--   3. half off the last;
--   4. half off both;
--   5. a single day booked as both is still HALF a day, never zero — a
--      request costing nothing would pass every entitlement check ever
--      written;
--   6. the columns default to false, so every row that existed before
--      this migration means exactly what it meant yesterday;
--   7. and a reversed range is refused by the constraint rather than by
--      the client alone.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(7);

select is(public.leave_days('2026-09-07', '2026-09-11'), 5::numeric,
  'a whole range is unchanged');

select is(public.leave_days('2026-09-07', '2026-09-11', true, false), 4.5::numeric,
  'half off the first day');

select is(public.leave_days('2026-09-07', '2026-09-11', false, true), 4.5::numeric,
  'half off the last day');

select is(public.leave_days('2026-09-07', '2026-09-11', true, true), 4::numeric,
  'half off both');

select is(public.leave_days('2026-09-07', '2026-09-07', true, true), 0.5::numeric,
  'a single day booked as both is still half a day, never zero');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000',
  'd9111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
  'owner-half@example.test', 'x', now(), now(), now(),
  '{"provider":"email"}'::jsonb, '{}'::jsonb;

insert into public.organisations (id, name, slug, created_by, plan) values
  ('d9000000-0000-0000-0000-000000000001', 'Org Half', 'org-half',
   'd9111111-1111-1111-1111-111111111111', 'enterprise');

insert into public.staff_profiles (id, org_id, first_name, last_name) values
  ('d9200000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001',
   'Half', 'Person');

insert into public.leave_requests
  (id, org_id, staff_profile_id, type, start_date, end_date, status)
values
  ('d9300000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001',
   'd9200000-0000-0000-0000-000000000001', 'annual', '2026-09-07', '2026-09-11', 'approved');

select ok(
  (select not starts_half and not ends_half
     from public.leave_requests where id = 'd9300000-0000-0000-0000-000000000001'),
  'the columns default to false, so an existing row means what it always meant'
);

select throws_ok(
  $$ insert into public.leave_requests
       (org_id, staff_profile_id, type, start_date, end_date, status)
     values ('d9000000-0000-0000-0000-000000000001',
             'd9200000-0000-0000-0000-000000000001', 'annual',
             '2026-09-11', '2026-09-07', 'pending') $$,
  '23514',
  null,
  'a reversed range is refused by the database, not only by the form'
);

select * from finish();
rollback;
