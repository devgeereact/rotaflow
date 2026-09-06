-- =====================================================================
-- platform_directory.test.sql — the organisations directory counts,
-- filters and pages the whole matching set, and does not hand owner
-- contact to a role that may not read it (0130)
--
-- ## The defect this was written against
--
-- `/admin/organisations` selected whole tables and did everything else in
-- the browser. PostgREST truncates at `db.max_rows` silently, so above the
-- cap the tile total was the cap, a search for an older tenant returned
-- "no matches", and Export CSV wrote the loaded page. None of that is
-- observable on a deployment with no tenant, which is why it is asserted
-- here against sixty synthetic ones rather than looked for on screen.
--
-- ## Shown to fail on the real defect
--
-- Assertions 2 to 6 fail against any implementation that pages the array
-- it loaded: with a page size of 25 the total reads 25, and 'Zulu Care'
-- — created first, so last in the default order — cannot be found.
--
-- ## The health band is asserted here because it is written twice
--
-- `src/lib/tenantHealth.ts` decides the band in TypeScript and 0130
-- decides it again in SQL, because filtering by it in the browser is the
-- same "filter the page you loaded" bug one level down. Assertions 12 to
-- 17 are the same case table `tenantHealth.test.ts` uses, so the two
-- cannot drift without one of them going red.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(23);

-- ---------- people ----------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000a',
   'authenticated', 'authenticated', 'dir-owner@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000f',
   'authenticated', 'authenticated', 'dir-finance@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000ce',
   'authenticated', 'authenticated', 'tenant-boss@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000bd',
   'authenticated', 'authenticated', 'nobody@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.platform_admins (user_id, role) values
  ('d0000000-0000-0000-0000-00000000000a', 'platform_owner'),
  ('d0000000-0000-0000-0000-00000000000f', 'platform_finance');

-- ---------- sixty tenants, more than two pages ------------------------
-- Named so the alphabetical order and the creation order disagree: the
-- tenant a search has to find is the oldest one, which the default
-- newest-first order puts on the last page.
insert into public.organisations (id, name, slug, plan, status, industry, created_at, last_activity_at, created_by)
select
  ('d1000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'Directory Tenant ' || lpad(i::text, 3, '0'),
  'directory-tenant-' || lpad(i::text, 3, '0'),
  (array['starter','professional','business'])[1 + (i % 3)],
  'active',
  (array['care','hospitality','retail'])[1 + (i % 3)],
  now() - make_interval(days => 60 - i),
  now() - interval '1 day',
  -- `created_by is null` is the platform-admin creation path, which
  -- `limit_org_creation()` exempts from the five-per-hour self-serve rate
  -- limit. Sixty rows attributed to one person is refused by that trigger,
  -- correctly, and it is the same trigger a bulk import has to respect.
  null
from generate_series(1, 59) as i;

-- The needle. Created earliest of all, so it is the last row of the last
-- page in the default order, and it is on a plan nothing else holds.
insert into public.organisations (id, name, slug, plan, status, industry, created_at, last_activity_at, created_by)
values ('d1000000-0000-0000-0000-000000000999', 'Zulu Care Homes', 'zulu-care',
        'enterprise', 'active', 'care', now() - interval '400 days',
        now() - interval '2 days', 'd0000000-0000-0000-0000-0000000000ce');

-- Owner contact lives on a membership joined to a profile, which is the
-- part finance may not read. The membership itself is written by the
-- creation trigger (`0043`), so it is asserted rather than inserted —
-- inserting it again is a duplicate-key error, which is the trigger doing
-- its job.
select is(
  (select role from public.memberships
    where org_id = 'd1000000-0000-0000-0000-000000000999'),
  'owner',
  'creating an organisation with a creator gives that creator the owner membership');

insert into public.subscriptions (org_id, plan, status, currency)
values ('d1000000-0000-0000-0000-000000000999', 'enterprise', 'past_due', 'GBP');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

-- ---------- 1. a non-administrator is refused, not given nothing ------
select pg_temp.become('d0000000-0000-0000-0000-0000000000bd');

select throws_ok(
  $$ select * from public.platform_organisation_directory() $$,
  '42501',
  'Only platform staff can read the organisation directory',
  'a signed-in non-administrator is refused rather than shown an empty list');

-- ---------- 2-6. the page is a page, the total is the total -----------
select pg_temp.become('d0000000-0000-0000-0000-00000000000a');

select is(
  (select count(*)::int from public.platform_organisation_directory(
     p_limit => 25, p_offset => 0)),
  25,
  'a page holds the page size');

select is(
  (select distinct total_count::int from public.platform_organisation_directory(
     p_limit => 25, p_offset => 0)),
  60,
  'and reports the whole matching set as its total, not the page length');

-- The needle is on the last page in the default order. A search must find
-- it without the caller knowing that.
select is(
  (select count(*)::int from public.platform_organisation_directory(
     p_search => 'zulu', p_limit => 25, p_offset => 0)),
  1,
  'search finds a tenant that the first page does not contain');

select is(
  (select distinct total_count::int from public.platform_organisation_directory(
     p_plan => array['enterprise'], p_limit => 25)),
  1,
  'the count moves with the filter, under the same predicates as the rows');

-- Sixty rows over three pages with no repeat and nothing missed. This is
-- what the tie-break on id buys: `status` is identical on every row, so
-- without it the order is free to change between pages.
select is(
  (select count(distinct id)::int from (
     select id from public.platform_organisation_directory(
       p_sort => 'status', p_limit => 25, p_offset => 0)
     union all
     select id from public.platform_organisation_directory(
       p_sort => 'status', p_limit => 25, p_offset => 25)
     union all
     select id from public.platform_organisation_directory(
       p_sort => 'status', p_limit => 25, p_offset => 50)
   ) all_pages),
  60,
  'paging an equal-valued sort returns every row exactly once');

-- ---------- 7-9. owner contact is role-scoped -------------------------
select is(
  (select owner_email from public.platform_organisation_directory(
     p_search => 'zulu')),
  'tenant-boss@example.test',
  'an operational role reads the owner contact');

select pg_temp.become('d0000000-0000-0000-0000-00000000000f');

select is(
  (select owner_email from public.platform_organisation_directory(
     p_search => 'zulu')),
  null,
  'finance does not, because 0122 says memberships and profiles are not its business');

select is(
  (select owner_contact_visible from public.platform_organisation_directory(
     p_search => 'zulu')),
  false,
  'and is told the value was withheld rather than shown an empty owner');

-- Searching by a value it cannot read must not confirm the value exists.
select is(
  (select count(*)::int from public.platform_organisation_directory(
     p_search => 'tenant-boss@example.test')),
  0,
  'finance cannot find a tenant by an owner email it may not read');

select pg_temp.become('d0000000-0000-0000-0000-00000000000a');

select is(
  (select count(*)::int from public.platform_organisation_directory(
     p_search => 'tenant-boss@example.test')),
  1,
  'an operational role can');

-- ---------- 12-17. the health band, the same cases as tenantHealth.ts -
select is(public.platform_health_band('suspended', now(), 'active', now()),
          'suspended',
          'a suspended account is suspended whatever else is true of it');

select is(public.platform_health_band('archived', now(), 'active', now()),
          'archived',
          'and an archived one is archived, not a shade of suspended');

select is(public.platform_health_band('active', now(), 'past_due', now()),
          'attention',
          'a failed payment outranks a quiet month');

select is(public.platform_health_band('active', null, 'active', now()),
          'at_risk',
          'never active is at risk, not healthy — unobserved health is not health');

select is(public.platform_health_band('active', now() - interval '40 days', 'active', now()),
          'at_risk',
          'quiet for more than thirty days is at risk');

select is(public.platform_health_band('active', now() - interval '20 days', 'active', now()),
          'attention',
          'quiet for more than fourteen days needs attention');

select is(public.platform_health_band('active', now() - interval '2 days', 'active', now()),
          'healthy',
          'recently active is healthy');

-- ---------- 18-19. filtering by health uses that same rule ------------
select is(
  (select distinct total_count::int from public.platform_organisation_directory(
     p_health => array['attention'])),
  1,
  'the past-due tenant is the only one needing attention');

select is(
  (select count(*)::int from public.platform_organisation_directory(
     p_health => array['at_risk'])),
  0,
  'and nothing is at risk, because every other tenant was active yesterday');

-- ---------- 20-21. facets describe the estate, not the page -----------
select is(
  (select total::int from public.platform_organisation_facets()),
  60,
  'the facets count every tenant');

-- The plan only the oldest tenant holds. Built from the loaded page, this
-- list would not contain it, so the filter could not offer it.
select ok(
  (select 'enterprise' = any (plans) from public.platform_organisation_facets()),
  'and offer a plan that only a tenant beyond the first page is on');

select * from finish();
rollback;
