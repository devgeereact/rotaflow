-- =====================================================================
-- 0037_close_self_approval_gaps.sql — staff cannot approve their own
-- requests, forge clock events, spoof invite identity, read notifications
-- without an audited support session, or demote the platform's last owner.
--
-- All six gaps below share the same root shape: 0002's `for all` personal-
-- table policies and a couple of SECURITY DEFINER functions were written to
-- let staff act on their OWN rows, but never restricted WHAT they could turn
-- those rows into. A comment on every affected write path already said
-- "RLS (has_org_role) is the real enforcement" — true for everyone else's
-- rows, false for the caller's own. Found in a full-codebase security audit,
-- 2026-08-10.
-- =====================================================================

-- ---------- 1. leave_requests / overtime_requests / timesheets ----------
-- Staff may create and cancel their own; only a manager/owner may move any
-- of these into an approved (or exported) state. Managers keep the
-- unrestricted branch the loop in 0002 already gave them.
drop policy if exists leave_requests_write on public.leave_requests;
create policy leave_requests_write on public.leave_requests for all
  using (staff_profile_id = public.my_staff_profile_id(org_id)
         or public.has_org_role(org_id, array['owner','manager']))
  with check (
    (staff_profile_id = public.my_staff_profile_id(org_id)
      and status in ('pending','cancelled'))
    or public.has_org_role(org_id, array['owner','manager'])
  );

drop policy if exists overtime_requests_write on public.overtime_requests;
create policy overtime_requests_write on public.overtime_requests for all
  using (staff_profile_id = public.my_staff_profile_id(org_id)
         or public.has_org_role(org_id, array['owner','manager']))
  with check (
    (staff_profile_id = public.my_staff_profile_id(org_id) and status = 'pending')
    or public.has_org_role(org_id, array['owner','manager'])
  );

drop policy if exists timesheets_write on public.timesheets;
create policy timesheets_write on public.timesheets for all
  using (staff_profile_id = public.my_staff_profile_id(org_id)
         or public.has_org_role(org_id, array['owner','manager']))
  with check (
    (staff_profile_id = public.my_staff_profile_id(org_id)
      and status in ('open','submitted'))
    or public.has_org_role(org_id, array['owner','manager'])
  );

-- ---------- 2. shift_swaps: the requester cannot self-approve -----------
-- Mirrors 0008's narrower grant for the target: a requester may still create
-- (pending) and withdraw (cancelled) their own swap, never sign it off.
drop policy if exists shift_swaps_write on public.shift_swaps;
create policy shift_swaps_write on public.shift_swaps for all
  using (requested_by = public.my_staff_profile_id(org_id)
         or public.has_org_role(org_id, array['owner','manager']))
  with check (
    (requested_by = public.my_staff_profile_id(org_id)
      and status in ('pending','cancelled'))
    or public.has_org_role(org_id, array['owner','manager'])
  );

-- ---------- 3. clock_events: append-only for staff -----------------------
-- The loop in 0002 gave staff a `for all` grant on their own rows, which
-- means the evidence of when someone worked could be retroactively edited or
-- deleted by the person it evidences. Split into per-command policies: staff
-- may only INSERT their own; only a manager/owner may UPDATE or DELETE any.
drop policy if exists clock_events_write on public.clock_events;

create policy clock_events_insert on public.clock_events for insert
  with check (staff_profile_id = public.my_staff_profile_id(org_id)
              or public.has_org_role(org_id, array['owner','manager']));

create policy clock_events_update on public.clock_events for update
  using (public.has_org_role(org_id, array['owner','manager']))
  with check (public.has_org_role(org_id, array['owner','manager']));

create policy clock_events_delete on public.clock_events for delete
  using (public.has_org_role(org_id, array['owner','manager']));

-- A client-supplied `event_at` is still trusted, but only within a window a
-- genuine offline sync can produce (`src/lib/offlineOutbox.ts`, `useSyncQueue`
-- — built for a shift's length of lost connectivity, not days). Outside that
-- window, or when absent, the server's own clock wins. Managers are exempt:
-- correcting a clock event to its real time is their job (`clock_events_update`
-- above), and this trigger only runs on INSERT.
--
-- This does not make clock-in forgery-proof — a client within the 72h window
-- can still claim any timestamp inside it. Closing that fully needs a signed
-- local clock or mandatory manager sign-off on every event, both bigger
-- changes than a bug-fix pass; this closes the unbounded version of the hole
-- ("clocked in this morning" claimed a week later) and, combined with #3
-- above, the retroactive-editing version entirely.
create or replace function public.clock_events_guard_event_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(new.org_id, array['owner','manager']) then
    if new.event_at is null
       or new.event_at > timezone('utc', now()) + interval '5 minutes'
       or new.event_at < timezone('utc', now()) - interval '72 hours' then
      new.event_at := timezone('utc', now());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clock_events_guard_event_at_trg on public.clock_events;
create trigger clock_events_guard_event_at_trg
  before insert on public.clock_events
  for each row execute function public.clock_events_guard_event_at();

-- A trigger function needs no RPC surface — PostgREST exposes every function
-- at /rest/v1/rpc/<name> by default, so left ungranted this reads as "anyone
-- can call it directly". They can't do anything through it (no NEW record
-- outside a real trigger fire), but the fix is one line and matches how
-- every other definer function here is deliberately revoked from anon.
revoke all on function public.clock_events_guard_event_at() from public, anon, authenticated;

-- ---------- 4. accept_invite(): identity from auth.users, not profiles ---
-- profiles.email is client-writable (0015 grants it — "neither is a
-- privilege", which this function is exactly why that was wrong). Reading
-- identity from auth.users instead closes the invite-forwarding takeover: a
-- user can no longer rewrite their own claimed email to match a leaked or
-- forwarded invite token.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite     public.invites;
  v_user_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept this invitation' using errcode = '28000';
  end if;

  select lower(email) into v_user_email from auth.users where id = auth.uid();
  if v_user_email is null then
    raise exception 'No account for the current user' using errcode = 'P0002';
  end if;

  select * into v_invite
    from public.invites
   where token_hash = encode(sha256(p_token::bytea), 'hex')
   for update;

  if v_invite.id is null then
    raise exception 'This invitation link is not valid' using errcode = 'P0002';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'This invitation has been revoked' using errcode = 'P0002';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invitation has already been used' using errcode = 'P0002';
  end if;
  if v_invite.expires_at <= timezone('utc', now()) then
    raise exception 'This invitation has expired' using errcode = 'P0002';
  end if;

  -- See note 3 (0006): without this, a forwarded link is a free pass into
  -- the tenant. Must compare against the auth-verified address, not a
  -- client-writable column, or this check is decorative.
  if lower(v_invite.email) <> v_user_email then
    raise exception 'This invitation was sent to a different email address'
      using errcode = '42501';
  end if;

  insert into public.memberships (org_id, user_id, role, status)
  values (v_invite.org_id, auth.uid(), v_invite.role, 'active')
  on conflict (org_id, user_id)
    do update set role = excluded.role, status = 'active';

  update public.invites
     set accepted_at = timezone('utc', now()),
         accepted_by = auth.uid()
   where id = v_invite.id;

  return v_invite.org_id;
end;
$$;

-- Defence in depth: close the write path that made the exploit possible in
-- the first place. Verified against every call site (grep across src/) —
-- only `full_name` is ever written (ProfilePage); `email` is rendered
-- `disabled readOnly` there today.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- ---------- 5. notifications_select: route through the audited gate -----
-- 0028 redefined is_org_member()/has_org_role() so a platform admin reaches
-- tenant data only through an unrevoked, unexpired, audited support-access
-- session. This policy called is_platform_admin() directly and never picked
-- that up — the one tenant-data read in the schema that 0028 didn't reach.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (user_id = auth.uid() or public.has_support_access(org_id, false));

-- ---------- 6. grant_platform_role: never orphan platform administration -
-- revoke_platform_role already refuses to remove the last owner
-- ("a guard that lives only in the client is not a guard" — 0015). Granting
-- a DIFFERENT role to that same last owner reaches the identical end state
-- through the sibling function, which had no guard at all.
create or replace function public.grant_platform_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.has_platform_role(array['platform_owner']) then
    raise exception 'Only a platform owner can grant platform roles'
      using errcode = '42501';
  end if;

  if p_role not in ('platform_owner','platform_admin',
                    'platform_support','platform_finance') then
    raise exception 'Unknown platform role: %', p_role using errcode = '22023';
  end if;

  if p_role <> 'platform_owner'
     and exists (select 1 from public.platform_admins
                  where user_id = p_user and role = 'platform_owner'
                    and revoked_at is null)
     and (select count(*) from public.platform_admins
           where role = 'platform_owner' and revoked_at is null) <= 1 then
    raise exception 'Cannot change the last platform owner to a lesser role'
      using errcode = '23514';
  end if;

  insert into public.platform_admins (user_id, role, granted_by, granted_at,
                                      revoked_at, revoked_by)
  values (p_user, p_role, auth.uid(), timezone('utc', now()), null, null)
  on conflict (user_id) do update
    set role       = excluded.role,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        revoked_at = null,
        revoked_by = null;
end;
$$;

revoke all on function public.grant_platform_role(uuid, text) from public, anon;
grant execute on function public.grant_platform_role(uuid, text) to authenticated;

-- =====================================================================
-- done — 0037_close_self_approval_gaps.sql
-- =====================================================================
