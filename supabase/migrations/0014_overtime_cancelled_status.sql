-- =====================================================================
-- 0014_overtime_cancelled_status.sql — let overtime be withdrawn
--
-- `overtime_requests.status` was created in 0002 as
--   check (status in ('pending','approved','rejected'))
-- while `leave_requests.status`, defined fifteen lines above it and
-- otherwise column-for-column identical, allows 'cancelled' as well.
--
-- The omission looks like an oversight rather than a decision: the two
-- tables model the same workflow — a person asks, a manager decides, and
-- the person may withdraw before either happens — and `leaveService` has
-- always had `cancelLeaveRequest`. Overtime had no service at all until
-- now (audit01 P2-7), so nothing had ever tried to write the value and
-- the gap could not surface.
--
-- Without this, the Withdraw control on /app/overtime fails with a
-- check-constraint violation, which reaches the user as "could not
-- withdraw that request" and reaches Sentry as a 23514 nobody can act on.
--
-- Widening a CHECK is safe: every existing row already satisfies the
-- narrower set, so the constraint validates immediately and no data is
-- rewritten.
-- =====================================================================

alter table public.overtime_requests
  drop constraint if exists overtime_requests_status_check;

alter table public.overtime_requests
  add constraint overtime_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));
