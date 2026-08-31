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
  /** Their own overtime claims. Missing from this export until 2026-08-31. */
  overtimeRequests: unknown[];
  /** Their approved hours — for most workers, the record they would ask for first. */
  timesheets: unknown[];
  /** Their pay-rate history. */
  payRates: unknown[];
  /** Which sites they work. */
  sites: unknown[];
  /** Which announcements they have read, and when. */
  announcementReads: unknown[];
  /** What this export deliberately leaves out, and why. */
  notes: string[];
}

/**
 * What `exportStaffData` covers, named rather than inferred.
 *
 * The org export learned this the hard way: a set you can read in one place
 * is reviewable, and a set spread across call sites is not. `availability` is
 * fetched through another service's helper, so a gate that inferred coverage
 * from `.from('…')` in this file would have called it missing.
 */
export const SUBJECT_EXPORT_TABLES = [
  'staff_profiles',
  'shifts',
  'clock_events',
  'leave_requests',
  'shift_swaps',
  'availability',
  'emergency_contacts',
  'documents',
  'overtime_requests',
  'timesheets',
  'staff_pay_rates',
  'staff_locations',
  'announcement_reads',
] as const;

/**
 * Tables keyed on a person that this export deliberately skips.
 *
 * Read by `scripts/check-export-coverage.mjs`, which fails when a table with
 * a `staff_profile_id` is in neither the export nor this list.
 */
export const SUBJECT_EXPORT_EXCLUDED: readonly { table: string; reason: string }[] = [
  {
    table: 'calendar_feed_tokens',
    reason:
      'The row IS a credential — the URL that lets a calendar read your shifts. Putting a live one into a file that gets emailed to you would create the disclosure this export exists to answer for. You can see and rotate yours from your own account screen.',
  },
];

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
 * The four tables this export forgot, and the read-receipt table.
 *
 * One helper rather than five, because they differ only by name: the risk in
 * a subject-access export is a table missing from it, and five near-identical
 * functions is how the sixth gets written slightly differently and skipped.
 */
async function listRowsForStaff(
  table:
    | 'overtime_requests'
    | 'timesheets'
    | 'staff_pay_rates'
    | 'staff_locations'
    | 'announcement_reads',
  staffProfileId: string,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from(table)
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
 *
 * ## It was missing the three records a worker would ask for first
 *
 * Until 2026-08-31 this covered eight datasets and left out **timesheets**,
 * **overtime claims** and, once the table existed, **pay rates** — which is
 * to say: somebody in a dispute about their hours or their money received an
 * export of their shifts and their holidays. `docs/DATA_LIFECYCLE.md`
 * described it as "eight datasets" as though eight were the whole.
 *
 * `npm run check:export` now fails when a table keyed on `staff_profile_id`
 * is in neither this function nor `SUBJECT_EXPORT_EXCLUDED`.
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
    overtimeRequests,
    timesheets,
    payRates,
    sites,
    announcementReads,
  ] = await Promise.all([
    getStaffProfile(staffProfileId),
    listShiftsForStaff(staffProfileId),
    listClockEventsForPerson(staffProfileId),
    listLeaveRequestsForStaff(staffProfileId),
    listShiftSwapsForStaff(staffProfileId),
    listMyAvailability(staffProfileId),
    listEmergencyContactsForStaff(staffProfileId),
    listDocumentsForStaff(staffProfileId),
    listRowsForStaff('overtime_requests', staffProfileId),
    listRowsForStaff('timesheets', staffProfileId),
    listRowsForStaff('staff_pay_rates', staffProfileId),
    listRowsForStaff('staff_locations', staffProfileId),
    listRowsForStaff('announcement_reads', staffProfileId),
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
    overtimeRequests,
    timesheets,
    payRates,
    sites,
    announcementReads,
    notes: [
      "Your RotaFlow login is not included. It can belong to more than one organisation, so it is not this one's to export.",
      'Files themselves are not included — `documents` records the URL of each one.',
      ...SUBJECT_EXPORT_EXCLUDED.map((x) => `Not included — ${x.table}: ${x.reason}`),
    ],
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
