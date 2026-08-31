-- =====================================================================
-- platform_mfa.test.sql — CAP-049
--
-- `platform_settings.require_mfa` existed from `0027`, defaulted to
-- TRUE, and was enforced by nothing. Verified against production before
-- `0102` was written: one platform administrator, the flag on, and
-- **zero enrolled factors**. The console recorded that it required a
-- second factor while nobody had one.
--
--   1. with the requirement off, an administrator at aal1 is admitted —
--      this is the state `0102` leaves production in, and it has to keep
--      working;
--   2. with it on, the same administrator at aal1 is refused. This is
--      the whole feature;
--   3. with it on and an aal2 session, admitted;
--   4. a MISSING aal claim reads as aal1, not as "unknown, allow". The
--      failure direction of an absent claim is the entire question;
--   5. a non-administrator is still refused at aal2 — the second factor
--      is an additional condition, never a substitute for the grant;
--   6. turning the requirement ON from a session that has not done MFA
--      is refused. That is the classic self-lockout;
--   7. from an aal2 session it succeeds;
--   8. turning it OFF has no such guard — an escape hatch reachable only
--      by satisfying the condition being escaped is not an escape hatch;
--   9. somebody who is not a platform owner cannot touch it at all;
--  10. `my_mfa_status()` reports this account's own factors;
--  11. and `anon` cannot call it.
--
-- pgTAP, run via `supabase test db`.
-- =====================================================================

begin;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  v.email, 'x', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
from (values
  ('c1111111-1111-1111-1111-111111111111'::uuid, 'owner-mfa@example.test'),
  ('c2222222-2222-2222-2222-222222222222'::uuid, 'nobody-mfa@example.test')
) as v(id, email);

update public.profiles set is_platform_admin = true
 where id = 'c1111111-1111-1111-1111-111111111111';

insert into public.platform_admins (user_id, role)
values ('c1111111-1111-1111-1111-111111111111', 'platform_owner')
on conflict (user_id) do update set role = 'platform_owner', revoked_at = null;

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('c3000000-0000-0000-0000-000000000001', 'c1111111-1111-1111-1111-111111111111',
        'Test app', 'totp', 'verified', now(), now(), 'SECRET');

-- Helper: run is_platform_admin() as a given user at a given assurance level.
create or replace function pg_temp.admin_at(p_user uuid, p_aal text)
returns boolean language plpgsql as $$
declare
  v_claims jsonb;
  v_result boolean;
begin
  v_claims := jsonb_build_object('sub', p_user::text, 'role', 'authenticated');
  if p_aal is not null then
    v_claims := v_claims || jsonb_build_object('aal', p_aal);
  end if;
  perform set_config('request.jwt.claims', v_claims::text, true);
  select public.is_platform_admin() into v_result;
  return v_result;
end;
$$;

update public.platform_settings set require_mfa = false;

select ok(
  pg_temp.admin_at('c1111111-1111-1111-1111-111111111111', 'aal1'),
  'with the requirement off, an administrator at aal1 is admitted'
);

update public.platform_settings set require_mfa = true;

select ok(
  not pg_temp.admin_at('c1111111-1111-1111-1111-111111111111', 'aal1'),
  'with it on, the same administrator at aal1 is refused'
);

select ok(
  pg_temp.admin_at('c1111111-1111-1111-1111-111111111111', 'aal2'),
  'and admitted with a second-factor session'
);

select ok(
  not pg_temp.admin_at('c1111111-1111-1111-1111-111111111111', null),
  'a missing aal claim reads as aal1 — an absent claim must never mean "allow"'
);

select ok(
  not pg_temp.admin_at('c2222222-2222-2222-2222-222222222222', 'aal2'),
  'a second factor is an extra condition, never a substitute for the grant'
);

-- ── the switch ────────────────────────────────────────────────────────

update public.platform_settings set require_mfa = false;

-- Explicitly the owner, at aal1. The helper above left the claims set to
-- whoever it was last asked about, and a test that depends on the leftovers of
-- the one before it fails for the wrong reason — which is how this was first
-- written, and it reported the platform-owner refusal instead.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111',
                    'role', 'authenticated', 'aal', 'aal1')::text,
  true);

select throws_ok(
  $$ select public.set_platform_mfa_required(true) $$,
  '42501',
  'Sign in with your second factor before requiring it of everyone',
  'turning it on from a session that has not done MFA is refused'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111',
                    'role', 'authenticated', 'aal', 'aal2')::text,
  true);

select is(
  public.set_platform_mfa_required(true),
  true,
  'and succeeds from a second-factor session'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111',
                    'role', 'authenticated', 'aal', 'aal1')::text,
  true);

select is(
  public.set_platform_mfa_required(false),
  false,
  'turning it off has no such guard — an escape hatch behind the condition is not one'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c2222222-2222-2222-2222-222222222222',
                    'role', 'authenticated', 'aal', 'aal2')::text,
  true);

select throws_ok(
  $$ select public.set_platform_mfa_required(true) $$,
  '42501',
  'Only a platform owner may change the second-factor requirement',
  'and somebody who is not a platform owner cannot touch it at all'
);

-- ── my_mfa_status ─────────────────────────────────────────────────────

select set_config(
  'request.jwt.claims',
  json_build_object('sub', 'c1111111-1111-1111-1111-111111111111',
                    'role', 'authenticated', 'aal', 'aal2')::text,
  true);

select is(
  (select factor_count from public.my_mfa_status()),
  1,
  'my_mfa_status reports this account''s own verified factor'
);

select ok(
  not has_function_privilege('anon', 'public.my_mfa_status()', 'EXECUTE'),
  'and anon cannot ask'
);

select * from finish();
rollback;
