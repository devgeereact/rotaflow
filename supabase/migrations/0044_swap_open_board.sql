-- =====================================================================
-- 0044_swap_open_board.sql — let colleagues see and claim an open swap
--
-- SCREENS.swaps ("open to anyone" / "Take this shift") posts an
-- untargeted swap to a board every eligible colleague can see and claim.
-- Two gaps stood in the way:
--
-- 1. shift_swaps_select (0002) only ever granted read access to the
--    requester, the named target, and managers. An untargeted row has no
--    named target, so nobody but the requester and a manager could even
--    see it — there was no "board" for a colleague to browse.
--
-- 2. Nothing granted a colleague write access to an untargeted row at
--    all. shift_swaps_target_respond (0008) requires target_staff_
--    profile_id to already equal the caller, which is impossible before
--    a claim. respondToShiftSwap always 404'd via RLS on an open swap.
--
-- Claiming sets target_staff_profile_id to the claimer and jumps straight
-- to 'accepted' — the claim itself is their consent, there is no separate
-- "respond" step left to take. From there the row is indistinguishable
-- from a named offer the target already accepted: a manager can approve
-- it (shift_swaps_write), or, since it now has a named target the same as
-- any other accepted swap, the requester can finalize it themselves
-- (shift_swaps_requester_finalize, 0043) — two specific people have now
-- agreed, same as the named-offer case that policy already covers.
-- =====================================================================

drop policy if exists shift_swaps_select_open_board on public.shift_swaps;
create policy shift_swaps_select_open_board on public.shift_swaps for select
  using (
    target_staff_profile_id is null
    and status = 'pending'
    and public.is_org_member(org_id)
  );

drop policy if exists shift_swaps_claim_open on public.shift_swaps;
create policy shift_swaps_claim_open on public.shift_swaps for update
  using (
    target_staff_profile_id is null
    and status = 'pending'
    and requested_by <> public.my_staff_profile_id(org_id)
    and public.is_org_member(org_id)
  )
  with check (
    target_staff_profile_id = public.my_staff_profile_id(org_id)
    and status = 'accepted'
  );
