-- =====================================================================
-- platform_mfa_switch.test.sql — the second-factor switch has one writer
-- (0145)
--
-- ## The defect
--
-- `set_platform_mfa_required` (`0102`) is careful: `platform_owner` only, reads
-- `platform_admins` directly rather than through `is_platform_admin()` so the
-- off switch cannot be locked out by the setting it writes, and it refuses to
-- turn the requirement ON from a session that is not already `aal2`.
--
-- None of it mattered. `authenticated` held a TABLE-level UPDATE grant on
-- `platform_settings`, and `updatePlatformSettings` sends whatever patch it is
-- given. A `platform_admin` — not even an owner — on `aal1` could set
-- `require_mfa = true` in one request from the ordinary settings screen, and
-- `is_platform_admin()` then went false for everybody, including them.
--
-- The sign-in form has no MFA challenge, so no session in this product can
-- currently reach `aal2` to satisfy the requirement once it is on.
--
-- ## Shown to fail on the real defect
--
-- With `0145` reverted, assertion 2 fails: the direct update succeeds.
--
-- The first attempt at `0145` revoked the COLUMN grant only, which is a no-op
-- while the table grant stands, and this test caught it — the bypass was still
-- open on the re-run.
--
-- ## The other half
--
-- 3 proves the settings screen still works: every other column keeps its grant.
-- 4 proves the way back is open, which is what makes the lockout survivable:
-- turning the requirement OFF is owner-only but does NOT require `aal2`.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, crypt('x', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('ed000000-0000-0000-0000-000000000001'::uuid, 'mfa-admin@example.test'),
  ('ed000000-0000-0000-0000-000000000002'::uuid, 'mfa-owner@example.test')
) as v(id, email);

insert into public.platform_admins (user_id, role) values
  ('ed000000-0000-0000-0000-000000000001', 'platform_admin'),
  ('ed000000-0000-0000-0000-000000000002', 'platform_owner');

create or replace function pg_temp.become_aal1(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text,
    true);
$$;

set local role authenticated;
select pg_temp.become_aal1('ed000000-0000-0000-0000-000000000001');

-- ---------- the RPC refuses, as it always did -------------------------
select throws_ok(
  $$ select public.set_platform_mfa_required(true) $$,
  '42501',
  'Only a platform owner may change the second-factor requirement',
  'a platform_admin cannot turn the requirement on through the RPC');

-- ---------- and now the table refuses too -----------------------------
select throws_ok(
  $$ update public.platform_settings set require_mfa = true $$,
  '42501',
  'permission denied for table platform_settings',
  'nor by writing the column directly, which bypassed both guards');

-- ---------- the settings screen still works ---------------------------
select lives_ok(
  $$ update public.platform_settings set platform_name = 'Still editable' $$,
  'every other column keeps its grant, so the settings screen is unaffected');

-- ---------- and the way back is open ----------------------------------
--
-- Turning it OFF is owner-only but needs no aal2, which is what makes a
-- lockout survivable. The console gate offers this on its own refusal screen,
-- because the settings page that holds the switch sits behind that gate.
select pg_temp.become_aal1('ed000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.set_platform_mfa_required(false) $$,
  'a platform owner can lift the requirement from an aal1 session');

select * from finish();
rollback;
