-- =====================================================================
-- 0106_role_delegation.sql — somebody covering while a manager is away
-- (docs/SAAS.md CAP-090)
--
-- The register recorded this as "'Deputy Manager' is a display label,
-- not a mechanism", which is exactly right: `roleLabels` renames the
-- three real roles and changes nothing about what anybody may do. So a
-- manager going on leave for a fortnight has two options today, and both
-- are bad. Promote somebody to manager permanently and hope to remember
-- to demote them, or leave every leave request, swap and overtime claim
-- unanswered until they are back — which is the thing the approvals
-- queue was built to make visible.
--
-- ## A delegation confers `manager`, and never `owner`
--
-- This is the decision worth arguing with, so it is stated plainly: an
-- owner who delegates gets a deputy MANAGER, not a deputy owner. An
-- owner can delete the organisation, transfer ownership and change
-- billing, and "I am away for a fortnight" is not a reason to hand those
-- to somebody. What an absent manager actually needs covered is
-- approvals and the rota, which is precisely the manager role.
--
-- The consequence is honest and worth writing down: an organisation
-- whose only owner goes away still cannot have its billing changed. That
-- is correct.
--
-- ## Enforced in has_org_role, which means everywhere
--
-- Every managerial policy in this schema calls `has_org_role`. Adding
-- the condition there is one edit instead of forty, and it cannot be
-- forgotten on the next table somebody adds. The same argument `0102`
-- made for MFA and `is_platform_admin()`.
--
-- ## A delegation cannot be delegated onwards
--
-- The second EXISTS matches only against the delegator's own
-- MEMBERSHIP row, never against another delegation. Chaining would make
-- the reachable set of authority impossible to reason about, and there
-- is a test that a delegate cannot create one.
--
-- ## It expires by time, not by anybody remembering
--
-- `ends_at` is required and checked on every call. The failure mode of
-- the current alternative — a temporary promotion nobody reverses — is
-- silent and permanent; this one is silent and self-correcting.
-- =====================================================================

create table if not exists public.role_delegations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  -- Whose authority is being lent.
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  -- Who is covering.
  to_user_id   uuid not null references public.profiles(id) on delete cascade,
  starts_at    timestamptz not null default timezone('utc', now()),
  ends_at      timestamptz not null,
  note         text,
  revoked_at   timestamptz,
  created_at   timestamptz not null default timezone('utc', now()),

  constraint role_delegations_ends_after_start check (ends_at > starts_at),
  -- Delegating to yourself is a no-op that would only ever confuse a reader
  -- of the list.
  constraint role_delegations_not_self check (from_user_id <> to_user_id)
);

comment on table public.role_delegations is
  'Temporary managerial cover while somebody is away. Confers `manager` and never `owner`, expires by time, and cannot be chained (CAP-090).';

create index if not exists role_delegations_active_idx
  on public.role_delegations (org_id, to_user_id, ends_at)
  where revoked_at is null;

alter table public.role_delegations enable row level security;

-- Everybody in the organisation may see who is covering: a staff member
-- whose leave request is answered by somebody unexpected should be able to
-- see why, and hiding it would make the feature look like a bug.
drop policy if exists role_delegations_select on public.role_delegations;
create policy role_delegations_select
  on public.role_delegations for select
  using (public.is_org_member(org_id));

revoke all on public.role_delegations from anon, authenticated;
grant select on public.role_delegations to authenticated;

-- Writes go through the function below, not a policy: creating one has to
-- check that the delegator is lending authority they actually hold, which is
-- a rule rather than a predicate.

-- ── the enforcement ───────────────────────────────────────────────────
create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = auth.uid()
       and m.status = 'active' and m.role = any (p_roles)
  )
  -- A live delegation, which confers `manager` and nothing else. Note it
  -- joins the delegator's MEMBERSHIP, never another delegation: authority
  -- cannot be passed onwards.
  or (
    'manager' = any (p_roles)
    and exists (
      select 1
        from public.role_delegations d
        join public.memberships giver
          on giver.org_id = d.org_id
         and giver.user_id = d.from_user_id
         and giver.status = 'active'
         and giver.role in ('owner', 'manager')
        join public.memberships taker
          on taker.org_id = d.org_id
         and taker.user_id = auth.uid()
         and taker.status = 'active'
       where d.org_id = p_org
         and d.to_user_id = auth.uid()
         and d.revoked_at is null
         and timezone('utc', now()) between d.starts_at and d.ends_at
    )
  )
  or public.has_support_access(p_org, true);
$$;

comment on function public.has_org_role(uuid, text[]) is
  'Membership role, a live delegation conferring `manager`, or an active support session. Every managerial policy calls this, so delegation is enforced in one place (CAP-090).';

-- ── creating and ending one ───────────────────────────────────────────
create or replace function public.delegate_role(
  p_org   uuid,
  p_to    uuid,
  p_until timestamptz,
  p_note  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Read the caller's OWN membership rather than calling `has_org_role`:
  -- that function now returns true for a delegate, and a delegate must not
  -- be able to delegate onwards. This is the same reasoning `0102` used for
  -- the MFA switch not guarding itself with the thing it changes.
  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = auth.uid()
       and m.status = 'active' and m.role in ('owner', 'manager')
  ) then
    raise exception 'Only an owner or manager may delegate cover'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = p_to and m.status = 'active'
  ) then
    raise exception 'That person is not in this organisation'
      using errcode = '42501';
  end if;

  if p_until <= timezone('utc', now()) then
    raise exception 'Cover has to end in the future' using errcode = '22023';
  end if;

  -- One live delegation per pair. Handing the same person cover twice is a
  -- mistake, and two overlapping rows make "when does this end" unanswerable.
  update public.role_delegations
     set revoked_at = timezone('utc', now())
   where org_id = p_org and from_user_id = auth.uid() and to_user_id = p_to
     and revoked_at is null;

  insert into public.role_delegations (org_id, from_user_id, to_user_id, ends_at, note)
  values (p_org, auth.uid(), p_to, p_until, p_note)
  returning id into v_id;

  perform public.audit_write(
    p_org, 'org.role_delegated', 'role_delegations', v_id,
    jsonb_build_object('to_user_id', p_to, 'ends_at', p_until),
    'warning');

  return v_id;
end;
$$;

comment on function public.delegate_role(uuid, uuid, timestamptz, text) is
  'Lends managerial authority for a bounded period. Reads the caller''s own membership rather than has_org_role, so a delegate cannot delegate onwards (CAP-090).';

create or replace function public.revoke_delegation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from uuid;
begin
  select org_id, from_user_id into v_org, v_from
    from public.role_delegations where id = p_id and revoked_at is null;

  if v_org is null then
    raise exception 'That cover has already ended' using errcode = 'P0002';
  end if;

  -- The person who lent it, or anybody with a real owner/manager membership.
  -- Deliberately NOT `has_org_role`, so a delegate cannot end the delegation
  -- of a colleague — or, more to the point, of the person who granted theirs.
  if not (
    v_from = auth.uid()
    or exists (
      select 1 from public.memberships m
       where m.org_id = v_org and m.user_id = auth.uid()
         and m.status = 'active' and m.role in ('owner', 'manager')
    )
  ) then
    raise exception 'Only the person who arranged this cover, or a manager, may end it'
      using errcode = '42501';
  end if;

  update public.role_delegations
     set revoked_at = timezone('utc', now())
   where id = p_id;

  perform public.audit_write(
    v_org, 'org.role_delegation_revoked', 'role_delegations', p_id, '{}'::jsonb, 'notice');
end;
$$;

revoke all on function public.delegate_role(uuid, uuid, timestamptz, text) from public, anon;
revoke all on function public.revoke_delegation(uuid) from public, anon;
grant execute on function public.delegate_role(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.revoke_delegation(uuid) to authenticated;

-- NOTE: `log_audit_event` is deliberately NOT touched. It is the
-- client-callable wrapper with its own eight-action allow-list; the two
-- writes above go through `audit_write`, which is SECURITY DEFINER, revoked
-- from every client role, and validates nothing. Rewriting the allow-list
-- from memory here would have dropped six actions that are in it — the exact
-- drift this project keeps finding.
