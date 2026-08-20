-- =====================================================================
-- 0038_leave_requests_date_order_check.sql
--
-- Defence in depth for a reversed leave date range (end before start).
-- LeaveRequestModal.tsx had no <form> and only a `min` attribute on the End
-- input, which doesn't re-validate once Start changes after End is already
-- picked — so a reversed range submitted silently. Downstream:
-- leaveEntitlement.ts clamped the day count to 0 (consuming no allowance),
-- leaveRows.ts clamped it back up to 1 (displaying it as a single day), and
-- rotaInsights.ts's leaveCovers never matched a real date (never flagging
-- the person as on leave) — approved leave that cost no allowance and
-- blocked nothing. The client now refuses to submit a reversed range; this
-- closes the same hole for any other write path (import, a future API).
--
-- No existing rows violate this (verified with a read-only count before
-- applying).
-- =====================================================================

alter table public.leave_requests
  add constraint leave_requests_date_order check (end_date >= start_date);
