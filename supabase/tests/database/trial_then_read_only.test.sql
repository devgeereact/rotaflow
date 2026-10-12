-- =====================================================================
-- trial_then_read_only.test.sql: a trial, then a plan or read-only
-- (owner decision D2, 0154, docs/SAAS.md CAP-125)
--
-- What has to hold:
--
--   1. a new organisation starts a 30-day trial on Professional limits,
--      set by the server, and is not read-only;
--   2. when the trial ends with nothing paid, the organisation is
--      read-only: a manager cannot create a rota, add a shift, publish or
--      invite, and each refusal carries SQLSTATE BILL1;
--   3. staff can still clock in and ask for leave, so real work is kept;
--   4. plan features stop, so the AI assistant cannot be called;
--   5. a job with no JWT (pg_cron) is never held to the plan;
--   6. an active subscription lifts read-only and the plan follows it.
--
-- Shown to fail on the real defect: with 0154 reverted, assertion 1 reads
-- 'starter' and every BILL1 assertion succeeds as a write instead.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('7a000000-0000-0000-0000-0000000000a1'::uuid, 'owner-trial@example.test'),
  ('7a000000-0000-0000-0000-0000000000a2'::uuid, 'staff-trial@example.test')
) as v(id, email);

-- ---------- 1. Created by the owner, through the browser's own grant ----
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '7a000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true);

insert into public.organisations (id, name, slug, created_by)
values ('7a001000-0000-0000-0000-0000000000a0', 'Trial Care Ltd', 'trial-care',
        '7a000000-0000-0000-0000-0000000000a1');

select is(
  (select plan from public.organisations where id = '7a001000-0000-0000-0000-0000000000a0'),
  'professional',
  'a new organisation has Professional limits for its trial'
);

select ok(
  (select trial_ends_at between now() + interval '29 days 23 hours'
                            and now() + interval '30 days 1 hour'
     from public.organisations where id = '7a001000-0000-0000-0000-0000000000a0'),
  'and its trial ends thirty days out, set by the server'
);

select is(
  (select state || '|' || read_only::text
     from public.my_org_billing_state('7a001000-0000-0000-0000-0000000000a0')),
  'trial|false',
  'my_org_billing_state reports a running trial, not read-only'
);

select throws_ok(
  $$ update public.organisations set trial_ends_at = now() + interval '10 years'
      where id = '7a001000-0000-0000-0000-0000000000a0' $$,
  '42501',
  null,
  'the owner cannot extend their own trial'
);

-- ---------- Fixtures, written as the database owner ------------------
reset role;
select set_config('request.jwt.claims', '', true);

insert into public.memberships (org_id, user_id, role, status) values
  ('7a001000-0000-0000-0000-0000000000a0', '7a000000-0000-0000-0000-0000000000a2', 'staff', 'active');

insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('7a003000-0000-0000-0000-0000000000a0', '7a001000-0000-0000-0000-0000000000a0',
   '7a000000-0000-0000-0000-0000000000a2', 'Tess', 'Trial');

insert into public.locations (id, org_id, name, timezone) values
  ('7a002000-0000-0000-0000-0000000000a0', '7a001000-0000-0000-0000-0000000000a0',
   'Main site', 'Europe/London');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('7a004000-0000-0000-0000-0000000000a0', '7a001000-0000-0000-0000-0000000000a0',
   '7a002000-0000-0000-0000-0000000000a0', 'Next week',
   date '2027-06-07', date '2027-06-13', 'draft', '7a000000-0000-0000-0000-0000000000a1');

insert into public.shifts (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status) values
  ('7a005000-0000-0000-0000-0000000000a0', '7a001000-0000-0000-0000-0000000000a0',
   '7a004000-0000-0000-0000-0000000000a0', '7a002000-0000-0000-0000-0000000000a0',
   '7a003000-0000-0000-0000-0000000000a0',
   timestamptz '2027-06-08 08:00+00', timestamptz '2027-06-08 16:00+00', 'assigned');

-- The trial ends with nothing paid.
update public.organisations
   set trial_ends_at = now() - interval '1 day'
 where id = '7a001000-0000-0000-0000-0000000000a0';

select ok(
  public.org_is_read_only('7a001000-0000-0000-0000-0000000000a0'),
  'an expired trial with no subscription is read-only'
);

-- ---------- 2. The manager's building paths are refused --------------
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '7a000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ insert into public.rotas (org_id, location_id, name, period_start, period_end, status, created_by)
     values ('7a001000-0000-0000-0000-0000000000a0', '7a002000-0000-0000-0000-0000000000a0',
             'Another week', date '2027-06-14', date '2027-06-20', 'draft',
             '7a000000-0000-0000-0000-0000000000a1') $$,
  'BILL1',
  null,
  'read-only: a new rota is refused'
);

select throws_ok(
  $$ insert into public.shifts (org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
     values ('7a001000-0000-0000-0000-0000000000a0', '7a004000-0000-0000-0000-0000000000a0',
             '7a002000-0000-0000-0000-0000000000a0', '7a003000-0000-0000-0000-0000000000a0',
             timestamptz '2027-06-09 08:00+00', timestamptz '2027-06-09 16:00+00', 'assigned') $$,
  'BILL1',
  null,
  'read-only: a new shift is refused'
);

select throws_ok(
  $$ select public.publish_rota('7a004000-0000-0000-0000-0000000000a0') $$,
  'BILL1',
  null,
  'read-only: publishing is refused'
);

select throws_ok(
  $$ select public.create_invite('7a001000-0000-0000-0000-0000000000a0', 'new-person@example.test', 'staff') $$,
  'BILL1',
  null,
  'read-only: inviting is refused'
);

select is(
  (select count(*)::int from public.my_feature_access('7a001000-0000-0000-0000-0000000000a0')
    where source = 'plan'),
  0,
  'read-only: no plan feature is granted'
);

select is(
  (select read_only from public.my_org_billing_state('7a001000-0000-0000-0000-0000000000a0')),
  true,
  'and the browser can see that it is read-only'
);

-- ---------- 3. Staff keep working ------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '7a000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text,
  true);

select lives_ok(
  $$ insert into public.clock_events (org_id, staff_profile_id, type, method, event_at)
     values ('7a001000-0000-0000-0000-0000000000a0', '7a003000-0000-0000-0000-0000000000a0',
             'in', 'manual', timezone('utc', now())) $$,
  'read-only: staff can still clock in'
);

select lives_ok(
  $$ insert into public.leave_requests (org_id, staff_profile_id, type, start_date, end_date, status)
     values ('7a001000-0000-0000-0000-0000000000a0', '7a003000-0000-0000-0000-0000000000a0',
             'annual', date '2027-07-05', date '2027-07-09', 'pending') $$,
  'read-only: staff can still ask for leave'
);

select is(
  (select read_only from public.my_org_billing_state('7a001000-0000-0000-0000-0000000000a0')),
  true,
  'a staff member sees the same state as the manager'
);

-- ---------- 5. A job with no JWT is not held to the plan -------------
reset role;
select set_config('request.jwt.claims', '', true);

select lives_ok(
  $$ update public.shifts set notes = 'Written by a scheduled job'
      where id = '7a005000-0000-0000-0000-0000000000a0' $$,
  'a write with no JWT (pg_cron, migrations) is never refused for billing'
);

-- ---------- 6. Paying lifts it ---------------------------------------
set local role service_role;
insert into public.subscriptions (org_id, plan, status, provider, provider_ref, stripe_mode)
values ('7a001000-0000-0000-0000-0000000000a0', 'starter', 'active', 'stripe', 'sub_trial_test', 'test');

reset role;
select is(
  (select plan from public.organisations where id = '7a001000-0000-0000-0000-0000000000a0'),
  'starter',
  'an active subscription sets the plan it pays for'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '7a000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true);

select lives_ok(
  $$ insert into public.shifts (org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
     values ('7a001000-0000-0000-0000-0000000000a0', '7a004000-0000-0000-0000-0000000000a0',
             '7a002000-0000-0000-0000-0000000000a0', '7a003000-0000-0000-0000-0000000000a0',
             timestamptz '2027-06-10 08:00+00', timestamptz '2027-06-10 16:00+00', 'assigned') $$,
  'and the manager can build rotas again'
);

select * from finish();
rollback;
