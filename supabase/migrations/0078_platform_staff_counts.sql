-- =====================================================================
-- 0078_platform_staff_counts.sql — the console's seat-usage bar counts
-- the same people the seat limit is enforced on (docs/SAAS.md BUG-062)
--
-- 0070 made `plans.seat_limit` a real control and defined a seat as an
-- ACTIVE `staff_profiles` row, matching what the customer's own
-- Settings → Billing screen counts. Its header flagged, and deferred,
-- that the platform console disagrees:
--
--     "Note the platform console counts MEMBERSHIPS instead for its
--      usage bar, so it can disagree with both. That mismatch is
--      recorded as BUG-062 rather than quietly resolved here — changing
--      what the console means is a product decision, not a migration."
--
-- It is resolved now, and the direction is not really in doubt: the
-- console should report the number that is enforced.
--
-- ## Why the two numbers differ, and by how much
--
-- A `staff_profile` is a person on the rota. A `membership` is a login
-- account. `staff_profiles.user_id` is nullable — most rostered staff in
-- a care home or a bar never sign in at all — so an organisation can
-- easily have 40 active staff and 3 accounts.
--
-- That organisation's console row said "Usage 20%" while the database
-- was refusing its 16th staff member. A platform administrator asking
-- "why can this customer not add anyone?" was reading a bar with plenty
-- of room on it. The failure is quiet, and it points support at the
-- wrong answer, which is worse than showing nothing.
--
-- ## Why an RPC rather than reading the table
--
-- Exactly the reason 0054 gives for `platform_location_counts()`. 0028
-- redefined `is_org_member()` so a platform administrator needs an
-- active support session, and `staff_profiles` is not in 0031's
-- "customer register" carve-out. Reading the table directly across every
-- tenant would return zero rows for every organisation nobody has a
-- session open on — the console would go from the wrong number to a
-- confidently wrong zero.
--
-- Aggregate only, never a row. A support session is not needed to know
-- an organisation has 248 staff; it is needed to know who they are.
--
-- MIGRATION RISK. One new function. No table altered, no row rewritten,
-- no policy touched. Nothing calls it until the console does.
-- =====================================================================

create or replace function public.platform_staff_counts()
returns table (org_id uuid, staff_active bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform staff can read platform staff counts'
      using errcode = '42501';
  end if;

  -- `active` only, because that is what 0070's trigger counts. If these two
  -- ever diverge again the console is lying, so they are worth keeping in
  -- the same sentence: enforce_seat_limit() counts
  -- `staff_profiles where org_id = ... and active is true`.
  return query
    select s.org_id, count(*) as staff_active
      from public.staff_profiles s
     where s.active is true
     group by s.org_id;
end;
$$;

comment on function public.platform_staff_counts() is
  'Active staff per organisation, across every tenant. Aggregate only — never a row — so it needs no support-access session. This is the population plans.seat_limit is enforced on (0070); the console must not use memberships for that, see BUG-062.';

revoke all on function public.platform_staff_counts() from public, anon;
grant execute on function public.platform_staff_counts() to authenticated;
