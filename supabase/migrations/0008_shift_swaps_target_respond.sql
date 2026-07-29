-- =====================================================================
-- 0008_shift_swaps_target_respond.sql — let the target colleague respond
--
-- shift_swaps.status supports a two-stage flow: 'pending' -> 'accepted' (the
-- colleague agrees) -> 'approved' (a manager signs off) — or 'rejected' at
-- either stage. But shift_swaps_write (0002_rotaflow.sql) only ever granted
-- write access to requested_by and managers. The person the swap actually
-- targets — target_staff_profile_id — could see the row (shift_swaps_select
-- includes them) but had no way to act on it. Flagged as a known gap when
-- swapService.ts first landed in Phase 4 (requester-only, no UI yet); this is
-- the fix, now that Phase 6 builds the screen that needs it.
--
-- A separate, narrower policy rather than widening shift_swaps_write, because
-- the target's grant must be much smaller than the requester's or a manager's:
--   - only on a row that is STILL pending (using) — no flip-flopping a swap
--     back and forth once it has already been responded to
--   - only INTO 'accepted' or 'rejected' (with check) — never 'approved'
--     (manager-only) or 'cancelled' (requester/manager-only)
--
-- Known limitation: RLS's `using`/`with check` can't diff old vs. new column
-- values against each other in one policy, so this does not stop the target
-- from also rewriting `note` in the same UPDATE that sets status. Locking
-- that down needs a BEFORE UPDATE trigger; not worth the complexity for a
-- free-text note field a manager can already see and overrule.
-- =====================================================================

drop policy if exists shift_swaps_target_respond on public.shift_swaps;
create policy shift_swaps_target_respond on public.shift_swaps for update
  using (
    target_staff_profile_id = public.my_staff_profile_id(org_id)
    and status = 'pending'
  )
  with check (
    target_staff_profile_id = public.my_staff_profile_id(org_id)
    and status in ('accepted', 'rejected')
  );
