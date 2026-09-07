-- =====================================================================
-- 0142_revoking_a_platform_role_ends_its_sessions.sql
--
-- ## The defect
--
-- Removing somebody's platform role did not end the support-access sessions
-- they already held, so a removed administrator kept OWNER-EQUIVALENT read and
-- write on every tenant they were inside, until each session expired on its
-- own — up to the 1,440-minute maximum `request_support_access` allows.
--
-- Reproduced on a rebuilt local database. A `platform_support` administrator
-- with a 60-minute `read_write` session, before and after a platform owner
-- revokes their role exactly as the Settings page's Remove button does:
--
--   when         | write_access | owner_equiv | console
--   BEFORE       | t            | t           | t
--   AFTER revoke | t            | t           | f
--
-- `is_platform_admin()` goes false, so the console locks them out. Nothing else
-- changes, because `has_org_role` is defined (`0028`) as
-- `… or has_support_access(p_org, true)`, and `has_support_access` only ever
-- asked whether the SESSION was live — never whether the person holding it was
-- still staff.
--
-- The combination is the worst part. They keep owner-equivalent access to the
-- customer's data AND are locked out of the one screen that could show or end
-- the session, so they cannot stop it even if they want to. Only the tenant's
-- own owner or a remaining platform owner can, and neither has any reason to
-- know they should.
--
-- `AdminSettingsPage`'s confirm dialog says, in as many words: "They lose
-- access to the platform console and to every organisation's data." The second
-- half was untrue for up to a day.
--
-- ## Two changes, deliberately both
--
-- **1. `has_support_access` checks the holder is still staff.** This is what
-- makes it immediate: it is re-evaluated on every query, so a revocation closes
-- every live session across all ~forty policies at once, with nothing to
-- enumerate and no job to run. It is also the durable half — a future path that
-- ends a grant without knowing about this table still cannot leave access
-- behind.
--
-- **2. `revoke_platform_role` marks those sessions revoked, in the same
-- transaction, with a reason.** The first change alone would leave rows that
-- look open in `support_access_sessions` for ever, so the audit trail and the
-- tenant's own "who is in here now" list would keep naming somebody whose
-- access had in fact ended. A session that has ended should say so.
--
-- Neither is sufficient alone: (1) without (2) is correct but invisible, and
-- (2) without (1) leaves the window open to any other path that revokes a grant.
--
-- ## Scope
--
-- `is_platform_operational()` is deliberately NOT used here. It carries `0102`'s
-- MFA condition, which is about how the person authenticated right now, and a
-- session must not blink out because somebody's `aal` dropped between requests.
-- The question this asks is only "are they still staff", so it reads the grant.
--
-- ## Rollback
--
-- Restore `has_support_access` from `0141` and `revoke_platform_role` from
-- `0138`. Sessions already revoked by this stay revoked, which is the safe
-- direction.
-- =====================================================================

create or replace function public.has_support_access(
  p_org   uuid,
  p_write boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.support_access_sessions s
      join public.organisations o on o.id = s.org_id
     where s.org_id = p_org
       and s.admin_user_id = auth.uid()
       and s.revoked_at is null
       and s.expires_at > timezone('utc', now())
       -- A read session cannot write. The scope was always recorded; since
       -- 0028 it decides something.
       and (not p_write or s.scope = 'read_write')
       -- The customer still consents. Re-read per query, so withdrawing it
       -- ends a live session immediately rather than at its expiry (0141).
       and o.support_access_allowed
       -- And the holder is still platform staff. Without this, revoking
       -- somebody's platform role left them owner-equivalent inside every
       -- tenant they were in, while locked out of the console that could have
       -- ended it (0142). The grant is read directly rather than through
       -- is_platform_operational(), which carries the MFA condition: a session
       -- must not blink out because an `aal` claim changed between requests.
       and exists (
         select 1 from public.platform_admins pa
          where pa.user_id = s.admin_user_id
            and pa.revoked_at is null
       )
  );
$$;

comment on function public.has_support_access(uuid, boolean) is
  'Whether the caller holds a live support session for this organisation at the scope asked for, the customer still consents (0141), and the caller is still platform staff (0142). All three re-read per query, so revoking any of them ends an open session at once.';

create or replace function public.revoke_platform_role(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_count integer;
  v_closed      integer;
begin
  if not public.has_platform_role(array['platform_owner']) then
    raise exception 'Only a platform owner can revoke platform roles'
      using errcode = '42501';
  end if;

  -- Lock the live owner set, THEN count it. Without the lock two concurrent
  -- revocations both read two owners, both pass, and both commit against
  -- different rows, leaving none (0138).
  perform 1 from public.platform_admins
   where role = 'platform_owner' and revoked_at is null
     for update;

  select count(*) into v_owner_count
    from public.platform_admins
   where role = 'platform_owner' and revoked_at is null;

  -- Never leave the platform with no owner. AdminUsersPage already refuses
  -- this client-side; a guard that lives only in the client is not a guard.
  if exists (select 1 from public.platform_admins
              where user_id = p_user
                and role = 'platform_owner'
                and revoked_at is null)
     and v_owner_count <= 1 then
    raise exception 'Cannot revoke the last platform owner' using errcode = '23514';
  end if;

  update public.platform_admins
     set revoked_at = timezone('utc', now()),
         revoked_by = auth.uid()
   where user_id = p_user and revoked_at is null;

  -- End any support session they are holding, in the same transaction.
  -- `has_support_access` now refuses them anyway (see above), so this is about
  -- the record rather than the access: a row left looking open would keep the
  -- tenant's own "who is in here now" list, and the audit trail, naming
  -- somebody whose access had already ended.
  with closed as (
    update public.support_access_sessions
       set revoked_at    = timezone('utc', now()),
           revoked_by    = auth.uid(),
           revoke_reason = 'Platform role revoked'
     where admin_user_id = p_user
       and revoked_at is null
       and expires_at > timezone('utc', now())
    returning org_id
  )
  select count(*) into v_closed from closed;

  if v_closed > 0 then
    perform public.audit_write(
      null,
      'support_access.revoked_with_role',
      'platform_admin',
      p_user,
      jsonb_build_object('sessions_closed', v_closed),
      'warning',
      'platform_only');
  end if;
end;
$$;

revoke all on function public.has_support_access(uuid, boolean) from public, anon;
grant execute on function public.has_support_access(uuid, boolean) to authenticated;

revoke all on function public.revoke_platform_role(uuid) from public, anon;
grant execute on function public.revoke_platform_role(uuid) to authenticated;

comment on function public.revoke_platform_role(uuid) is
  'Revokes a platform grant and ends any support session it was holding, in one transaction. Platform owners only. Locks the live owner set before counting it (0138); closes open sessions and audits how many (0142).';
