import { supabase } from '@/lib/supabase';
import { getStaffProfile } from '@/services/staffService';
import { listMyAvailability } from '@/services/availabilityService';
import type {
  Availability,
  ClockEvent,
  EmergencyContact,
  LeaveRequest,
  Shift,
  ShiftSwap,
  StaffDocument,
  StaffProfile,
} from '@/types';

export interface StaffDataExport {
  exportedAt: string;
  staffProfile: StaffProfile | null;
  shifts: Shift[];
  clockEvents: ClockEvent[];
  leaveRequests: LeaveRequest[];
  shiftSwaps: ShiftSwap[];
  availability: Availability[];
  emergencyContacts: EmergencyContact[];
  documents: StaffDocument[];
}

async function listShiftsForStaff(staffProfileId: string): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('staff_profile_id', staffProfileId);
  if (error) throw error;
  return data ?? [];
}

async function listClockEventsForPerson(staffProfileId: string): Promise<ClockEvent[]> {
  const { data, error } = await supabase
    .from('clock_events')
    .select('*')
    .eq('staff_profile_id', staffProfileId);
  if (error) throw error;
  return data ?? [];
}

async function listLeaveRequestsForStaff(
  staffProfileId: string,
): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('staff_profile_id', staffProfileId);
  if (error) throw error;
  return data ?? [];
}

async function listShiftSwapsForStaff(staffProfileId: string): Promise<ShiftSwap[]> {
  const { data, error } = await supabase
    .from('shift_swaps')
    .select('*')
    .or(`requested_by.eq.${staffProfileId},target_staff_profile_id.eq.${staffProfileId}`);
  if (error) throw error;
  return data ?? [];
}

async function listEmergencyContactsForStaff(
  staffProfileId: string,
): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('*')
    .eq('staff_profile_id', staffProfileId);
  if (error) throw error;
  return data ?? [];
}

async function listDocumentsForStaff(staffProfileId: string): Promise<StaffDocument[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('staff_profile_id', staffProfileId);
  if (error) throw error;
  return data ?? [];
}

/**
 * Everything RotaFlow holds about one staff member, for a GDPR
 * subject-access request. Full history, not scoped to any reporting
 * period. This is "what do you have on me", not a report.
 *
 * Scope note: this is the person's org-scoped employment record. It does
 * not include their RotaFlow account/login (profiles/auth.users), which can
 * span multiple organisations, a full-account export is a separate,
 * platform-level request, not something one org owner can produce alone.
 */
export async function exportStaffData(staffProfileId: string): Promise<StaffDataExport> {
  const [
    staffProfile,
    shifts,
    clockEvents,
    leaveRequests,
    shiftSwaps,
    availability,
    emergencyContacts,
    documents,
  ] = await Promise.all([
    getStaffProfile(staffProfileId),
    listShiftsForStaff(staffProfileId),
    listClockEventsForPerson(staffProfileId),
    listLeaveRequestsForStaff(staffProfileId),
    listShiftSwapsForStaff(staffProfileId),
    listMyAvailability(staffProfileId),
    listEmergencyContactsForStaff(staffProfileId),
    listDocumentsForStaff(staffProfileId),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    staffProfile,
    shifts,
    clockEvents,
    leaveRequests,
    shiftSwaps,
    availability,
    emergencyContacts,
    documents,
  };
}

/**
 * Anonymize a staff member's PII within this organisation
 * (0011_gdpr_anonymize.sql). Owner-only, enforced inside the SECURITY
 * DEFINER function itself, not by this client call, and not by whatever
 * gates the button that triggers it.
 */
export async function anonymizeStaffMember(
  orgId: string,
  staffProfileId: string,
): Promise<void> {
  const { error } = await supabase.rpc('anonymize_staff_member', {
    p_org: orgId,
    p_staff_profile_id: staffProfileId,
  });
  if (error) throw error;
}
