-- =====================================================================
-- platform_user_directory.test.sql — searching the platform user
-- directory by organisation finds a multi-organisation account (0131)
--
-- ## The defect
--
-- `summariseMembershipsByUser()` set `soleOrgName` only for an account in
-- exactly one organisation, and the screen searched that field. So an
-- account in two organisations was unfindable by either name — the field
-- carrying an organisation was null for precisely the accounts a support
-- case is most likely to be about.
--
-- ## Shown to fail on the real defect
--
-- Assertion 3 fails against any implementation that searches a single
-- organisation name: 'Two Orgs Tess' belongs to Alpha and Beta, so her
-- sole-organisation field is null and neither name matches.
--
-- Assertion 4 is the other half. A join across memberships finds her
-- twice, once per organisation, and the total counts her twice.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(14);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', 'ud-owner@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-0000000000fe',
   'authenticated', 'authenticated', 'ud-finance@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-0000000000be',
   'authenticated', 'authenticated', 'tess@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-0000000000ce',
   'authenticated', 'authenticated', 'solo@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-0000000000de',
   'authenticated', 'authenticated', 'nowhere@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

update public.profiles set full_name = 'Two Orgs Tess'
 where id = 'e0000000-0000-0000-0000-0000000000be';
update public.profiles set full_name = 'Solo Sam'
 where id = 'e0000000-0000-0000-0000-0000000000ce';
update public.profiles set full_name = 'Unattached Uma'
 where id = 'e0000000-0000-0000-0000-0000000000de';

insert into public.platform_admins (user_id, role) values
  ('e0000000-0000-0000-0000-0000000000a1', 'platform_owner'),
  ('e0000000-0000-0000-0000-0000000000fe', 'platform_finance');

insert into public.organisations (id, name, slug, created_by) values
  ('e1000000-0000-0000-0000-000000000001', 'Alpha Care Ltd',    'alpha-care', null),
  ('e1000000-0000-0000-0000-000000000002', 'Beta Hospitality',  'beta-hosp',  null),
  ('e1000000-0000-0000-0000-000000000003', 'Gamma Retail',      'gamma-ret',  null);

-- Tess is an owner at Alpha and staff at Beta. Sam is a manager at Gamma
-- only. Uma belongs nowhere.
insert into public.memberships (org_id, user_id, role, status) values
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000be', 'owner', 'active'),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000be', 'staff', 'suspended'),
  ('e1000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-0000000000ce', 'manager', 'active');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

-- ---------- 1-2. the role boundary ------------------------------------
select pg_temp.become('e0000000-0000-0000-0000-0000000000fe');

select throws_ok(
  $$ select * from public.platform_user_directory() $$,
  '42501',
  'Only an operational platform role can read the user directory',
  'finance is refused outright rather than shown a one-account table');

select throws_ok(
  $$ select * from public.platform_user_facets() $$,
  '42501',
  'Only an operational platform role can read platform user facets',
  'and the tiles above it are refused the same way');

-- ---------- 3-5. searching by organisation ----------------------------
select pg_temp.become('e0000000-0000-0000-0000-0000000000a1');

select is(
  (select full_name from public.platform_user_directory(p_search => 'Alpha Care')),
  'Two Orgs Tess',
  'searching an organisation name finds a member who belongs to two');

select is(
  (select count(*)::int from public.platform_user_directory(p_search => 'Beta')),
  1,
  'and her other organisation finds her exactly once, not once per membership');

select is(
  (select count(*)::int from public.platform_user_directory(p_search => 'beta-hosp')),
  1,
  'the slug is searchable too, because that is what a support ticket carries');

-- ---------- 6-8. one row per account, with its whole membership set ---
select is(
  (select organisations::int from public.platform_user_directory(p_search => 'tess@example.test')),
  2,
  'the row reports both memberships');

select is(
  (select active_memberships::int from public.platform_user_directory(p_search => 'tess@example.test')),
  1,
  'and how many of them are active, which is a different number');

select is(
  (select array_length(org_names, 1) from public.platform_user_directory(p_search => 'tess@example.test')),
  2,
  'and names every organisation rather than only a sole one');

-- ---------- 9-11. a combination has to be satisfied by one membership -
select is(
  (select count(*)::int from public.platform_user_directory(
     p_org => array['e1000000-0000-0000-0000-000000000002']::uuid[],
     p_role => array['owner'])),
  0,
  'owner AND Beta matches nobody: Tess owns Alpha and is only staff at Beta');

select is(
  (select full_name from public.platform_user_directory(
     p_org => array['e1000000-0000-0000-0000-000000000001']::uuid[],
     p_role => array['owner'])),
  'Two Orgs Tess',
  'owner AND Alpha matches the one membership that is both');

select is(
  (select count(*)::int from public.platform_user_directory(
     p_membership_status => array['suspended'])),
  1,
  'membership status filters on the membership, not on the account');

-- ---------- 12-13. counts are over the match set ----------------------
select is(
  (select distinct total_count::int from public.platform_user_directory(p_limit => 1)),
  5,
  'the total counts every account even when one row was asked for');

select is(
  (select count(*)::int from public.platform_user_directory(
     p_platform_access => 'platform')),
  2,
  'platform access is a filter over accounts, not over memberships');

-- ---------- 14. the unreachable badge is now a real number ------------
-- The console claimed to show "no active membership" and tested
-- `roles.length === 0`, which no membership row can satisfy. Uma belongs
-- nowhere, so she is not it; nobody here belongs somewhere and is active
-- nowhere, and the facet says zero rather than pretending.
select is(
  (select suspended_only::int from public.platform_user_facets()),
  0,
  'nobody here belongs to an organisation without an active membership');

select * from finish();
rollback;
