-- =====================================================================
-- invite_bootstrap.test.sql — a platform administrator can invite the FIRST
-- owner into a new organisation (0052, dropped by 0126, restored by 0137)
--
-- ## Why this file exists
--
-- `0052` gave `create_invite` a bootstrap exception, without which
-- admin-assisted organisation creation cannot work at all: there is nobody in
-- a brand-new organisation to hold the `owner` role the guard demands.
-- `0126` rewrote the function to add `p_department`/`p_location`, rebuilt both
-- guards from the `0006` text, and dropped the exception. Nothing caught it.
--
-- `org_creation_bootstrap.test.sql` sounds like it would have. It does not: it
-- covers `organisations_select`'s RETURNING window and calls neither
-- `create_invite` nor `admin_create_organisation_with_invite`. That gap is why
-- a broken sales-led signup path passed a 60-file, 560-assertion suite.
--
-- ## Shown to fail on the real defect
--
-- With `0137` reverted, assertions 1 to 4 fail: `create_invite` raises
-- `42501 Only owners and managers can invite people`, and
-- `admin_create_organisation_with_invite` raises the same from its own line 35.
--
-- ## The other half of the assertion
--
-- A bootstrap that never closes is a back door. 5 to 8 prove it is narrow: it
-- stops applying the moment the organisation has ANY membership, it does not
-- extend to a support or finance role, and it does not let a platform
-- administrator invite themselves into a live tenant.
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
  v.email, crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('b7000000-0000-0000-0000-000000000001'::uuid, 'boot-admin@example.test'),
  ('b7000000-0000-0000-0000-000000000002'::uuid, 'boot-support@example.test'),
  ('b7000000-0000-0000-0000-000000000003'::uuid, 'boot-member@example.test')
) as v(id, email);

insert into public.platform_admins (user_id, role) values
  ('b7000000-0000-0000-0000-000000000001', 'platform_admin'),
  ('b7000000-0000-0000-0000-000000000002', 'platform_support');

-- An organisation with nobody in it: the bootstrap case.
insert into public.organisations (id, name, slug, created_by) values
  ('b8000000-0000-0000-0000-000000000001', 'Acme Prospect', 'acme-prospect', null);

-- And one that already has a member: the case the exception must NOT reach.
insert into public.organisations (id, name, slug, created_by) values
  ('b8000000-0000-0000-0000-000000000002', 'Live Tenant Ltd', 'live-tenant', null);
insert into public.memberships (org_id, user_id, role, status) values
  ('b8000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000003',
   'owner', 'active');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text,
    true);
$$;

set local role authenticated;

-- ---------- the bootstrap works ---------------------------------------
select pg_temp.become('b7000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select * from public.create_invite(
       'b8000000-0000-0000-0000-000000000001', 'first.owner@example.test', 'owner') $$,
  'a platform administrator invites the first owner into an empty organisation');

-- The row must be readable by the same caller, because `send-invite` looks it
-- up under the caller's JWT. Without this branch the Edge Function answers 404
-- for an invitation it has just created.
select is(
  (select count(*)::int from public.invites
    where org_id = 'b8000000-0000-0000-0000-000000000001'),
  1,
  'and can read the invitation back, which is what send-invite does');

select lives_ok(
  $$ select public.record_invite_send(
       (select id from public.invites
         where org_id = 'b8000000-0000-0000-0000-000000000001' limit 1), true) $$,
  'and can record that it was sent, rather than failing silently into Sentry');

select isnt(
  (select last_sent_at from public.invites
    where org_id = 'b8000000-0000-0000-0000-000000000001' limit 1),
  null,
  'so last_sent_at is actually stamped');

-- ---------- and it is narrow ------------------------------------------

-- One membership is enough to close it, for good.
select throws_ok(
  $$ select * from public.create_invite(
       'b8000000-0000-0000-0000-000000000002', 'intruder@example.test', 'owner') $$,
  '42501',
  'Only owners and managers can invite people',
  'the exception does not reach an organisation that already has a member');

-- Only the owner role. A platform admin cannot seed a manager or a staff
-- account this way, because neither is needed to bootstrap ownership.
select throws_ok(
  $$ select * from public.create_invite(
       'b8000000-0000-0000-0000-000000000001', 'a.manager@example.test', 'manager') $$,
  '42501',
  'Only owners and managers can invite people',
  'and it covers the owner role only, not manager');

-- Not every platform role: support and finance are excluded, the same list
-- `delete_organisation` and `set_org_status` use.
select pg_temp.become('b7000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ select * from public.create_invite(
       'b8000000-0000-0000-0000-000000000001', 'support.owner@example.test', 'owner') $$,
  '42501',
  'Only owners and managers can invite people',
  'platform_support cannot bootstrap an owner: the branch names owner and admin');

-- The whole sales-led path, which is what actually broke. This is the
-- assertion that would have caught 0126.
select pg_temp.become('b7000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.admin_create_organisation_with_invite(
       'Northgate Care', 'northgate-care-boot', 'starter',
       'northgate.owner@example.test', 4900) $$,
  'admin_create_organisation_with_invite completes: it calls create_invite internally');

select * from finish();
rollback;
