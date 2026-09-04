-- =====================================================================
-- platform_write_roles.test.sql — 0116: a platform write names its roles.
--
-- `is_platform_admin()` answers "does this account hold any platform
-- role at all?". It is true for all four of them, `platform_finance`
-- included — an account src/lib/platformRoles.ts describes as
-- "Subscriptions and billing state only. No operational tenant data."
--
-- Three functions used it as the whole authorisation check, and two of
-- the three change a tenant's state. `delete_organisation` is the one
-- that matters: it is granted to `authenticated`, so the button being
-- hidden from the finance view in the console is not a control, and the
-- project has no backups — `pitr_enabled` is false and the backup list
-- is empty, so the deletion is permanent in the ordinary sense of the
-- word.
--
-- What this pins:
--
--   1. a finance-role platform admin cannot delete an organisation;
--   2. a support-role platform admin cannot either;
--   3. a platform_admin still can, so the tightening did not lock the
--      people who need it out of their own console;
--   4. the tenant's own owner is unaffected — this changed nothing
--      about org-level authority;
--   5-8. the same four answers for connect_integration and
--      set_org_integration_status.
--
-- Written as "the call raises 42501", not "the row survives": a guard
-- that let the call through and then failed on something else would
-- pass a survival check for the wrong reason.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(8);

-- ---------- fixtures ---------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '61616161-6161-6161-6161-616161616161',
  'authenticated', 'authenticated', 'tenant-owner@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
), (
  '00000000-0000-0000-0000-000000000000',
  '62626262-6262-6262-6262-626262626262',
  'authenticated', 'authenticated', 'finance-admin@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
), (
  '00000000-0000-0000-0000-000000000000',
  '63636363-6363-6363-6363-636363636363',
  'authenticated', 'authenticated', 'support-admin@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
), (
  '00000000-0000-0000-0000-000000000000',
  '64646464-6464-6464-6464-646464646464',
  'authenticated', 'authenticated', 'platform-admin@example.com',
  crypt('not-a-real-password', gen_salt('bf')),
  now(), now(), now(), '{}', '{}'
);

-- The three platform accounts. Inserted with the elevated role rather than
-- through grant_platform_role, which is owner-only and would need a fourth
-- fixture account purely to bootstrap the other three.
insert into public.platform_admins (user_id, role)
values ('62626262-6262-6262-6262-626262626262', 'platform_finance'),
       ('63636363-6363-6363-6363-636363636363', 'platform_support'),
       ('64646464-6464-6464-6464-646464646464', 'platform_admin');

-- A connector this test can actually connect.
--
-- `0073` set `available = false` on all eight seeded connectors, because none
-- of them exists — no Edge Function talks to Sage or Xero. So in a current
-- database `connect_integration` refuses *every* call on availability grounds
-- before the role check is reached, and a fixture selecting from the seed gets
-- NULL. That is worth knowing (it means the connect/disconnect half of
-- HARDEN-012 is not a reachable path today, and `delete_organisation` is), but
-- it must not be what this test measures: a guard that passes because the
-- function is unreachable would keep passing after somebody makes a connector
-- available. So the fixture supplies its own.
insert into public.integration_connectors (key, name, category, description, status, available)
values ('test_connector', 'Test Connector', 'payroll',
        'Fixture only. Never seeded, never shipped.', 'operational', true);

-- Everything from here runs as an ordinary signed-in user.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '61616161-6161-6161-6161-616161616161', 'role', 'authenticated')::text,
  true
);

insert into public.organisations (name, slug, created_by)
values ('Cover Care Ltd', 'cover-care', '61616161-6161-6161-6161-616161616161');

select set_config(
  'test.org',
  (select id::text from public.organisations where slug = 'cover-care'),
  true);

-- A connected integration to try to disconnect. Made by the tenant's own
-- owner, which is the ordinary path.
select public.connect_integration(current_setting('test.org')::uuid, 'test_connector');

-- ---------- helper: become one of the fixture accounts -----------------
create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

-- ---------- 1-2. deletion is refused for finance and support -----------
select pg_temp.become('62626262-6262-6262-6262-626262626262');

select throws_ok(
  $$ select public.delete_organisation(current_setting('test.org')::uuid, 'Cover Care Ltd') $$,
  '42501',
  null,
  'platform_finance cannot delete an organisation'
);

select throws_ok(
  $$ select public.connect_integration(
       current_setting('test.org')::uuid,
       'test_connector') $$,
  '42501',
  null,
  'platform_finance cannot connect an integration for a tenant'
);

select pg_temp.become('63636363-6363-6363-6363-636363636363');

select throws_ok(
  $$ select public.delete_organisation(current_setting('test.org')::uuid, 'Cover Care Ltd') $$,
  '42501',
  null,
  'platform_support cannot delete an organisation'
);

select throws_ok(
  $$ select public.set_org_integration_status(
       current_setting('test.org')::uuid,
       'test_connector',
       'disconnected') $$,
  '42501',
  null,
  'platform_support cannot disconnect a tenant''s integration'
);

-- ---------- 3. the roles that should still work, still work ------------
select pg_temp.become('64646464-6464-6464-6464-646464646464');

select lives_ok(
  $$ select public.set_org_integration_status(
       current_setting('test.org')::uuid,
       'test_connector',
       'disconnected') $$,
  'platform_admin can still change a tenant''s integration'
);

select lives_ok(
  $$ select public.connect_integration(
       current_setting('test.org')::uuid,
       'test_connector') $$,
  'platform_admin can still connect a tenant''s integration'
);

-- ---------- 4. the tenant's own owner is unaffected --------------------
select pg_temp.become('61616161-6161-6161-6161-616161616161');

select lives_ok(
  $$ select public.connect_integration(
       current_setting('test.org')::uuid,
       'test_connector') $$,
  'the organisation owner can still connect an integration'
);

-- Deletion last: it removes the fixture everything above depends on.
select lives_ok(
  $$ select public.delete_organisation(current_setting('test.org')::uuid, 'Cover Care Ltd') $$,
  'the organisation owner can still delete their own organisation'
);

select * from finish();
rollback;
