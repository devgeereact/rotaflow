-- =====================================================================
-- 0141_consent_is_the_customers_and_it_ends_a_session.sql
--
-- `organisations.support_access_allowed` is the customer's consent to platform
-- staff opening their data. Two things were wrong with it, and together they
-- meant the switch did not do what its name says.
--
-- ## 1. Turning consent off did not end a session already open
--
-- `request_support_access` (`0019`) reads the flag as a precondition, once, at
-- the moment a session is requested. `has_support_access` — the function every
-- policy actually routes through — never read it at all:
--
--   select exists (select 1 from support_access_sessions s
--                   where s.org_id = p_org and s.admin_user_id = auth.uid()
--                     and s.revoked_at is null
--                     and s.expires_at > now()
--                     and (not p_write or s.scope = 'read_write'));
--
-- So an owner who withdrew consent changed nothing for anyone already inside.
-- Access continued until the session expired on its own. For a control whose
-- entire purpose is "stop looking at my data", that is the wrong behaviour: a
-- withdrawal that takes effect at some unspecified future time is not a
-- withdrawal.
--
-- The flag now sits inside `has_support_access`, so it is re-evaluated on every
-- query rather than at grant time. Turning it off closes every live session for
-- that organisation at once, across all ~forty policies that route through
-- `is_org_member` and `has_org_role`, with no job to run and nothing to revoke.
--
-- ## 2. A support session could switch consent back on
--
-- `set_org_support_access` guarded on
--
--   has_org_role(p_org, array['owner']) or has_platform_role([owner, admin])
--
-- and `has_org_role` ends with `or public.has_support_access(p_org, true)`
-- (`0028`). So the holder of a `read_write` session satisfied the FIRST branch:
-- an administrator inside a tenant could re-grant the very consent that let
-- them in, and the second branch let any platform owner or administrator do it
-- directly.
--
-- Consent belongs to the customer. Neither branch is defensible, and both are
-- removed: the guard now reads `memberships` directly, so it cannot be
-- satisfied by a support session, a delegation, or a platform role. The only
-- person who can turn this on is somebody who is really an owner of the
-- organisation.
--
-- That is a deliberate narrowing. If a customer asks support to re-enable it,
-- support has to ask them to click it, which is the correct answer to that
-- request.
--
-- ## Why the flag is not also read by `request_support_access`'s siblings
--
-- It does not need to be. Every read and write inside a tenant goes through
-- `is_org_member` or `has_org_role`, both of which end at `has_support_access`.
-- Putting the check in the one function they share is what makes it impossible
-- to add a policy later that forgets it — the mistake `0122` and `0136` are
-- both records of.
--
-- ## Rollback
--
-- Restore both bodies from `0019` and `0028`. No table is touched, no policy is
-- rewritten and no grant changes.
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
       -- And the customer's consent is re-read on every query rather than
       -- only when the session was requested, so withdrawing it ends a live
       -- session immediately instead of at its natural expiry (0141).
       and o.support_access_allowed
  );
$$;

comment on function public.has_support_access(uuid, boolean) is
  'Whether the caller holds a live support session for this organisation, at the scope asked for, AND the customer still consents. Re-read per query, so withdrawing consent closes open sessions at once (0141).';

create or replace function public.set_org_support_access(
  p_org     uuid,
  p_allowed boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Deliberately NOT `has_org_role`, which ends at `has_support_access` and so
  -- would let a read_write session re-grant the consent that admitted it. And
  -- deliberately no platform branch: this is the customer's decision about the
  -- customer's data, and staff being able to set it makes it not a consent.
  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role = 'owner'
  ) then
    raise exception 'Only an owner of this organisation can change support access'
      using errcode = '42501';
  end if;

  update public.organisations
     set support_access_allowed = p_allowed
   where id = p_org;

  perform public.audit_write(
    p_org,
    case when p_allowed then 'org.support_access_allowed'
         else 'org.support_access_denied' end,
    'organisation', p_org, '{}'::jsonb, 'warning', 'both');
end;
$$;

revoke all on function public.set_org_support_access(uuid, boolean) from public, anon;
grant execute on function public.set_org_support_access(uuid, boolean) to authenticated;

comment on function public.set_org_support_access(uuid, boolean) is
  'The customer''s consent to platform support opening their data. Organisation owners only, tested against memberships directly so no support session or platform role can set it (0141). Audited to both sides.';
