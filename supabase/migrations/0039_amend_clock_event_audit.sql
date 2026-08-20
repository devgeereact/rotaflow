-- =====================================================================
-- 0039_amend_clock_event_audit.sql
--
-- Adds 'timesheet.amended' to log_audit_event()'s whitelist (0016), so a
-- manager correcting a clock event from Timesheets leaves a real trail —
-- `clock_events` itself has no history column, so this is the only record
-- of a correction beyond the row's own `updated_at`.
--
-- ClockInPage's own help text already promises this: "your manager or
-- organisation owner can edit any event from Timesheets" (§ Troubleshooting).
-- The edit itself is already possible — RLS's `clock_events_update` (0037)
-- has permitted an owner/manager to update any event in their org since that
-- migration. This closes the one remaining gap: recording that it happened.
--
-- Purely additive: re-declares the same function with one more whitelisted
-- string, nothing removed, no other behaviour changed.
-- =====================================================================

create or replace function public.log_audit_event(
  p_org         uuid,
  p_action      text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_action not in (
      'gdpr.export','gdpr.export_denied',
      'report.exported','timesheet.exported','staff.exported',
      'timesheet.amended') then
    raise exception 'Unknown audit action: %', p_action using errcode = '22023';
  end if;

  if p_org is null then
    raise exception 'An organisation is required for this event'
      using errcode = '22023';
  end if;

  if not public.is_org_member(p_org) then
    raise exception 'Cannot write audit events for another organisation'
      using errcode = '42501';
  end if;

  perform public.audit_write(
    p_org, p_action, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb), 'info', 'org');
end;
$$;

revoke all on function public.log_audit_event(uuid, text, text, uuid, jsonb)
  from public, anon;
grant execute on function public.log_audit_event(uuid, text, text, uuid, jsonb)
  to authenticated;
