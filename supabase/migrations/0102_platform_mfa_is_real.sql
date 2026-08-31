-- =====================================================================
-- 0102_platform_mfa_is_real.sql — the console's MFA switch starts
-- deciding something (docs/SAAS.md CAP-049)
--
-- `platform_settings.require_mfa` has existed since `0027`, defaulted to
-- TRUE, and been enforced by nothing. Its own comment says "Supabase
-- Auth is the enforcement point", which sounds reasonable and is not
-- true: enrolment is a client call — `supabase.auth.mfa.enroll` — and
-- this application had never made one. Read live before writing this:
-- one platform administrator, `require_mfa = true`, **zero enrolled
-- factors**.
--
-- So the highest-privilege surface in the product recorded that it
-- required a second factor while nobody had one and nothing checked.
-- That is worse than the switch being off. An owner reading the console
-- would have believed the platform console was protected by something
-- that did not exist.
--
-- ## What changes
--
-- `is_platform_admin()` gains one condition. Every policy guarding the
-- console already calls it, so this is enforcement in one place rather
-- than thirty. When `require_mfa` is on, an administrator's JWT must
-- carry `aal2` — which GoTrue sets only after a factor has been
-- verified in this session.
--
-- ## Why it is being turned OFF in the same migration
--
-- Because it is true that it is off. There are zero verified factors,
-- so switching enforcement on with the flag left at its default would
-- lock the only platform administrator out of the console the moment
-- this migration applied — and migrations apply to production on merge.
--
-- Turning it off is not a weakening. Enforcement went from "claimed and
-- absent" to "real and disabled", and the console now says which. The
-- path forward is: enrol a factor on the account screen, sign in with
-- it, then turn this on.
--
-- ## The switch refuses to lock you out
--
-- `set_platform_mfa_required(true)` is rejected unless the caller is
-- holding an `aal2` session at that moment. Requiring MFA from a
-- session that has not done MFA is the classic way an administrator
-- locks themselves out of their own console, and it is a mistake the
-- database can simply refuse to make.
--
-- Turning it OFF has no such guard: an emergency switch that can only
-- be reached by satisfying the condition being escaped is not an
-- emergency switch. It is `platform_owner`-gated, and audited.
-- =====================================================================

-- ── what the caller's own MFA state is ────────────────────────────────
--
-- SECURITY DEFINER because `auth.mfa_factors` is GoTrue's and is not
-- readable by `authenticated`. Filtered on `auth.uid()` with no argument, so
-- there is no way to ask about anybody else's — the same shape as
-- `my_sessions()` in `0100`, for the same reason.
create or replace function public.my_mfa_status()
returns table (
  has_verified_factor boolean,
  factor_count        integer,
  session_is_aal2     boolean
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
           select 1 from auth.mfa_factors f
            where f.user_id = auth.uid() and f.status = 'verified'
         ),
         (select count(*)::integer from auth.mfa_factors f
           where f.user_id = auth.uid() and f.status = 'verified'),
         coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

comment on function public.my_mfa_status() is
  'The caller''s own second-factor state. No argument, so there is no way to ask about anybody else''s (CAP-049).';

revoke all on function public.my_mfa_status() from public, anon;
grant execute on function public.my_mfa_status() to authenticated;

-- ── the enforcement ───────────────────────────────────────────────────
--
-- One added condition on the predicate every console policy already calls.
--
-- `coalesce(..., 'aal1')` matters: a token shape without the claim must read
-- as "has not done MFA", never as "unknown, allow". The failure direction of
-- a missing claim is the whole question.
--
-- Note this deliberately does NOT gate `has_support_access` separately.
-- Support sessions are created by a platform administrator, and creating one
-- goes through a policy that calls `is_platform_admin()` — so the gate is
-- already upstream of it, and duplicating it there would mean two places to
-- keep in step.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
     and (
       not coalesce((select s.require_mfa from public.platform_settings s limit 1), false)
       or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     );
$$;

comment on function public.is_platform_admin() is
  'Platform administrator, AND holding a second-factor session when platform_settings.require_mfa is on. Every console policy calls this, so the requirement is enforced in one place (CAP-049).';

-- ── the switch ────────────────────────────────────────────────────────
create or replace function public.set_platform_mfa_required(p_required boolean)
returns boolean
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_aal2 boolean;
begin
  -- `platform_owner` only. Note this reads the grant directly rather than
  -- calling `is_platform_admin()`: that function is exactly what this
  -- statement changes the behaviour of, and a switch whose own guard depends
  -- on the setting it writes is how an off switch becomes unreachable.
  if not exists (
    select 1 from public.platform_admins a
     where a.user_id = auth.uid()
       and a.role = 'platform_owner'
       and a.revoked_at is null
  ) then
    raise exception 'Only a platform owner may change the second-factor requirement'
      using errcode = '42501';
  end if;

  v_aal2 := coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';

  if p_required and not v_aal2 then
    raise exception 'Sign in with your second factor before requiring it of everyone'
      using errcode = '42501',
            hint = 'Enrol a factor on your account security screen, then sign in again.';
  end if;

  update public.platform_settings set require_mfa = p_required;

  -- `warning` rather than `info` for both directions. Turning the requirement
  -- off is the one somebody would want to find later, and an event that only
  -- appears at `info` is an event nobody filters for.
  perform public.audit_write(
    null,
    case when p_required then 'platform.mfa_required' else 'platform.mfa_not_required' end,
    'platform_settings',
    null,
    jsonb_build_object('require_mfa', p_required),
    'warning',
    'platform_only'
  );

  return p_required;
end;
$$;

comment on function public.set_platform_mfa_required(boolean) is
  'Turns the console''s second-factor requirement on or off. Turning it ON is refused from a session that has not itself done MFA — that is the classic self-lockout. Turning it OFF has no such guard, deliberately (CAP-049).';

revoke all on function public.set_platform_mfa_required(boolean) from public, anon;
grant execute on function public.set_platform_mfa_required(boolean) to authenticated;

-- ── the honest current value ──────────────────────────────────────────
--
-- SAFETY(update): one boolean on a one-row settings table, and it is the
-- change that keeps the only platform administrator able to reach the
-- console. Its previous value was `true` and enforced by nothing; leaving it
-- there while switching enforcement on would lock the console on merge.
update public.platform_settings set require_mfa = false;

comment on column public.platform_settings.require_mfa is
  'Enforced by is_platform_admin() since 0102: when true, a console policy requires an aal2 session. Set with set_platform_mfa_required(), which refuses to turn it on from a session that has not done MFA.';
