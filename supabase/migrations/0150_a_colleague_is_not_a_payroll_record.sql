-- =====================================================================
-- 0150_a_colleague_is_not_a_payroll_record.sql — a member can see who
-- they work with, not what they are paid (docs/SAAS.md GAP-117)
--
-- ## The hole
--
-- `staff_profiles_select` is `using (is_org_member(org_id))` and
-- `authenticated` held SELECT on all twenty columns. So any staff
-- account — not a manager, any member at all — could ask PostgREST for
-- its colleagues' `payroll_id`, `email`, `phone`, `start_date` and
-- `holiday_allowance` and be handed them. Whatever the interface chose
-- to render was beside the point: the API answers the question it is
-- asked.
--
-- ## Why every existing check passed
--
-- This project's guard story is RLS, and **RLS is row-level**. It
-- decides whether you may see a row, never which columns of it. The
-- invariant suite, the pgTAP files and the seventeen IDOR probes all
-- ask cross-tenant questions, and this is a defect *inside* one tenant,
-- so none of them could have seen it. "Is RLS on?" and "is this person
-- allowed these fields?" are different questions and only the first was
-- ever being asked.
--
-- ## The shape of the fix
--
-- Column privileges are granted per ROLE, and a manager and a cleaner
-- are both `authenticated`. So the grant cannot tell them apart, and
-- narrowing it alone would take payroll away from the people whose job
-- it is. The split has to happen per row, at read time, which is what a
-- view can do and a grant cannot.
--
--   * `staff_profiles_visible` returns all twenty columns, with the
--     five personal ones nulled unless the reader is an owner or
--     manager of that organisation, or it is their own record.
--   * The five columns are then revoked from `authenticated` on the
--     base table, so the direct path cannot answer the question at all.
--     This is the half that makes it a control rather than a
--     convention: without it the view is just a politer way to ask.
--
-- `weekly_hours` and `contract_type` are deliberately NOT masked. They
-- are rostering facts — the assistant needs contract hours to spread
-- work fairly and the dashboard costs labour with them — and a
-- colleague can already read them off a published rota. Masking them
-- would break working features to hide something visible anyway.
--
-- `user_id` is likewise unmasked: it is an internal identifier with no
-- personal content, and `getMyStaffProfile` filters on it, which needs
-- SELECT to remain.
--
-- ## Why the view is definer, and what carries the tenancy guard
--
-- The view runs with the owner's rights (no `security_invoker`), which
-- it must: an invoker-rights view would need the reader to hold the
-- very column privileges being revoked below, and would fail for
-- everyone. That means RLS on `staff_profiles` does NOT apply to reads
-- through it, so the tenancy check `0119` exists to enforce is written
-- into the view's own WHERE clause. Read that line as load-bearing: it
-- is the only thing standing between one tenant and another here.
-- =====================================================================

-- `is_org_member` and `has_org_role` run once per row, and CANNOT be
-- hoisted. This comment said the opposite until the plan was read.
--
--   Filter: (SubPlan 1)
--   SubPlan 1 -> Result  Output: is_org_member(sp.org_id)
--
-- A plain `SubPlan`, not the `hashed SubPlan` with `loops=1` that `0136`
-- records as the win condition. Both helpers take `sp.org_id`, a column of
-- the row being tested, so they land in the row filter — which is exactly
-- what `0136` and `0137` were written to teach, and citing them for the
-- opposite claim was the mistake. The lateral does not help either: the
-- planner flattens it and repeats the `has_org_role(...) OR sp.id =
-- my_staff_profile_id(...)` expression once per masked column, five times
-- in the output list.
--
-- Left as it is, on purpose. `GAP-089` settled the rule after `0137`
-- measured 5.6x at the database and nothing end to end: convert a table
-- when a bulk read of it is predicate-bound, not because it matches the
-- pattern. A staff list is tens of rows, not the 50,000 that made
-- `clock_events` worth converting. If a screen ever reads staff in bulk,
-- measure it first, then use the `my_managed_org_ids()` set form from
-- `0136`.
create or replace view public.staff_profiles_visible as
select
  sp.id,
  sp.org_id,
  sp.user_id,
  sp.first_name,
  sp.last_name,
  sp.job_title,
  sp.job_title_id,
  sp.department_id,
  sp.contract_type,
  sp.weekly_hours,
  sp.skills,
  sp.photo_url,
  sp.active,
  sp.created_at,
  sp.updated_at,
  case when priv.allowed then sp.payroll_id end        as payroll_id,
  case when priv.allowed then sp.start_date end        as start_date,
  case when priv.allowed then sp.phone end             as phone,
  case when priv.allowed then sp.email end             as email,
  case when priv.allowed then sp.holiday_allowance end as holiday_allowance
from public.staff_profiles sp
cross join lateral (
  select
    has_org_role(sp.org_id, array['owner', 'manager'])
    or sp.id = my_staff_profile_id(sp.org_id) as allowed
) priv
-- LOAD-BEARING. The view is definer-rights, so `staff_profiles_select`
-- is not consulted for reads through it. Without this line every row of
-- every organisation would be returned to any signed-in user.
where (select is_org_member(sp.org_id));

comment on view public.staff_profiles_visible is
  'staff_profiles with payroll_id, start_date, phone, email and holiday_allowance nulled unless the reader manages that organisation or the row is their own. Definer-rights: the WHERE clause carries the tenancy check. See 0150 and docs/SAAS.md GAP-117.';

grant select on public.staff_profiles_visible to authenticated;

-- The half that makes it a control. Read privilege on the five personal
-- columns leaves `authenticated` entirely; the view above is now the
-- only way to obtain them, and it decides per row.
--
-- Not a destructive change in the sense the safety gate means: no data
-- is dropped and no privilege is granted. It REMOVES an over-broad
-- read, which is the direction this repository wants to travel.
--
-- ## Why this is a whole-table revoke and a re-grant, not a column revoke
--
-- `0056` granted `select` on the TABLE. A column-level revoke cannot
-- subtract from a table-level grant: PostgreSQL keeps the two sets of
-- privileges separately, the table grant continues to answer for every
-- column, and the statement reports success while changing nothing.
-- Proven on a local instance before this was written:
--
--   begin;
--   revoke select (payroll_id) on public.staff_profiles from authenticated;
--   select has_column_privilege('authenticated','public.staff_profiles',
--                               'payroll_id','SELECT');   -- => t
--   rollback;
--
-- So the table-level read is removed first, and the fifteen columns a
-- colleague may legitimately see are granted back one by one. `insert`,
-- `update` and `delete` stay at table level and are untouched: this is
-- a change to what may be READ.
--
-- The cost of a column grant is that it does not cover a column added
-- later — the class of defect that made onboarding step 2 a 403 for
-- every new customer until `0023` was found. That cost is paid on
-- purpose here and it is not left to memory:
-- `staff_profiles_column_accountability` in
-- `supabase/tests/database/staff_profile_column_visibility.test.sql`
-- fails the moment a column exists that is neither granted below nor
-- masked by the view above, so the next person to add one has to say
-- which of the two it is.
revoke select on public.staff_profiles from authenticated;

grant select (
  id,
  org_id,
  user_id,
  first_name,
  last_name,
  job_title,
  job_title_id,
  department_id,
  contract_type,
  weekly_hours,
  skills,
  photo_url,
  active,
  created_at,
  updated_at
) on public.staff_profiles to authenticated;
