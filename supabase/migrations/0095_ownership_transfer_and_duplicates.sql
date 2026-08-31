-- =====================================================================
-- 0095_ownership_transfer_and_duplicates.sql — handing over an
-- organisation, and not creating the same person twice
-- (docs/SAAS.md CAP-091, CAP-092)
--
-- ## 1. Ownership transfer
--
-- Today the only way to hand an organisation over is two manual role
-- edits, and `memberships_keep_one_owner` (0047) correctly refuses the
-- obvious order: demote yourself first and the trigger stops you,
-- because an organisation with no owner is unrecoverable. So the working
-- sequence is promote-then-demote, which leaves TWO owners in between —
-- and if the second step is forgotten, or the tab closes, it stays that
-- way silently.
--
-- That matters more than it sounds. An owner is the only role that can
-- delete the organisation, change the plan, or transfer it again. Two
-- owners because somebody got halfway through is a permissions state
-- nobody chose.
--
-- `transfer_ownership` does both halves in one transaction: the new
-- owner is promoted and the old one demoted together, or neither
-- happens. It also refuses the case the trigger cannot see — handing an
-- organisation to somebody who is not in it.
--
-- The outgoing owner becomes a MANAGER rather than being removed. Losing
-- your own access as a side effect of handing over is a surprise, and
-- the rota they built is still their work.
--
-- ## 2. Duplicate detection
--
-- Nothing stopped the same person being added twice. In a care home with
-- two Sarah Joneses that is a real distinction; with one Sarah Jones
-- entered twice it is two half-filled timesheets, two sets of hours, and
-- a rota where she appears to be in two places.
--
-- A hard unique constraint on a name would be wrong — two people really
-- can share one — so this indexes the things that genuinely identify a
-- person and cannot legitimately repeat inside one organisation. In
-- practice that is the LINKED ACCOUNT: payroll ids have been unique since
-- 0041, which the register did not know. Names are left alone entirely —
-- two people really can share one, and a hard constraint there would
-- refuse a legitimate hire.
--
-- Locations get the stricter treatment: two sites with the same name in
-- one organisation is never useful, and every screen that asks a manager
-- to pick a location becomes a guess.
-- =====================================================================

-- ── 1. Ownership transfer ─────────────────────────────────────────────
create or replace function public.transfer_ownership(p_org uuid, p_to_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Only an owner may hand over. A manager promoting themselves would be
  -- privilege escalation with extra steps.
  if not public.has_org_role(p_org, array['owner']) then
    raise exception 'Only an owner can transfer an organisation' using errcode = '42501';
  end if;

  if p_to_user = v_actor then
    raise exception 'You already own this organisation' using errcode = '22023';
  end if;

  -- The case `memberships_keep_one_owner` cannot see: it guards against
  -- REMOVING the last owner, not against naming somebody who was never here.
  -- Without this the promote silently does nothing and the demote then
  -- leaves the organisation ownerless.
  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = p_to_user and m.status = 'active'
  ) then
    raise exception 'That person is not an active member of this organisation'
      using errcode = '22023';
  end if;

  -- Promote FIRST. In this order there is never a moment with no owner, so
  -- 0047's trigger is satisfied at every step rather than worked around.
  update public.memberships
     set role = 'owner'
   where org_id = p_org and user_id = p_to_user;

  update public.memberships
     set role = 'manager'
   where org_id = p_org and user_id = v_actor;

  -- Both halves are in one transaction, so a failure between them cannot
  -- leave two owners. That interrupted state is exactly what doing this by
  -- hand produces.
  perform public.log_audit_event(
    p_org,
    'org.ownership_transferred',
    'organisation',
    p_org,
    jsonb_build_object('from', v_actor, 'to', p_to_user)
  );
end;
$$;

-- `log_audit_event` validates its action against a fixed list, and refuses
-- anything else with 22023. That is the right design — an audit trail whose
-- vocabulary any caller can invent is not a vocabulary — but it means a new
-- event type has to be added here as well as to `src/lib/auditActions.ts`.
-- Adding only the label, as the first version of this change did, produces a
-- function that raises on its own audit call.
create or replace function public.log_audit_event(
  p_org         uuid,
  p_action      text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_action not in (
      'gdpr.export','gdpr.export_denied',
      'report.exported','timesheet.exported','staff.exported',
      'timesheet.amended','leave.reviewed',
      -- New in 0095.
      'org.ownership_transferred') then
    raise exception 'Unknown audit action: %', p_action using errcode = '22023';
  end if;

  if p_org is null then
    raise exception 'An organisation is required for this event'
      using errcode = '22023';
  end if;

  if not public.is_org_member(p_org) then
    raise exception 'Cannot write audit events for another organisation'
      using errcode = '42501';
  end if;

  perform public.audit_write(
    p_org, p_action, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb), 'info', 'org');
end;
$$;

comment on function public.transfer_ownership(uuid, uuid) is
  'Hands an organisation to another active member, promoting and demoting in one transaction. The outgoing owner becomes a manager rather than losing access. Owner only.';

revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- ── 2. Duplicates ─────────────────────────────────────────────────────
--
-- `staff_profiles` has no email column, so the identifying facts available
-- are the linked account and the payroll id. Both indexes are PARTIAL: most
-- staff have neither on file, and NULLs must not collide with each other.
--
-- One account, one staff profile. This is the stronger of the two: a second
-- profile against the same `user_id` means that person's clock-ins,
-- timesheets and leave split across two records, and `my_staff_profile_id`
-- would have to pick one — which it does, arbitrarily.
create unique index if not exists staff_profiles_org_user_idx
  on public.staff_profiles (org_id, user_id)
  where user_id is not null;

-- NOT added: a payroll-id index. `0041` already has
-- `staff_profiles_payroll_id_org_unique`, and a second index over the same
-- columns is pure cost. CAP-092 said there was "no check on staff or
-- locations"; on payroll ids there has been one since 0041, and the row is
-- corrected rather than a redundant index shipped to make it true.

create unique index if not exists locations_org_name_idx
  on public.locations (org_id, lower(name));

comment on index public.staff_profiles_org_user_idx is
  'One signed-in account, one staff record, per organisation. A second would split that person''s clock-ins, timesheets and leave in half, and my_staff_profile_id() would pick between them arbitrarily (CAP-092).';
comment on index public.locations_org_name_idx is
  'Two sites with the same name in one organisation is never useful — every screen asking a manager to pick one becomes a guess.';
