-- =====================================================================
-- 0146_only_the_decision_function_approves_a_swap.sql
--
-- Three write surfaces wider than the function that is supposed to own them.
-- Found by running the query `0145` should have prompted: compare what an RPC
-- protects against what the table lets through.
--
--   select t.table_name, string_agg(distinct t.privilege_type, ',')
--     from information_schema.role_table_grants t
--    where t.grantee = 'authenticated'
--      and t.privilege_type in ('INSERT','UPDATE','DELETE')
--    group by t.table_name;
--
-- ## 1. A swap could be approved without the shift ever moving
--
-- `decide_shift_swap` (`0123`) is the intended sole writer of an approval. It
-- takes `for update` on the swap AND the shift, refuses an archived rota, and
-- — the entire point — reassigns the shift to the other person. Its own header
-- says the role checks are "unchanged from the RLS policies this replaces".
-- The policies were meant to be replaced. They were left in place:
--
--   shift_swaps_write            CHECK: (requester AND status in (pending,
--                                        cancelled)) OR has_org_role(owner,manager)
--   shift_swaps_requester_finalize CHECK: requester AND status in (approved, rejected)
--
-- The second branch of `shift_swaps_write` carries no status restriction at
-- all, so an owner or manager can `update shift_swaps set status = 'approved'`
-- directly; `requester_finalize` names `approved` outright. Either writes the
-- approval WITHOUT the reassignment, leaving a swap that every screen reports
-- as approved while both people keep the shifts they started with. Nothing in
-- the app takes that path today (`swapService.decideShiftSwap` calls the RPC),
-- which is what makes it the dangerous kind: a second door nobody walks
-- through and nobody is watching.
--
-- Fixed by narrowing the two CHECKs rather than by adding a trigger. The
-- transition is the thing being controlled, and a CHECK on the transition is
-- where it belongs. `decide_shift_swap` is SECURITY DEFINER and bypasses RLS,
-- so it is unaffected — which is the point: it becomes the only path.
--
-- Deliberately NOT touched: the requester may still write `rejected` (that is
-- withdrawing your own request, and it moves no shift), the target may still
-- accept or reject, and an open swap may still be claimed. Only `approved` is
-- taken away from every client path.
--
-- ## 2. Three tables where the control is the ABSENCE of a policy
--
-- `platform_admins`, `subscriptions` and `audit_logs` each carry full
-- INSERT/UPDATE/DELETE to `authenticated` from `0056`, with no write policy at
-- all. RLS blocks them today, so nothing is exploitable — but `0015` states the
-- design as "the absence of a policy is the control", and a grant sitting there
-- means the day somebody adds one permissive policy for a good reason, they
-- also hand out three they never considered.
--
-- That is exactly the shape `require_mfa` had before `0145`: one added policy
-- away from a hole. These are the three where it would matter most —
-- `platform_admins` holds `role` and `revoked_at`, which `0140` and `0144` just
-- spent two migrations protecting; `subscriptions` holds `plan`, `status` and
-- `stripe_customer_id`; and `audit_logs` is supposed to be append-only, so an
-- UPDATE or DELETE grant on it contradicts the immutability the whole register
-- depends on.
--
-- `table_grant_invariants.test.sql` gains the assertion, so a future grant
-- fails CI rather than waiting for another audit.
--
-- ## Not changed, and written down instead of left silent
--
-- `memberships` grants UPDATE on every column including `role`, under
-- `memberships_write` = `has_org_role(org_id, ['owner'])`. Since `0028` that
-- folds in `has_support_access(org, true)`, so a platform administrator holding
-- a read_write support session can set `role = 'owner'` directly, bypassing
-- `transfer_ownership` and its one-transaction promote/demote. That may be
-- intended — a support session is meant to be able to act as an owner — but it
-- is not written down anywhere, and changing it would alter what a support
-- session means. Recorded in `docs/SAAS.md` as a decision to take, not taken
-- here.
--
-- ## Rollback
--
-- Restore both policies from their original migrations and re-grant the three
-- tables. The swap narrowing is the one to think about: reverting it reopens
-- the second write path.
-- =====================================================================

-- ---------- 1. only the function approves ------------------------------

drop policy if exists shift_swaps_write on public.shift_swaps;

create policy shift_swaps_write on public.shift_swaps
  for all
  using (
    requested_by = public.my_staff_profile_id(org_id)
    or public.has_org_role(org_id, array['owner', 'manager'])
  )
  with check (
    (
      requested_by = public.my_staff_profile_id(org_id)
      and status = any (array['pending', 'cancelled'])
    )
    or (
      public.has_org_role(org_id, array['owner', 'manager'])
      -- The added clause. An approval moves a shift, and only
      -- `decide_shift_swap` moves it; writing the status here would record a
      -- decision that never happened.
      and status <> 'approved'
    )
  );

comment on policy shift_swaps_write on public.shift_swaps is
  'A requester manages their own pending or cancelled request; an owner or manager manages any swap EXCEPT approving it. Approval writes through decide_shift_swap (0123), which also reassigns the shift — a direct write would mark the swap approved and move nothing (0146).';

drop policy if exists shift_swaps_requester_finalize on public.shift_swaps;

create policy shift_swaps_requester_finalize on public.shift_swaps
  for update
  using (
    requested_by = public.my_staff_profile_id(org_id)
    and status = 'accepted'
    and target_staff_profile_id is not null
  )
  with check (
    requested_by = public.my_staff_profile_id(org_id)
    -- `approved` removed. Withdrawing your own request moves no shift and
    -- stays; accepting the other person's offer is a reassignment and goes
    -- through the function.
    and status = 'rejected'
  );

comment on policy shift_swaps_requester_finalize on public.shift_swaps is
  'The requester may reject their own accepted swap, which moves no shift. Approving it does move one, so it goes through decide_shift_swap (0146).';

-- ---------- 2. take back the writes nothing uses -----------------------

revoke insert, update, delete on public.platform_admins from authenticated;
revoke insert, update, delete on public.subscriptions   from authenticated;
revoke insert, update, delete on public.audit_logs      from authenticated;

comment on table public.platform_admins is
  'Platform role grants. Written ONLY by grant_platform_role and revoke_platform_role (0015, hardened by 0140 and 0144). 0056 granted authenticated full writes and no policy admitted them; 0146 took the grant back so the absence of a policy is no longer the only thing standing there.';
comment on table public.audit_logs is
  'Append-only. Written by audit_write alone. The UPDATE and DELETE grants 0056 handed to authenticated contradicted that outright and were revoked by 0146.';
