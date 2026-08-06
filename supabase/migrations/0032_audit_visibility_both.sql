-- =====================================================================
-- 0032. The audit log accepts the visibility its writers have been passing
--
-- 0016 added `audit_logs.visibility` with `check (visibility in ('org',
-- 'platform_only'))`. Since 0019, callers have been passing a third value:
--
--   0019  support_access.granted, support_access.ended
--   0020  gdpr.request_logged, extended, completed
--   0024  support_case.opened
--   0026  integration.connected, and every status change
--
-- All of them pass `'both'`, and all of them meant it: the tenant's own owner
-- has to be able to see that a support session was opened against their
-- organisation, and platform staff have to see it too. The constraint rejected
-- the value, so every one of those functions raised 23514 and rolled back.
--
-- The practical consequence was that **granting a support access session has
-- never worked in production**. The feature appeared complete, the console
-- offered the button, and the write failed inside the audit call at the end of
-- the function. It surfaced only when 0028 made a session the thing that opens
-- the gate, and the first real grant was attempted.
--
-- ## Why widen the constraint rather than change eight callers
--
-- Because the callers are right. 'both' is a real and distinct audience: an
-- event that the customer and the platform should each be able to read. The
-- 0016 read policy already handles it correctly, admitting an org reader when
-- visibility is not 'platform_only' and a platform reader always. Only the
-- CHECK was narrower than the design.
-- =====================================================================

alter table public.audit_logs drop constraint if exists audit_logs_visibility_check;

alter table public.audit_logs
  add constraint audit_logs_visibility_check
  check (visibility in ('org', 'platform_only', 'both'));

comment on column public.audit_logs.visibility is
  'Who may read this row. org: the tenant and platform staff. platform_only: platform staff alone. both: written when an event genuinely belongs to both audiences, such as a support session opened against a customer.';
