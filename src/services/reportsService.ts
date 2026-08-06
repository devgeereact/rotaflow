import { supabase } from '@/lib/supabase';
import { listClockEventsForOrg } from '@/services/clockService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listOrgShiftSwaps } from '@/services/swapService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listStaff } from '@/services/staffService';
import { listLocations, listDepartments } from '@/services/locationService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { pairClockEvents } from '@/lib/hours';

export interface ReportPeriod {
  orgId: string;
  /** Inclusive ISO instant. */
  fromIso: string;
  /** Exclusive ISO instant. */
  toIso: string;
}

function staffName(staff: { first_name: string; last_name: string } | undefined): string {
  return staff ? `${staff.first_name} ${staff.last_name}` : 'Unknown';
}

interface ReviewerProfile {
  id: string;
  full_name: string | null;
  email: string;
}

/** Who reviewed a leave/swap request. Reviewed_by references profiles, not staff_profiles. */
async function reviewerNamesByProfileId(orgId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('memberships')
    .select('profile:profiles(id, full_name, email)')
    .eq('org_id', orgId)
    .returns<{ profile: ReviewerProfile | null }[]>();
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.profile) map.set(row.profile.id, row.profile.full_name ?? row.profile.email);
  }
  return map;
}

export interface TimesheetReportRow {
  staffName: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  hours: string;
}

/**
 * One row per worked segment (clock in → out), reusing the exact
 * `pairClockEvents` math `/app/timesheets` already shows, a report whose
 * numbers disagree with the screen it's reporting on is worse than no report.
 */
export async function getTimesheetReportRows(
  period: ReportPeriod,
): Promise<TimesheetReportRow[]> {
  const [events, staff] = await Promise.all([
    listClockEventsForOrg(period),
    listStaff(period.orgId, { includeInactive: true }),
  ]);
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const grouped = new Map<string, typeof events>();
  for (const event of events) {
    grouped.set(event.staff_profile_id, [
      ...(grouped.get(event.staff_profile_id) ?? []),
      event,
    ]);
  }

  const rows: TimesheetReportRow[] = [];
  for (const [staffId, staffEvents] of grouped) {
    const segments = pairClockEvents(staffEvents);
    for (const segment of segments) {
      rows.push({
        staffName: staffName(staffById.get(staffId)),
        date: segment.clockIn.event_at.slice(0, 10),
        clockIn: segment.clockIn.event_at,
        clockOut: segment.clockOut?.event_at ?? '',
        breakMinutes: Math.round(segment.breakMinutes),
        hours: (segment.minutes / 60).toFixed(2),
      });
    }
  }
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName),
  );
}

export interface LeaveReportRow {
  staffName: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  reviewedBy: string;
  reviewedAt: string;
}

export async function getLeaveReportRows(
  period: ReportPeriod,
): Promise<LeaveReportRow[]> {
  const [requests, staff, reviewers] = await Promise.all([
    listOrgLeaveRequests(period.orgId),
    listStaff(period.orgId, { includeInactive: true }),
    reviewerNamesByProfileId(period.orgId),
  ]);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const fromDate = period.fromIso.slice(0, 10);
  const toDate = period.toIso.slice(0, 10);

  return requests
    .filter((r) => r.start_date < toDate && r.end_date >= fromDate)
    .map((r) => ({
      staffName: staffName(staffById.get(r.staff_profile_id)),
      type: r.type,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status,
      reviewedBy: r.reviewed_by ? (reviewers.get(r.reviewed_by) ?? '') : '',
      reviewedAt: r.reviewed_at ?? '',
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export interface ShiftReportRow {
  staffName: string;
  date: string;
  start: string;
  end: string;
  location: string;
  department: string;
  shiftType: string;
  status: string;
}

export async function getShiftReportRows(
  period: ReportPeriod,
): Promise<ShiftReportRow[]> {
  const [shifts, staff, locations, departments, shiftTypes] = await Promise.all([
    listShiftsForPeriod({
      orgId: period.orgId,
      fromIso: period.fromIso,
      toIso: period.toIso,
      publishedOnly: true,
    }),
    listStaff(period.orgId, { includeInactive: true }),
    listLocations(period.orgId),
    listDepartments(period.orgId),
    listShiftTypes(period.orgId),
  ]);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const locationById = new Map(locations.map((l) => [l.id, l.name]));
  const departmentById = new Map(departments.map((d) => [d.id, d.name]));
  const shiftTypeById = new Map(shiftTypes.map((t) => [t.id, t.name]));

  return shifts
    .map((s) => ({
      staffName: s.staff_profile_id
        ? staffName(staffById.get(s.staff_profile_id))
        : 'Unassigned',
      date: s.starts_at.slice(0, 10),
      start: s.starts_at,
      end: s.ends_at,
      location: s.location_id ? (locationById.get(s.location_id) ?? '') : '',
      department: s.department_id ? (departmentById.get(s.department_id) ?? '') : '',
      shiftType: s.shift_type_id ? (shiftTypeById.get(s.shift_type_id) ?? '') : '',
      status: s.status,
    }))
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName),
    );
}

export interface SwapReportRow {
  requestedBy: string;
  target: string;
  shiftDate: string;
  status: string;
  reviewedBy: string;
  reviewedAt: string;
}

export async function getSwapReportRows(period: ReportPeriod): Promise<SwapReportRow[]> {
  const [swaps, staff, reviewers] = await Promise.all([
    listOrgShiftSwaps(period.orgId),
    listStaff(period.orgId, { includeInactive: true }),
    reviewerNamesByProfileId(period.orgId),
  ]);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const fromDate = period.fromIso.slice(0, 10);
  const toDate = period.toIso.slice(0, 10);

  return swaps
    .filter((s) => {
      const shiftDate = s.shift?.starts_at.slice(0, 10) ?? s.created_at.slice(0, 10);
      return shiftDate >= fromDate && shiftDate < toDate;
    })
    .map((s) => ({
      requestedBy: staffName(staffById.get(s.requested_by)),
      target: s.target_staff_profile_id
        ? staffName(staffById.get(s.target_staff_profile_id))
        : '',
      shiftDate: s.shift?.starts_at.slice(0, 10) ?? '',
      status: s.status,
      reviewedBy: s.reviewed_by ? (reviewers.get(s.reviewed_by) ?? '') : '',
      reviewedAt: s.reviewed_at ?? '',
    }))
    .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));
}
