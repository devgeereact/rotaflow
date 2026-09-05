-- =====================================================================
-- platform_reads.test.sql — platform_finance cannot read operational
-- tenant data (docs/SAAS.md GAP-053, closed by 0122)
--
-- `is_platform_admin()` is true for all four platform roles, and it was
-- the whole platform-side predicate on eight tables. `platform_finance`
-- is documented as "Subscriptions and billing state only. No operational
-- tenant data" and could read the audit log, support cases including
-- internal notes, incidents, integrations, memberships and every profile.
--
-- ## Shown to fail on the real defect
--
-- With `0122` reverted and the database rebuilt, assertions 1 to 4 all
-- fail: finance sees the audit row, the case, the internal message and the
-- incident. They read clean once it is applied.
--
-- ## The other half of the assertion
--
-- A test that only proves finance sees nothing is satisfied just as well
-- by a policy that lets nobody see anything. Assertions 5 to 8 check that
-- support still reads what its job needs, and 9 that finance keeps
-- `organisations`, which the billing console it exists to use depends on.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '91919191-9191-9191-9191-919191919191',
   'authenticated', 'authenticated', 'finance@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '92929292-9292-9292-9292-929292929292',
   'authenticated', 'authenticated', 'support@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '93939393-9393-9393-9393-939393939393',
   'authenticated', 'authenticated', 'tenant-owner@example.test',
   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.platform_admins (user_id, role) values
  ('91919191-9191-9191-9191-919191919191', 'platform_finance'),
  ('92929292-9292-9292-9292-929292929292', 'platform_support');

insert into public.organisations (id, name, slug, created_by) values
  ('99999999-0000-0000-0000-000000000001', 'Read Care Ltd', 'read-care',
   '93939393-9393-9393-9393-939393939393');

insert into public.audit_logs (org_id, action, visibility, actor_user_id)
values ('99999999-0000-0000-0000-000000000001', 'test.action', 'platform_only',
        '93939393-9393-9393-9393-939393939393');

insert into public.support_cases
  (id, reference, org_id, requester_id, requester_email, subject, priority)
values
  ('99999999-1000-0000-0000-000000000001', 'READ-1',
   '99999999-0000-0000-0000-000000000001', '93939393-9393-9393-9393-939393939393',
   'tenant-owner@example.test', 'A case', 'normal');

insert into public.support_case_messages (case_id, author_side, body, is_internal)
values ('99999999-1000-0000-0000-000000000001', 'platform',
        'Internal note, not for the customer', true);

insert into public.incidents (reference, title, impact, severity, service)
values ('INC-READ-1', 'An incident', 'Some tenants saw errors', 'low', 'api');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true);
$$;

set local role authenticated;

-- ---------- finance sees no operational data -------------------------
select pg_temp.become('91919191-9191-9191-9191-919191919191');

select is((select count(*)::int from public.audit_logs), 0,
  'platform_finance reads no audit rows');
select is((select count(*)::int from public.support_cases), 0,
  'platform_finance reads no support cases');
select is((select count(*)::int from public.support_case_messages), 0,
  'platform_finance reads no support messages, internal ones least of all');
select is((select count(*)::int from public.incidents), 0,
  'platform_finance reads no incidents');

-- ---------- support still does its job -------------------------------
select pg_temp.become('92929292-9292-9292-9292-929292929292');

select isnt((select count(*)::int from public.audit_logs), 0,
  'platform_support still reads the audit log');
select isnt((select count(*)::int from public.support_cases), 0,
  'platform_support still reads support cases');
select isnt((select count(*)::int from public.support_case_messages), 0,
  'platform_support still reads internal notes on a case it works');
select isnt((select count(*)::int from public.incidents), 0,
  'platform_support still reads incidents');

-- ---------- and finance keeps the console it exists for ---------------
select pg_temp.become('91919191-9191-9191-9191-919191919191');

select isnt((select count(*)::int from public.organisations), 0,
  'platform_finance still reads organisations, which the billing console needs'
);

select * from finish();
rollback;
