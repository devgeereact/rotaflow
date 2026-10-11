-- =====================================================================
-- support_access_is_asked_for.test.sql — a new organisation starts with
-- support access off (0153, plan decision D8)
--
-- ## Shown to fail on the real defect
--
-- With `0153` reverted the column defaults to true again: assertion 1 fails
-- on the default, assertion 2 on the inserted row, and assertion 3 because a
-- live session against an organisation that never chose anything reads it.
--
-- ## The other half
--
-- Assertions 4 and 5 prove the default did not switch support off for good: once
-- the owner turns consent on, the same session works.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('cd000000-0000-0000-0000-000000000001'::uuid, 'asked-admin@example.test'),
  ('cd000000-0000-0000-0000-000000000002'::uuid, 'asked-owner@example.test')
) as v(id, email);

insert into public.platform_admins (user_id, role) values
  ('cd000000-0000-0000-0000-000000000001', 'platform_support');

-- No `support_access_allowed` in the column list: this is the default under
-- test, which is what every real creation path relies on.
insert into public.organisations (id, name, slug)
values ('ce000000-0000-0000-0000-000000000001', 'Asked First Ltd', 'asked-first');

insert into public.memberships (org_id, user_id, role, status)
values ('ce000000-0000-0000-0000-000000000001',
        'cd000000-0000-0000-0000-000000000002', 'owner', 'active');

-- A live session, inserted as the table owner: the point under test is the
-- consent, not how a session is requested.
insert into public.support_access_sessions
  (org_id, admin_user_id, reason, case_ref, scope, granted_at, expires_at)
values
  ('ce000000-0000-0000-0000-000000000001', 'cd000000-0000-0000-0000-000000000001',
   'Checking a rota the customer reported as missing', 'RF-2001', 'read',
   timezone('utc', now()), timezone('utc', now()) + interval '1 hour');

select col_default_is(
  'public', 'organisations', 'support_access_allowed', 'false',
  'support_access_allowed defaults to false');

select is(
  (select support_access_allowed from public.organisations
    where id = 'ce000000-0000-0000-0000-000000000001'),
  false,
  'an organisation created without choosing starts with support access off');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text,
    true);
$$;

set local role authenticated;

select pg_temp.become('cd000000-0000-0000-0000-000000000001');
select ok(
  not public.has_support_access('ce000000-0000-0000-0000-000000000001', false),
  'a live session reads nothing until the owner has said yes');

select pg_temp.become('cd000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.set_org_support_access('ce000000-0000-0000-0000-000000000001', true) $$,
  'the owner can turn support access on');

select pg_temp.become('cd000000-0000-0000-0000-000000000001');
select ok(
  public.has_support_access('ce000000-0000-0000-0000-000000000001', false),
  'once the owner turns it on, the same session works');

select * from finish();
rollback;
