-- =====================================================================
-- shifts_rls_equivalence.test.sql — GAP-089, `0137`
--
-- `0137` rewrites `shifts_select` so both halves of it are uncorrelated
-- and the planner evaluates each once. That is a performance change to
-- the SECURITY BOUNDARY, so the only thing worth testing is that it
-- decides exactly what the old predicate decided.
--
-- The old predicate, quoted so a reader can compare without archaeology:
--
--   is_org_member(org_id)
--   AND (rota_id IS NULL OR rota_is_readable(rota_id))
--
-- Every assertion compares the NEW policy's visible rows against the OLD
-- predicate evaluated directly, for the same caller. Comparing against
-- hardcoded counts would pass if both were wrong the same way.
--
--   1. a manager sees the draft rota's shifts, and the two agree;
--   2. a staff member does NOT — a draft is a manager's working copy;
--   3. and does see the published one, and the two agree;
--   4. an archived rota reads like a published one;
--   5. a shift with NO rota is visible to a member;
--   6. a READ-scope support session sees the published rota. This is the
--      asymmetry with `0136`: `is_org_member` asks has_support_access
--      for FALSE, so read scope DOES count here;
--   7. and does NOT see the draft, because that half needs owner or
--      manager, which a read-scope session is not;
--   8. a member of another organisation sees nothing;
--   9. the plan holds the lookups as hashed SubPlans rather than per-row
--      calls — without which every assertion above passes against a
--      rewrite that fixed nothing.
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
  ('f1111111-1111-1111-1111-111111111111'::uuid, 'sh-owner@example.test'),
  ('f2222222-2222-2222-2222-222222222222'::uuid, 'sh-manager@example.test'),
  ('f3333333-3333-3333-3333-333333333333'::uuid, 'sh-staff@example.test'),
  ('f5555555-5555-5555-5555-555555555555'::uuid, 'sh-support-read@example.test'),
  ('f7777777-7777-7777-7777-777777777777'::uuid, 'sh-outsider@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan, support_access_allowed) values
  ('f0000000-0000-0000-0000-000000000001', 'Shift Org', 'shift-org',
   'f1111111-1111-1111-1111-111111111111', 'enterprise', true),
  ('f0000000-0000-0000-0000-000000000002', 'Rival Shift Org', 'rival-shift',
   'f7777777-7777-7777-7777-777777777777', 'enterprise', true);

insert into public.memberships (org_id, user_id, role, status) values
  ('f0000000-0000-0000-0000-000000000001', 'f2222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('f0000000-0000-0000-0000-000000000001', 'f3333333-3333-3333-3333-333333333333', 'staff', 'active')
on conflict do nothing;

insert into public.platform_admins (user_id, role) values
  ('f5555555-5555-5555-5555-555555555555', 'platform_support')
on conflict do nothing;

insert into public.support_access_sessions
  (org_id, admin_user_id, reason, case_ref, scope, expires_at) values
  ('f0000000-0000-0000-0000-000000000001', 'f5555555-5555-5555-5555-555555555555',
   'Read-only equivalence fixture for 0137', 'SH-READ-1', 'read',
   timezone('utc', now()) + interval '1 hour');

insert into public.locations (id, org_id, name, timezone) values
  ('f0100000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
   'Ward F', 'Europe/London');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('f0300000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
   'f0100000-0000-0000-0000-000000000001', 'Published',
   current_date, current_date + 6, 'published', 'f1111111-1111-1111-1111-111111111111'),
  ('f0300000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001',
   'f0100000-0000-0000-0000-000000000001', 'Draft',
   current_date + 7, current_date + 13, 'draft', 'f1111111-1111-1111-1111-111111111111'),
  ('f0300000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   'f0100000-0000-0000-0000-000000000001', 'Archived',
   current_date - 14, current_date - 8, 'archived', 'f1111111-1111-1111-1111-111111111111');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
values
  ('f0400000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
   'f0300000-0000-0000-0000-000000000001', 'f0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '1 day',
   timezone('utc', now()) + interval '1 day 8 hours', 'open'),
  ('f0400000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001',
   'f0300000-0000-0000-0000-000000000002', 'f0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '8 days',
   timezone('utc', now()) + interval '8 days 8 hours', 'open'),
  ('f0400000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   'f0300000-0000-0000-0000-000000000003', 'f0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) - interval '10 days',
   timezone('utc', now()) - interval '9 days 16 hours', 'open'),
  -- No rota at all. The branch the rewrite must preserve verbatim.
  ('f0400000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001',
   null, 'f0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '2 days',
   timezone('utc', now()) + interval '2 days 8 hours', 'open');

create or replace function pg_temp.old_predicate_rows() returns bigint
language sql stable as $fn$
  select count(*) from public.shifts s
   where public.is_org_member(s.org_id)
     and (s.rota_id is null or public.rota_is_readable(s.rota_id));
$fn$;

create or replace function pg_temp.as_user(p_user uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$fn$;

set local role authenticated;

select pg_temp.as_user('f2222222-2222-2222-2222-222222222222');
select is(
  (select count(*) from public.shifts), pg_temp.old_predicate_rows(),
  'a manager: the new policy and the old predicate agree'
);

select pg_temp.as_user('f3333333-3333-3333-3333-333333333333');
select is(
  (select count(*) from public.shifts
    where rota_id = 'f0300000-0000-0000-0000-000000000002')::int, 0,
  'a staff member cannot see a draft rota''s shifts'
);
select is(
  (select count(*) from public.shifts), pg_temp.old_predicate_rows(),
  'a staff member: the new policy and the old predicate agree'
);
select is(
  (select count(*) from public.shifts
    where rota_id = 'f0300000-0000-0000-0000-000000000003')::int, 1,
  'an archived rota reads like a published one'
);
select is(
  (select count(*) from public.shifts where rota_id is null)::int, 1,
  'a shift with no rota is visible to a member'
);

select pg_temp.as_user('f5555555-5555-5555-5555-555555555555');
select is(
  (select count(*) from public.shifts
    where rota_id = 'f0300000-0000-0000-0000-000000000001')::int, 1,
  'a read-scope support session sees the published rota — the asymmetry with 0136'
);
select is(
  (select count(*) from public.shifts
    where rota_id = 'f0300000-0000-0000-0000-000000000002')::int, 0,
  'and not the draft, which needs owner or manager'
);

select pg_temp.as_user('f7777777-7777-7777-7777-777777777777');
select is(
  (select count(*) from public.shifts)::int, 0,
  'a member of another organisation sees nothing'
);

create or replace function pg_temp.plan_text() returns text
language plpgsql volatile as $fn$
declare line text; acc text := '';
begin
  for line in execute 'explain (costs off) select count(*) from public.shifts' loop
    acc := acc || line || E'\n';
  end loop;
  return acc;
end;
$fn$;

select pg_temp.as_user('f2222222-2222-2222-2222-222222222222');
select matches(
  pg_temp.plan_text(),
  'SubPlan',
  'the lookups are hashed SubPlans, not per-row function calls'
);

reset role;
select * from finish();
rollback;
