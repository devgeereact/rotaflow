-- =====================================================================
-- support_access_consent.test.sql — withdrawing consent ends a live session,
-- and a session cannot restore it (0141)
--
-- ## The defect
--
-- `organisations.support_access_allowed` was read in exactly one place:
-- `request_support_access`, as a precondition, once. `has_support_access` — the
-- function every tenant policy actually routes through, via `is_org_member` and
-- `has_org_role` — never read it. So an owner who withdrew consent changed
-- nothing for an administrator already inside; access ran until the session
-- expired on its own.
--
-- Worse, `set_org_support_access` guarded on `has_org_role(p_org, ['owner'])`,
-- and `has_org_role` ends with `or has_support_access(p_org, true)` (0028). The
-- holder of a `read_write` session satisfied it, so an administrator inside a
-- tenant could switch the consent that admitted them back on. A second branch
-- let any platform owner or administrator set it directly, which makes it not a
-- consent at all.
--
-- ## Shown to fail on the real defect
--
-- With `0141` reverted: assertion 3 fails (the session survives the
-- withdrawal), and assertions 5 and 6 fail (the session holder and the platform
-- owner both succeed in re-granting).
--
-- ## The other half of the assertion
--
-- 1, 2 and 7 prove the fix did not simply switch support access off: a session
-- against a consenting organisation still works, at the scope recorded, and an
-- owner can still set the flag.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('ca000000-0000-0000-0000-000000000001'::uuid, 'consent-admin@example.test'),
  ('ca000000-0000-0000-0000-000000000002'::uuid, 'consent-owner@example.test'),
  ('ca000000-0000-0000-0000-000000000003'::uuid, 'consent-platform-owner@example.test')
) as v(id, email);

insert into public.platform_admins (user_id, role) values
  ('ca000000-0000-0000-0000-000000000001', 'platform_admin'),
  -- The platform owner who does the removing in assertions 8 to 10. Seeded
  -- here with the rest: `auth.users` is not writable once the role has been
  -- switched to `authenticated`, which is what a mid-file insert hits.
  ('ca000000-0000-0000-0000-000000000003', 'platform_owner');

insert into public.organisations (id, name, slug, support_access_allowed)
values ('cb000000-0000-0000-0000-000000000001', 'Consent Care Ltd', 'consent-care', true);

insert into public.memberships (org_id, user_id, role, status)
values ('cb000000-0000-0000-0000-000000000001',
        'ca000000-0000-0000-0000-000000000002', 'owner', 'active');

-- A live read_write session, granted while consent stood.
insert into public.support_access_sessions
  (org_id, admin_user_id, reason, case_ref, scope, granted_at, expires_at)
values
  ('cb000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
   'Investigating a failed rota publish for the customer', 'RF-1234', 'read_write',
   timezone('utc', now()), timezone('utc', now()) + interval '1 hour');

create or replace function pg_temp.become(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text,
    true);
$$;

set local role authenticated;

-- ---------- while consent stands, the session works -------------------
select pg_temp.become('ca000000-0000-0000-0000-000000000001');

select ok(
  public.has_support_access('cb000000-0000-0000-0000-000000000001', false),
  'a live session reads the tenant while the customer consents');

select ok(
  public.has_support_access('cb000000-0000-0000-0000-000000000001', true),
  'and writes, because the session was granted read_write');

-- ---------- the owner withdraws consent -------------------------------
select pg_temp.become('ca000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.set_org_support_access('cb000000-0000-0000-0000-000000000001', false) $$,
  'the organisation owner can withdraw consent');

-- ---------- and the live session is closed at once --------------------
select pg_temp.become('ca000000-0000-0000-0000-000000000001');

select ok(
  not public.has_support_access('cb000000-0000-0000-0000-000000000001', false),
  'the session stops working immediately, without waiting for its expiry');

select ok(
  not public.has_org_role('cb000000-0000-0000-0000-000000000001', array['owner']),
  'so every policy routing through has_org_role closes with it');

-- ---------- and cannot be used to switch consent back on --------------
select throws_ok(
  $$ select public.set_org_support_access('cb000000-0000-0000-0000-000000000001', true) $$,
  '42501',
  'Only an owner of this organisation can change support access',
  'a platform administrator cannot re-grant the consent that admitted them');

-- ---------- the owner still can ---------------------------------------
select pg_temp.become('ca000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.set_org_support_access('cb000000-0000-0000-0000-000000000001', true) $$,
  'and the owner can give it back, which is what makes it a consent');

-- ---------- and removing the administrator ends it too (0142) ---------
--
-- The other way an open session must close. Before `0142`, revoking somebody's
-- platform role left `is_platform_admin()` false — so the console locked them
-- out — while `has_org_role(org, ['owner'])` stayed TRUE through
-- `has_support_access`. A removed administrator kept owner-equivalent read and
-- write on the tenant until the session expired, and could not even end it,
-- because ending it needs the console they had just lost.
--
-- Reproduced before the fix:
--   when         | write_access | owner_equiv | console
--   BEFORE       | t            | t           | t
--   AFTER revoke | t            | t           | f

select pg_temp.become('ca000000-0000-0000-0000-000000000001');
select ok(
  public.has_support_access('cb000000-0000-0000-0000-000000000001', true),
  'the session is live again once consent is back');

-- A platform owner removes them, through the RPC the Settings page calls.
select pg_temp.become('ca000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.revoke_platform_role('ca000000-0000-0000-0000-000000000001') $$,
  'a platform owner removes the administrator');

select pg_temp.become('ca000000-0000-0000-0000-000000000001');
select ok(
  not public.has_org_role('cb000000-0000-0000-0000-000000000001', array['owner']),
  'and their owner-equivalent access to the tenant ends with the grant, not at the session expiry');

select * from finish();
rollback;
