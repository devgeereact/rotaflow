-- =====================================================================
-- 0138_the_last_platform_owner_survives_a_race.sql
--
-- ## The defect
--
-- `grant_platform_role` and `revoke_platform_role` both protect the last
-- platform owner with an unlocked `count(*)`:
--
--   if exists (… p_user is an owner …)
--      and (select count(*) from public.platform_admins
--            where role = 'platform_owner' and revoked_at is null) <= 1
--   then raise …
--
-- Under `read committed` — the default, and what PostgREST uses — two
-- concurrent transactions each read the pre-image of two owners, each pass the
-- guard, and each then update a DIFFERENT row. There is no row-level conflict,
-- so nothing blocks and both commit.
--
-- Reproduced on a rebuilt local database with exactly two owners:
--
--   session A: begin; revoke_platform_role(B)   -> ok (uncommitted)
--   session B: begin; revoke_platform_role(A)   -> ok; commit
--   session A: commit
--   OWNERS REMAINING: 0
--
-- ## Why this is worse than an ordinary race
--
-- The end state cannot be repaired from inside the product. Every route back
-- requires being a platform owner: `grant_platform_role`,
-- `revoke_platform_role` and `set_platform_mfa_required` all guard on
-- `has_platform_role(array['platform_owner'])`. With zero owners nobody can
-- ever grant a platform role again, and recovery means direct database access
-- to a production instance that has no backup (GAP-036). A guard whose failure
-- mode is "the product is permanently unadministrable" earns a lock.
--
-- ## The fix
--
-- Take a row lock over the live owner set before counting it. `for update`
-- makes the second transaction block on the first, then re-read after it
-- commits, so it sees one owner rather than two and raises as intended.
--
-- Verified by re-running the same race against these bodies: the second
-- session blocks, then fails with `Cannot revoke the last platform owner`,
-- and one owner remains.
--
-- `for update` and not `for share`: two transactions can both hold a share
-- lock, pass the count together and deadlock or proceed exactly as before.
-- The set is at most a handful of rows and this path runs when somebody
-- changes an administrator, so the contention cost is irrelevant.
--
-- ## Rollback
--
-- Re-issue both functions from `0015`. Nothing else changes: the guards, the
-- messages, the error codes and the audit behaviour are reproduced exactly,
-- with the lock added ahead of the count.
-- =====================================================================

create or replace function public.revoke_platform_role(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_count integer;
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
end;
$$;

create or replace function public.grant_platform_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_count integer;
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

  -- Same lock, same reason: demoting the last owner to a lesser role empties
  -- the set exactly as revoking them does, and the two paths can race each
  -- other as easily as two revocations can.
  perform 1 from public.platform_admins
   where role = 'platform_owner' and revoked_at is null
     for update;

  select count(*) into v_owner_count
    from public.platform_admins
   where role = 'platform_owner' and revoked_at is null;

  if p_role <> 'platform_owner'
     and exists (select 1 from public.platform_admins
                  where user_id = p_user and role = 'platform_owner'
                    and revoked_at is null)
     and v_owner_count <= 1 then
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

revoke all on function public.revoke_platform_role(uuid) from public, anon;
grant execute on function public.revoke_platform_role(uuid) to authenticated;

revoke all on function public.grant_platform_role(uuid, text) from public, anon;
grant execute on function public.grant_platform_role(uuid, text) to authenticated;

comment on function public.revoke_platform_role(uuid) is
  'Revokes a platform grant. Platform owners only. Locks the live owner set before counting it, so two concurrent revocations cannot both pass the last-owner guard (0138).';
comment on function public.grant_platform_role(uuid, text) is
  'Grants or changes a platform role. Platform owners only. Same lock as revoke: demoting the last owner empties the set just as revoking them does (0138).';
