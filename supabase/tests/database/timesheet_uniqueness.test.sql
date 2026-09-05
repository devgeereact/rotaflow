-- =====================================================================
-- timesheet_uniqueness.test.sql — regression guard for RF-07, fixed by
-- 0124_one_timesheet_decision_per_period.sql.
--
-- The audit ran the reverse of this against the live local database in a
-- rolled-back transaction: two `approved` rows for the same person and the
-- same week, one saying 480 minutes and the other 420, both accepted, no
-- 23505. `timesheets` had carried no unique key since 0002, and the client
-- compensated with a read-then-insert-or-update that two managers could
-- interleave freely.
--
-- The audit's diagnostic asserted the BAD outcome, so that a passing run
-- meant the defect reproduced. Inverted here: the duplicate must now be
-- rejected, and the batch approval must be all-or-nothing.
-- =====================================================================

begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '55555555-5555-5555-5555-555555555555',
  'authenticated', 'authenticated', 'timesheet-manager@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);

insert into public.organisations (name, slug, created_by)
values ('Timesheet Test Org', 'timesheet-test-org', '55555555-5555-5555-5555-555555555555');

insert into public.staff_profiles (org_id, first_name, last_name)
select (select id from public.organisations where slug = 'timesheet-test-org'), n, 'Worker'
  from (values ('Dee'), ('Eli')) as v(n);

-- A second organisation, to prove the batch cannot sign off somebody else's
-- staff by putting their id in the payload.
insert into public.organisations (name, slug, created_by)
values ('Other Org', 'timesheet-other-org', '55555555-5555-5555-5555-555555555555');
insert into public.staff_profiles (org_id, first_name, last_name)
values ((select id from public.organisations where slug = 'timesheet-other-org'), 'Outsider', 'Person');

-- ---------- 1. the key exists -----------------------------------------
select has_index(
  'public', 'timesheets', 'timesheets_period_unique',
  'the period key exists at all — its absence is the whole defect'
);

-- ---------- 2. a second decision for one week is refused ---------------
insert into public.timesheets (org_id, staff_profile_id, period_start, period_end, total_minutes, status)
select (select id from public.organisations where slug = 'timesheet-test-org'),
       (select id from public.staff_profiles where first_name = 'Dee'),
       '2026-09-07', '2026-09-13', 480, 'approved';

select throws_ok(
  $$ insert into public.timesheets (org_id, staff_profile_id, period_start, period_end, total_minutes, status)
     select (select id from public.organisations where slug = 'timesheet-test-org'),
            (select id from public.staff_profiles where first_name = 'Dee'),
            '2026-09-07', '2026-09-13', 420, 'approved' $$,
  '23505',
  null,
  'a second, disagreeing decision for the same person and week is refused'
);

select is(
  (select count(*)::int from public.timesheets
    where period_start = '2026-09-07'
      and staff_profile_id = (select id from public.staff_profiles where first_name = 'Dee')),
  1,
  'and exactly one decision stands'
);

select is(
  (select count(*)::int from public.timesheet_approval_conflicts),
  0,
  'the conflict view is empty, which is the only correct state'
);

-- ---------- 3. the batch is one transaction ---------------------------
delete from public.timesheets;

select is(
  (select count(*)::int from public.approve_timesheets(
     (select id from public.organisations where slug = 'timesheet-test-org'),
     '2026-09-14', '2026-09-20',
     jsonb_build_array(
       jsonb_build_object('staff_profile_id',
         (select id from public.staff_profiles where first_name = 'Dee'), 'total_minutes', 480),
       jsonb_build_object('staff_profile_id',
         (select id from public.staff_profiles where first_name = 'Eli'), 'total_minutes', 300)))),
  2,
  'a batch signs off everybody named in it'
);

select is(
  (select approved_by from public.timesheets
    where staff_profile_id = (select id from public.staff_profiles where first_name = 'Dee')),
  '55555555-5555-5555-5555-555555555555'::uuid,
  'and records who made the decision'
);

select is(
  (select version from public.timesheets
    where staff_profile_id = (select id from public.staff_profiles where first_name = 'Dee')),
  1,
  'a first approval is version 1'
);

-- ---------- 4. re-approval is a new decision, not a duplicate ----------
select is(
  (select total_minutes from public.approve_timesheets(
     (select id from public.organisations where slug = 'timesheet-test-org'),
     '2026-09-14', '2026-09-20',
     jsonb_build_array(jsonb_build_object('staff_profile_id',
       (select id from public.staff_profiles where first_name = 'Dee'), 'total_minutes', 460)))),
  460,
  'a second approval of the same week updates the standing decision'
);

select is(
  (select count(*)::int from public.timesheets
    where period_start = '2026-09-14'
      and staff_profile_id = (select id from public.staff_profiles where first_name = 'Dee')),
  1,
  'and does not create a second row — the concurrent case that produced RF-07'
);

select is(
  (select version from public.timesheets
    where period_start = '2026-09-14'
      and staff_profile_id = (select id from public.staff_profiles where first_name = 'Dee')),
  2,
  'the version count makes a re-approval after a clock correction visible'
);

-- ---------- 5. another organisation's staff cannot be signed off -------
select is(
  (select count(*)::int from public.approve_timesheets(
     (select id from public.organisations where slug = 'timesheet-test-org'),
     '2026-09-21', '2026-09-27',
     jsonb_build_array(jsonb_build_object('staff_profile_id',
       (select id from public.staff_profiles where first_name = 'Outsider'), 'total_minutes', 999)))),
  0,
  'a staff id from another organisation is filtered out, not trusted from the payload'
);

select * from finish();
rollback;
