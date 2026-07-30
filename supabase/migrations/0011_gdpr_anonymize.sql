-- =====================================================================
-- 0011_gdpr_anonymize.sql — org-scoped GDPR erasure for a staff member
--
-- Scope, deliberately: this anonymizes a staff member's PII WITHIN ONE
-- ORGANISATION. It does not delete their RotaFlow account (public.profiles /
-- auth.users) — that identity can belong to other organisations, and
-- deleting it needs Supabase's Auth Admin API (service_role, not raw SQL),
-- which is a platform-level operation, not an org owner's to perform. A
-- person who wants their account gone entirely needs a separate,
-- platform-level flow (tracked as [Phase 2] GDPR tooling in SCREENS.md §7),
-- not this function.
--
-- Also out of scope: `documents.file_url` points at externally-hosted files
-- (ImageKit). This only removes the row referencing them — the underlying
-- file is not deleted from storage. A real "erase everything" flow needs a
-- follow-up that calls ImageKit's API too; flagged, not silently ignored.
--
-- Design: anonymize, don't hard-delete, the operational rows (shifts,
-- clock_events, leave_requests, shift_swaps) that reference this person —
-- payroll/rota history stays consistent and auditable, but every column
-- identifying WHO it was is scrubbed on staff_profiles itself, and
-- emergency_contacts/documents (which exist purely to hold PII, with zero
-- operational value once the person is gone) are hard-deleted outright.
--
-- Same SECURITY DEFINER shape as create_invite (0006): runs as the
-- migration owner, which bypasses RLS entirely, so the owner-role check
-- MUST happen explicitly inside the function body — it is not RLS's job
-- here, RLS is bypassed.
-- =====================================================================

create or replace function public.anonymize_staff_member(
  p_org uuid,
  p_staff_profile_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.has_org_role(p_org, array['owner']) then
    raise exception 'Only the organisation owner can erase a staff member''s data'
      using errcode = '42501';
  end if;

  select exists(
    select 1 from public.staff_profiles
    where id = p_staff_profile_id and org_id = p_org
  ) into v_exists;
  if not v_exists then
    raise exception 'Staff member not found in this organisation' using errcode = 'P0002';
  end if;

  -- Pure PII containers — no operational value survives the person being
  -- gone, so these are deleted outright rather than anonymized in place.
  delete from public.emergency_contacts where staff_profile_id = p_staff_profile_id;
  delete from public.documents where staff_profile_id = p_staff_profile_id;

  -- The identity itself. user_id is severed so this row can never be
  -- re-associated with a real login; active=false removes them from future
  -- rota/AI-assistant consideration (same flag deactivateStaffProfile sets).
  update public.staff_profiles
     set first_name = 'Deleted',
         last_name = 'Member',
         phone = null,
         photo_url = null,
         payroll_id = null,
         user_id = null,
         active = false
   where id = p_staff_profile_id;

  -- Every row still referencing p_staff_profile_id (shifts, clock_events,
  -- leave_requests, shift_swaps, timesheets, availability) is left exactly
  -- as-is: the FK now resolves to an anonymized "Deleted Member" record,
  -- which is the point — history stays intact, identity doesn't.

  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_org, auth.uid(), 'gdpr_anonymize', 'staff_profile', p_staff_profile_id, '{}'::jsonb);
end;
$$;

revoke all on function public.anonymize_staff_member(uuid, uuid) from public, anon;
grant execute on function public.anonymize_staff_member(uuid, uuid) to authenticated;
