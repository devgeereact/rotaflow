-- =====================================================================
-- 0043_swap_requester_finalize.sql
--
-- A swap between two NAMED colleagues no longer needs a manager to close
-- it out. The sequence for that case becomes: requester offers (already
-- their consent) -> target accepts (`shift_swaps_target_respond`, 0008) ->
-- the REQUESTER gives a second, explicit final approval, which is what
-- actually moves the shift. Both people who are actually swapping
-- something have now said yes; a manager approving on top of that was
-- oversight for its own sake, not a decision anyone still needed to make.
--
-- Managers keep every capability they had — `shift_swaps_write`'s
-- manager/owner branch is untouched, so they can still approve, decline or
-- intervene on any swap at any stage. This is purely additive: a new,
-- narrow policy, mirroring 0008's shape exactly for the requester's side of
-- the same two-step handshake.
--
-- An "open to anyone" swap (target_staff_profile_id null) has no second
-- named colleague to close the loop, so it is deliberately excluded here —
-- those still need a manager, same as before.
-- =====================================================================

drop policy if exists shift_swaps_requester_finalize on public.shift_swaps;
create policy shift_swaps_requester_finalize on public.shift_swaps for update
  using (
    requested_by = public.my_staff_profile_id(org_id)
    and status = 'accepted'
    and target_staff_profile_id is not null
  )
  with check (
    requested_by = public.my_staff_profile_id(org_id)
    and status in ('approved', 'rejected')
  );
