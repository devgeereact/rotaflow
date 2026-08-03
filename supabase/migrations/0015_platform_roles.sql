-- =====================================================================
-- 0015_platform_roles.sql — granular platform administration roles
-- Additive & idempotent. Builds on 0001 and 0002; edits neither.
--
-- ## What this does NOT change
--
-- `profiles.is_platform_admin` keeps its exact meaning: the coarse "may act
-- at platform level" gate that 0002's `is_org_member()` and `has_org_role()`
-- already fold in. Not one policy from 0002 is touched. What this adds is
-- WHICH KIND of platform administrator someone is, so the console can gate
-- billing away from support staff and releases away from finance — without a
-- rewrite whose blast radius is every policy in the schema.
--
-- ## Which way the sync runs, and why
--
-- `platform_admins` is the source of truth; `profiles.is_platform_admin` is a
-- mirror maintained by trigger. The reverse — boolean as truth, table as
-- decoration — fails in the worst direction: a profile with the flag set and
-- no `platform_admins` row would hold unlimited cross-tenant read through
-- every 0002 helper while `has_platform_role()` returned false. That is
-- standing access with no recorded role and no revocation record, and the
-- drift would be invisible.
--
-- The obvious objection — "someone updates `profiles` directly and the mirror
-- goes wrong" — is answered structurally rather than by convention, using the
-- same mechanism 0010 used for `smtp_pass`: the UPDATE privilege on that
-- column is removed from `authenticated` entirely. No policy change and no
-- client bug can set it, because the privilege does not exist for the role.
--
-- ## The live defect this fixes
--
-- `profiles` RLS was still 0001's own-row-only policy — nothing in 0002-0014
-- ever widened it. So `/admin/users` was reading exactly one row (the admin's
-- own) and its platform-admin toggle updated zero rows and returned 204 with
-- no error: a control that looked like it worked and did nothing.
-- =====================================================================

-- ---------- The roster -------------------------------------------------
create table if not exists public.platform_admins (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  role        text not null default 'platform_support'
                check (role in ('platform_owner','platform_admin',
                                'platform_support','platform_finance')),
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default timezone('utc', now()),
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id) on delete set null,
  note        text,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

-- Partial: every read of this table that matters asks for live grants only.
create index if not exists platform_admins_active_idx
  on public.platform_admins (role) where revoked_at is null;

drop trigger if exists platform_admins_set_updated_at on public.platform_admins;
create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function public.set_updated_at();

-- ---------- The mirror -------------------------------------------------
create or replace function public.sync_platform_admin_flag()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  -- Recomputed from the table rather than toggled from the row, so the flag
  -- is correct after any operation including a delete. Updates zero rows
  -- when the profile is already gone (cascade delete), which is harmless.
  update public.profiles p
     set is_platform_admin = exists (
           select 1 from public.platform_admins pa
            where pa.user_id = v_user and pa.revoked_at is null)
   where p.id = v_user;
  return null;
end;
$$;

drop trigger if exists platform_admins_sync on public.platform_admins;
create trigger platform_admins_sync
  after insert or update or delete on public.platform_admins
  for each row execute function public.sync_platform_admin_flag();

-- ---------- Backfill, before anything gates on the new table -----------
-- Order matters. If a later migration or deploy started checking
-- `has_platform_role()` before this ran, every existing Super Admin would
-- keep standing cross-tenant read (the boolean) while failing every action
-- check in the console — they would see the area and be denied inside it.
insert into public.platform_admins (user_id, role, note)
select p.id, 'platform_owner', 'backfilled from profiles.is_platform_admin in 0015'
  from public.profiles p
 where p.is_platform_admin
on conflict (user_id) do nothing;

-- ---------- Close the direct write path --------------------------------
-- Same posture as 0010's `smtp_pass`. A revoke is not row-level: the columns
-- named below are the complete set the client may write, so any column left
-- out surfaces as a 42501 on whatever screen writes it. Today only
-- `full_name` is ever written (profileService.updateProfile, called once from
-- account/ProfilePage) — `avatar_url` and `email` are granted because they
-- are the two obvious next writes and neither is a privilege.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, email) on public.profiles to authenticated;

-- ---------- Read: platform admins can see the roster they administer ---
-- Deliberately NOT widened to co-members. Every member of an org reading
-- every other member's email address is a far bigger change than this needs,
-- and the reason it looks necessary — actor names on the audit screen — is
-- solved in 0016 by snapshotting the name onto the row instead of joining.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id or public.is_platform_admin());

-- ---------- Helpers (SECURITY DEFINER, bypass RLS) ---------------------
-- No implicit hierarchy: `platform_owner` is not silently folded into every
-- check. Callers name every role that may perform the action, because a
-- hidden escalation rule inside a boolean function is exactly the kind of
-- thing nobody re-reads once it is written.
create or replace function public.has_platform_role(p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.revoked_at is null
      and pa.role = any(p_roles)
  );
$$;

-- For the UI: which role am I? Null for everyone who holds none.
create or replace function public.my_platform_role()
returns text language sql stable security definer set search_path = public as $$
  select pa.role from public.platform_admins pa
   where pa.user_id = auth.uid() and pa.revoked_at is null;
$$;

-- Reusable set-returning helper for policies that need "the orgs I belong
-- to". A policy must NOT inline that as a subquery on `memberships`: a
-- subquery inside a policy runs under the caller's own RLS, which is the
-- recursion 0002's header exists to avoid.
create or replace function public.my_active_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from public.memberships
   where user_id = auth.uid() and status = 'active';
$$;

-- ---------- RLS on the roster -----------------------------------------
alter table public.platform_admins enable row level security;

drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select
  on public.platform_admins for select
  using (public.is_platform_admin() or user_id = auth.uid());

-- No insert/update/delete policy at all, deliberately. Grants go through the
-- SECURITY DEFINER RPCs below — same pattern as 0006's invites and 0002's
-- audit_logs: the absence of a policy is the control, so there is no write
-- path that skips the last-owner check.

-- ---------- Grant / revoke ---------------------------------------------
create or replace function public.grant_platform_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- SECURITY DEFINER bypasses RLS, so the permission check is explicit here
  -- (0006 makes the same note). Only an owner may create administrators.
  if not public.has_platform_role(array['platform_owner']) then
    raise exception 'Only a platform owner can grant platform roles'
      using errcode = '42501';
  end if;

  if p_role not in ('platform_owner','platform_admin',
                    'platform_support','platform_finance') then
    raise exception 'Unknown platform role: %', p_role using errcode = '22023';
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

create or replace function public.revoke_platform_role(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_platform_role(array['platform_owner']) then
    raise exception 'Only a platform owner can revoke platform roles'
      using errcode = '42501';
  end if;

  -- Never leave the platform with no owner. AdminUsersPage already refuses
  -- this client-side; a guard that lives only in the client is not a guard.
  if exists (select 1 from public.platform_admins
              where user_id = p_user
                and role = 'platform_owner'
                and revoked_at is null)
     and (select count(*) from public.platform_admins
           where role = 'platform_owner' and revoked_at is null) <= 1 then
    raise exception 'Cannot revoke the last platform owner' using errcode = '23514';
  end if;

  update public.platform_admins
     set revoked_at = timezone('utc', now()),
         revoked_by = auth.uid()
   where user_id = p_user and revoked_at is null;
end;
$$;

revoke all on function public.grant_platform_role(uuid, text) from public, anon;
revoke all on function public.revoke_platform_role(uuid)      from public, anon;
grant execute on function public.grant_platform_role(uuid, text) to authenticated;
grant execute on function public.revoke_platform_role(uuid)      to authenticated;
