-- =====================================================================
-- staff_locations.test.sql — CAP-089
--
-- The register said "`staff_profiles` has no `location_id`". True, and
-- adding one would have been the wrong fix: a single column cannot
-- express a multi-location worker, which is the thing being asked for.
-- What actually happens is that a person's site is inherited from their
-- DEPARTMENT, so they have exactly one by construction.
--
--   1. somebody with no sites recorded still appears at their
--      department's site — an organisation that never opens the new
--      control sees no change;
--   2. somebody with explicit sites appears at each of them;
--   3. and NOT at their department's site once they have explicit ones.
--      This is the assertion that stops the fallback silently granting a
--      site nobody assigned;
--   4. an inactive person is nobody's cover;
--   5. a manager may record a site;
--   6. a staff member may not — where somebody works is a rostering
--      decision;
--   7. a row pairing this org's id with ANOTHER org's staff member is
--      refused by the trigger, not merely by the policy;
--   8. the same for a site belonging to another organisation;
--   9. and a member of another organisation sees none of it.
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
  ('c9111111-1111-1111-1111-111111111111'::uuid, 'owner-loc@example.test'),
  ('c9222222-2222-2222-2222-222222222222'::uuid, 'staff-loc@example.test'),
  ('c9333333-3333-3333-3333-333333333333'::uuid, 'outsider-loc@example.test')
) as v(id, email);

insert into public.organisations (id, name, slug, created_by, plan) values
  ('c9000000-0000-0000-0000-000000000001', 'Org Loc', 'org-loc',
   'c9111111-1111-1111-1111-111111111111', 'enterprise'),
  ('c9000000-0000-0000-0000-000000000002', 'Other Loc', 'other-loc',
   'c9333333-3333-3333-3333-333333333333', 'enterprise');

insert into public.memberships (org_id, user_id, role) values
  ('c9000000-0000-0000-0000-000000000001', 'c9222222-2222-2222-2222-222222222222', 'staff')
on conflict do nothing;

insert into public.locations (id, org_id, name, timezone) values
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
   'Ward A', 'Europe/London'),
  ('c9100000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000001',
   'Ward B', 'Europe/London'),
  ('c9100000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000002',
   'Somebody else''s site', 'Europe/London');

insert into public.departments (id, org_id, location_id, name) values
  ('c9150000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
   'c9100000-0000-0000-0000-000000000001', 'Nursing');

insert into public.staff_profiles (id, org_id, user_id, department_id, first_name, last_name, active) values
  -- No explicit sites: falls back to Nursing's site, Ward A.
  ('c9200000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
   'c9222222-2222-2222-2222-222222222222', 'c9150000-0000-0000-0000-000000000001',
   'Fallback', 'Person', true),
  -- Explicit sites, set below.
  ('c9200000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000001',
   null, 'c9150000-0000-0000-0000-000000000001', 'Roaming', 'Person', true),
  -- Inactive.
  ('c9200000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000001',
   null, 'c9150000-0000-0000-0000-000000000001', 'Left', 'Person', false),
  -- Another organisation's.
  ('c9200000-0000-0000-0000-000000000004', 'c9000000-0000-0000-0000-000000000002',
   null, null, 'Outside', 'Person', true);

-- Roaming works Ward B only, though their department lives at Ward A.
insert into public.staff_locations (staff_profile_id, location_id, org_id) values
  ('c9200000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-000000000002',
   'c9000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select ok(
  'c9200000-0000-0000-0000-000000000001' in
    (select staff_profile_id from public.staff_at_location('c9100000-0000-0000-0000-000000000001')),
  'somebody with no sites recorded still appears at their department''s site'
);

select ok(
  'c9200000-0000-0000-0000-000000000002' in
    (select staff_profile_id from public.staff_at_location('c9100000-0000-0000-0000-000000000002')),
  'and somebody with an explicit site appears at it'
);

select ok(
  'c9200000-0000-0000-0000-000000000002' not in
    (select staff_profile_id from public.staff_at_location('c9100000-0000-0000-0000-000000000001')),
  'but NOT at their department''s site — the fallback must not grant one nobody assigned'
);

select ok(
  'c9200000-0000-0000-0000-000000000003' not in
    (select staff_profile_id from public.staff_at_location('c9100000-0000-0000-0000-000000000001')),
  'an inactive person is nobody''s cover'
);

select lives_ok(
  $$ insert into public.staff_locations (staff_profile_id, location_id, org_id)
     values ('c9200000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-000000000002',
             'c9000000-0000-0000-0000-000000000001') $$,
  'a manager may record where somebody works'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ insert into public.staff_locations (staff_profile_id, location_id, org_id)
     values ('c9200000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-000000000001',
             'c9000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a staff member may not — where somebody works is a rostering decision'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true);

select throws_ok(
  $$ insert into public.staff_locations (staff_profile_id, location_id, org_id)
     values ('c9200000-0000-0000-0000-000000000004', 'c9100000-0000-0000-0000-000000000001',
             'c9000000-0000-0000-0000-000000000001') $$,
  '23514',
  'That staff member is not in this organisation',
  'pairing this org''s id with another org''s staff member is refused by the trigger'
);

select throws_ok(
  $$ insert into public.staff_locations (staff_profile_id, location_id, org_id)
     values ('c9200000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-000000000003',
             'c9000000-0000-0000-0000-000000000001') $$,
  '23514',
  'That site is not in this organisation',
  'and so is a site belonging to another organisation'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c9333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.staff_locations),
  0,
  'a member of another organisation sees none of it'
);

select * from finish();
rollback;
