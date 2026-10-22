-- =====================================================================
-- shift_rota_write_split.test.sql — GAP-071, `0161`
--
-- `0161` splits the `FOR ALL` write policies on `shifts` and `rotas` into
-- one policy per command, so a read stops paying for `has_org_role` on
-- every row, and rewrites `rotas_select` onto `my_readable_rota_ids()`.
-- That changes the SECURITY BOUNDARY's shape, so the test asks two things:
-- does every caller still read exactly what the old policies admitted, and
-- is every write still refused or allowed exactly as before.
--
-- The old predicates, quoted so a reader can compare without archaeology:
--
--   rotas_select  is_org_member(org_id) AND (status IN ('published',
--                 'archived') OR has_org_role(org_id, '{owner,manager}'))
--   rotas_write   FOR ALL, has_org_role(org_id, '{owner,manager}')
--   shifts_write  FOR ALL, has_org_role(org_id, '{owner,manager}')
--
-- Reads are compared against the old predicates evaluated directly for the
-- same caller (select OR write), not against hardcoded counts.
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
  ('e1111111-1111-1111-1111-111111111111'::uuid, 'ws-owner@example.test'),
  ('e2222222-2222-2222-2222-222222222222'::uuid, 'ws-manager@example.test'),
  ('e3333333-3333-3333-3333-333333333333'::uuid, 'ws-staff@example.test'),
  ('e5555555-5555-5555-5555-555555555555'::uuid, 'ws-support-read@example.test'),
  ('e7777777-7777-7777-7777-777777777777'::uuid, 'ws-outsider@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan, support_access_allowed) values
  ('e0000000-0000-0000-0000-000000000001', 'Split Org', 'split-org',
   'e1111111-1111-1111-1111-111111111111', 'enterprise', true),
  ('e0000000-0000-0000-0000-000000000002', 'Rival Split Org', 'rival-split',
   'e7777777-7777-7777-7777-777777777777', 'enterprise', true);

insert into public.memberships (org_id, user_id, role, status) values
  ('e0000000-0000-0000-0000-000000000001', 'e2222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('e0000000-0000-0000-0000-000000000001', 'e3333333-3333-3333-3333-333333333333', 'staff', 'active')
on conflict do nothing;

insert into public.platform_admins (user_id, role) values
  ('e5555555-5555-5555-5555-555555555555', 'platform_support')
on conflict do nothing;

insert into public.support_access_sessions
  (org_id, admin_user_id, reason, case_ref, scope, expires_at) values
  ('e0000000-0000-0000-0000-000000000001', 'e5555555-5555-5555-5555-555555555555',
   'Read-only fixture for 0161', 'WS-READ-1', 'read',
   timezone('utc', now()) + interval '1 hour');

insert into public.locations (id, org_id, name, timezone) values
  ('e0100000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'Ward E', 'Europe/London');

insert into public.rotas (id, org_id, location_id, name, period_start, period_end, status, created_by) values
  ('e0300000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'e0100000-0000-0000-0000-000000000001', 'Published',
   current_date, current_date + 6, 'published', 'e1111111-1111-1111-1111-111111111111'),
  ('e0300000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001',
   'e0100000-0000-0000-0000-000000000001', 'Draft',
   current_date + 7, current_date + 13, 'draft', 'e1111111-1111-1111-1111-111111111111'),
  ('e0300000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001',
   'e0100000-0000-0000-0000-000000000001', 'Archived',
   current_date - 14, current_date - 8, 'archived', 'e1111111-1111-1111-1111-111111111111');

insert into public.shifts
  (id, org_id, rota_id, location_id, staff_profile_id, starts_at, ends_at, status)
values
  ('e0400000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'e0300000-0000-0000-0000-000000000001', 'e0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '1 day',
   timezone('utc', now()) + interval '1 day 8 hours', 'open'),
  ('e0400000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001',
   'e0300000-0000-0000-0000-000000000002', 'e0100000-0000-0000-0000-000000000001', null,
   timezone('utc', now()) + interval '8 days',
   timezone('utc', now()) + interval '8 days 8 hours', 'open');

create or replace function pg_temp.old_rota_rows() returns bigint
language sql stable as $fn$
  select count(*) from public.rotas r
   where (public.is_org_member(r.org_id)
          and (r.status in ('published', 'archived')
               or public.has_org_role(r.org_id, array['owner', 'manager'])))
      or public.has_org_role(r.org_id, array['owner', 'manager']);
$fn$;

create or replace function pg_temp.old_shift_rows() returns bigint
language sql stable as $fn$
  select count(*) from public.shifts s
   where (public.is_org_member(s.org_id)
          and (s.rota_id is null or public.rota_is_readable(s.rota_id)))
      or public.has_org_role(s.org_id, array['owner', 'manager']);
$fn$;

create or replace function pg_temp.as_user(p_user uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.plan_text(p_sql text) returns text
language plpgsql volatile as $fn$
declare line text; acc text := '';
begin
  for line in execute 'explain (costs off) ' || p_sql loop
    acc := acc || line || E'\n';
  end loop;
  return acc;
end;
$fn$;

-- 1. The shape: no FOR ALL policy left on either table.
select is(
  (select count(*)::int from pg_policy
    where polrelid in ('public.shifts'::regclass, 'public.rotas'::regclass)
      and polcmd = '*'),
  0,
  'neither shifts nor rotas carries a FOR ALL policy'
);

set local role authenticated;

-- 2-9. Reads agree with the old predicates for every kind of caller.
select pg_temp.as_user('e2222222-2222-2222-2222-222222222222');
select is((select count(*) from public.rotas), pg_temp.old_rota_rows(),
  'a manager: rotas agree with the old predicates');
select is((select count(*) from public.shifts), pg_temp.old_shift_rows(),
  'a manager: shifts agree with the old predicates');
select is(
  (select count(*)::int from public.rotas where status = 'draft'), 1,
  'a manager still sees the draft rota');

select pg_temp.as_user('e3333333-3333-3333-3333-333333333333');
select is((select count(*) from public.rotas), pg_temp.old_rota_rows(),
  'a staff member: rotas agree with the old predicates');
select is(
  (select count(*)::int from public.rotas where status = 'draft'), 0,
  'a staff member does not see the draft rota');

select pg_temp.as_user('e5555555-5555-5555-5555-555555555555');
select is((select count(*) from public.rotas), pg_temp.old_rota_rows(),
  'a read-scope support session: rotas agree with the old predicates');

select pg_temp.as_user('e7777777-7777-7777-7777-777777777777');
select is((select count(*)::int from public.rotas
            where org_id = 'e0000000-0000-0000-0000-000000000001'), 0,
  'a member of another organisation sees none of its rotas');
select is((select count(*)::int from public.shifts
            where org_id = 'e0000000-0000-0000-0000-000000000001'), 0,
  'and none of its shifts');

-- 10-13. A staff member still cannot write.
select pg_temp.as_user('e3333333-3333-3333-3333-333333333333');
select throws_ok(
  $$insert into public.shifts (org_id, rota_id, location_id, starts_at, ends_at, status)
    values ('e0000000-0000-0000-0000-000000000001', 'e0300000-0000-0000-0000-000000000002',
            'e0100000-0000-0000-0000-000000000001',
            timezone('utc', now()) + interval '9 days',
            timezone('utc', now()) + interval '9 days 8 hours', 'open')$$,
  '42501', null,
  'a staff member cannot insert a shift');

with changed as (
  update public.shifts set break_minutes = 45
   where id = 'e0400000-0000-0000-0000-000000000001' returning 1
)
select is((select count(*)::int from changed), 0,
  'a staff member cannot update a shift');

with gone as (
  delete from public.shifts
   where id = 'e0400000-0000-0000-0000-000000000001' returning 1
)
select is((select count(*)::int from gone), 0,
  'a staff member cannot delete a shift');

select throws_ok(
  $$insert into public.rotas (org_id, location_id, name, period_start, period_end, status)
    values ('e0000000-0000-0000-0000-000000000001', 'e0100000-0000-0000-0000-000000000001',
            'Staff rota', current_date + 21, current_date + 27, 'draft')$$,
  '42501', null,
  'a staff member cannot insert a rota');

-- 14-15. A manager still can.
select pg_temp.as_user('e2222222-2222-2222-2222-222222222222');
with changed as (
  update public.shifts set break_minutes = 45
   where id = 'e0400000-0000-0000-0000-000000000002' returning 1
)
select is((select count(*)::int from changed), 1,
  'a manager can update a draft rota''s shift');

with changed as (
  update public.rotas set name = 'Draft, renamed'
   where id = 'e0300000-0000-0000-0000-000000000002' returning 1
)
select is((select count(*)::int from changed), 1,
  'a manager can update a draft rota');

-- 16-17. The point of 0161: a read no longer calls has_org_role per row.
select doesnt_match(
  pg_temp.plan_text('select * from public.shifts'),
  'has_org_role',
  'reading shifts no longer calls has_org_role per row');
select doesnt_match(
  pg_temp.plan_text('select * from public.rotas'),
  'has_org_role',
  'reading rotas no longer calls has_org_role per row');

reset role;
select * from finish();
rollback;
