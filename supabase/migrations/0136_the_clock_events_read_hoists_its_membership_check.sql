-- =====================================================================
-- 0136_the_clock_events_read_hoists_its_membership_check.sql —
-- the SELECT policy is evaluated once, not once per row
-- (docs/SAAS.md GAP-083)
--
-- ## What was wrong, measured rather than suspected
--
-- `clock_events_select` was:
--
--   staff_profile_id = my_staff_profile_id(org_id)
--   OR has_org_role(org_id, array['owner','manager'])
--
-- Both helpers take `org_id`, which is a COLUMN of the row being
-- tested, so PostgreSQL cannot hoist either out of the scan. They land
-- in the row filter and run once per row: two SECURITY DEFINER function
-- calls, each with its own subquery, fifty thousand times.
--
-- Measured on a local stack against the GAP-071 dataset (20 locations,
-- 250 staff, 10,000 shifts, 50,000 clock events), as `authenticated`
-- with the caller's own JWT claims, three warm runs each, counting the
-- 50,000 rows of a five-month window:
--
--   this policy as it was    755 ms, 764 ms, 771 ms
--   this policy as it is      4.5 ms, 4.8 ms, 5.0 ms
--
-- About 160x. The plan says why: the membership lookup becomes a
-- `hashed SubPlan` with `loops=1` and every row is then a hash probe,
-- instead of `loops=50000` function calls.
--
-- Note what this is NOT. An earlier reading of the same slowness blamed
-- OFFSET paging. It does not: a deep page (offset 49000) measured 685 ms
-- against 648 ms for the whole scan. The per-row predicate is the entire
-- cost.
--
-- ## Equivalence is the whole risk, so it is spelled out
--
-- `my_managed_org_ids()` reproduces all THREE branches of
-- `has_org_role(org, array['owner','manager'])`, in the same order:
--
--   1. an active `memberships` row with role owner or manager;
--   2. a live `role_delegations` grant, joined to the DELEGATOR's own
--      membership so authority cannot be passed onwards — the same join
--      `has_org_role` makes, and the reason a delegation chain is not a
--      thing;
--   3. an active support-access session. Note `has_org_role` calls
--      `has_support_access(p_org, TRUE)`, so a READ-scope session does
--      not confer org role and this branch carries
--      `s.scope = 'read_write'` to match. Dropping that word would hand
--      every read-only support session a manager's view of attendance,
--      which is exactly the class of thing `0028` exists to prevent.
--
-- `my_staff_profile_ids()` replaces `staff_profile_id =
-- my_staff_profile_id(org_id)`. The original scopes the lookup by org
-- and takes `limit 1`; this matches on profile id alone. That is
-- equivalent because a `staff_profiles` row belongs to exactly one
-- organisation, so the profile determines the org rather than the other
-- way round — and it is strictly safer, because the original's `limit 1`
-- picks arbitrarily if a person somehow holds two profiles in one org,
-- where this matches both.
--
-- ## Deliberately narrow
--
-- Only the SELECT policy changes. INSERT and DELETE are evaluated for
-- one row at a time, so the per-row cost is not a cost there, and
-- leaving them alone halves what has to be re-proved. `has_org_role`
-- itself is untouched and remains the single definition every other
-- policy uses; this migration adds a set-returning view of the same
-- rule rather than a second copy of the rule's intent.
--
-- Sixty other tables carry the same shape. This one is the worked
-- example, deliberately: the pattern is proved here, with the tests, and
-- the rest is a decision to take separately.
--
-- ## Migration risk
--
-- Two new functions and one replaced policy. No table altered, no row
-- rewritten, no grant widened. Reversible by dropping the policy and
-- recreating it with the predicate quoted at the top of this file.
-- Guarded by `supabase/tests/database/clock_events_rls_equivalence.test.sql`,
-- which asserts identical row sets for an owner, a manager, a staff
-- member, a delegated manager, a read-scope support session, a
-- read_write support session and a second tenant.
-- =====================================================================

create or replace function public.my_managed_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- 1. Direct membership.
  select m.org_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.status = 'active'
     and m.role = any (array['owner', 'manager'])

  union

  -- 2. A live delegation, which confers `manager` and nothing else. It
  --    joins the delegator's MEMBERSHIP, never another delegation:
  --    authority cannot be passed onwards.
  select d.org_id
    from public.role_delegations d
    join public.memberships giver
      on giver.org_id = d.org_id
     and giver.user_id = d.from_user_id
     and giver.status = 'active'
     and giver.role in ('owner', 'manager')
    join public.memberships taker
      on taker.org_id = d.org_id
     and taker.user_id = (select auth.uid())
     and taker.status = 'active'
   where d.to_user_id = (select auth.uid())
     and d.revoked_at is null
     and timezone('utc', now()) between d.starts_at and d.ends_at

  union

  -- 3. An active support-access session at READ_WRITE scope, because
  --    that is what `has_org_role` asks for (`has_support_access(org,
  --    true)`). Every other condition is `has_support_access`'s own: not
  --    revoked, not expired, the customer still consents, and the holder
  --    is still platform staff.
  select s.org_id
    from public.support_access_sessions s
    join public.organisations o on o.id = s.org_id
   where s.admin_user_id = (select auth.uid())
     and s.revoked_at is null
     and s.expires_at > timezone('utc', now())
     and s.scope = 'read_write'
     and o.support_access_allowed
     and exists (
       select 1
         from public.platform_admins pa
        where pa.user_id = s.admin_user_id
          and pa.revoked_at is null
     );
$$;

comment on function public.my_managed_org_ids() is
  'Organisations where the caller holds owner or manager authority, by '
  'membership, live delegation or a read_write support session. The same rule '
  'has_org_role(org, {owner,manager}) applies, expressed as a set so an RLS '
  'policy can use it uncorrelated and the planner evaluates it once (0136).';

create or replace function public.my_staff_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select sp.id from public.staff_profiles sp where sp.user_id = (select auth.uid());
$$;

comment on function public.my_staff_profile_ids() is
  'Every staff profile belonging to the caller, across organisations. A '
  'profile belongs to exactly one organisation, so matching a row by profile '
  'id is org-scoped by construction (0136).';

revoke all on function public.my_managed_org_ids() from public, anon;
revoke all on function public.my_staff_profile_ids() from public, anon;
grant execute on function public.my_managed_org_ids() to authenticated;
grant execute on function public.my_staff_profile_ids() to authenticated;

drop policy if exists clock_events_select on public.clock_events;
create policy clock_events_select on public.clock_events
  for select
  using (
    -- Both subqueries are uncorrelated, which is the entire point: the
    -- planner runs each once and every row becomes a hash probe.
    org_id in (select public.my_managed_org_ids())
    or staff_profile_id in (select public.my_staff_profile_ids())
  );
