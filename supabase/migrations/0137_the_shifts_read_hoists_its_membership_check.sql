-- =====================================================================
-- 0137_the_shifts_read_hoists_its_membership_check.sql — the second
-- worked example (docs/SAAS.md GAP-089, after `0136`)
--
-- ## What was wrong
--
--   is_org_member(org_id)
--   AND (rota_id IS NULL OR rota_is_readable(rota_id))
--
-- Both calls take a column of the row being tested, so neither hoists
-- and both run once per row. `rota_is_readable` is the expensive half:
-- it opens `rotas`, then calls `is_org_member` again and possibly
-- `has_org_role`, for every shift.
--
-- `0136` did the same job for `clock_events` and measured about 190x at
-- the database on 50,000 rows. This is the second table, chosen because
-- the rota builder reads a whole location's month in one go.
--
-- ## Two differences from `0136`, both load-bearing
--
-- **`is_org_member` is not `has_org_role`.** It accepts ANY active
-- membership, not just owner or manager, and it asks
-- `has_support_access(p_org, FALSE)` — so a READ-scope support session
-- counts here, where in `0136` it did not. `my_member_org_ids()` below
-- therefore has no `scope` filter, and that asymmetry is deliberate:
-- copying `0136`'s helper would have silently locked read-scope support
-- out of the rota.
--
-- **The rota predicate is keyed on `rota_id`, not `org_id`.** It cannot
-- be folded into an org check. It becomes a set of readable rota ids
-- instead, which is uncorrelated and cheap because `rotas` is small —
-- one row per location per week, against tens of thousands of shifts.
--
-- ## Equivalence
--
-- `my_member_org_ids()` reproduces `is_org_member`: an active
-- membership of any role, or a live support session at either scope
-- whose customer still consents and whose holder is still platform
-- staff.
--
-- `my_readable_rota_ids()` reproduces `rota_is_readable`: the rota
-- exists, its organisation is one the caller is a member of, and either
-- its status is `published` or `archived` or the caller holds
-- owner/manager there — reusing `my_managed_org_ids()` from `0136`
-- rather than restating that rule a second time.
--
-- The `rota_id IS NULL` branch is preserved exactly. A shift with no
-- rota is visible to any member, which is what the original said.
--
-- ## Deliberately narrow
--
-- Only `shifts_select` changes. `shifts_write` is `FOR ALL` and is
-- evaluated per statement on the rows it touches, so the per-row cost is
-- not the same problem there, and it uses `has_org_role` directly, which
-- remains the single definition.
--
-- ## Migration risk
--
-- Two new functions and one replaced policy. No table altered, no row
-- rewritten, no grant widened. Reversible by recreating the policy with
-- the predicate quoted at the top. Guarded by
-- `supabase/tests/database/shifts_rls_equivalence.test.sql`.
-- =====================================================================

create or replace function public.my_member_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- Any active membership, not only owner or manager.
  select m.org_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.status = 'active'

  union

  -- A live support-access session at EITHER scope, because
  -- `is_org_member` asks `has_support_access(p_org, false)`. Every other
  -- condition is that function's own.
  select s.org_id
    from public.support_access_sessions s
    join public.organisations o on o.id = s.org_id
   where s.admin_user_id = (select auth.uid())
     and s.revoked_at is null
     and s.expires_at > timezone('utc', now())
     and o.support_access_allowed
     and exists (
       select 1
         from public.platform_admins pa
        where pa.user_id = s.admin_user_id
          and pa.revoked_at is null
     );
$$;

comment on function public.my_member_org_ids() is
  'Organisations the caller belongs to, by active membership of any role or a '
  'live support session at either scope. The same rule is_org_member(org) '
  'applies, expressed as a set so a policy can use it uncorrelated (0137).';

create or replace function public.my_readable_rota_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
    from public.rotas r
   where r.org_id in (select public.my_member_org_ids())
     and (
       r.status in ('published', 'archived')
       or r.org_id in (select public.my_managed_org_ids())
     );
$$;

comment on function public.my_readable_rota_ids() is
  'Rotas the caller may read: published or archived in an organisation they '
  'belong to, or any rota in one they manage. The same rule '
  'rota_is_readable(id) applies, as a set (0137).';

revoke all on function public.my_member_org_ids() from public, anon;
revoke all on function public.my_readable_rota_ids() from public, anon;
grant execute on function public.my_member_org_ids() to authenticated;
grant execute on function public.my_readable_rota_ids() to authenticated;

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select
  using (
    org_id in (select public.my_member_org_ids())
    and (
      rota_id is null
      or rota_id in (select public.my_readable_rota_ids())
    )
  );
