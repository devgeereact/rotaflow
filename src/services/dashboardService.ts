import { supabase } from '@/lib/supabase';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listShiftTypes } from '@/services/shiftTypeService';
import {
  listDepartments,
  listLocations,
  listMinimumCoverRulesForOrg,
} from '@/services/locationService';
import { listActiveStaff } from '@/services/staffService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listOrgShiftSwaps } from '@/services/swapService';
import { listAnnouncements } from '@/services/announcementService';
import { resolvePeriod } from '@/lib/schedulePeriod';
import type { Announcement, Location, Shift, ShiftType, StaffProfile } from '@/types';

export interface ShiftGroup {
  key: string;
  shiftTypeName: string;
  colour: string;
  locationName: string;
  startsAt: string;
  endsAt: string;
  filled: number;
  total: number;
}

/** Groups per-person shift slots into the rows a manager actually reads: one row per (type, location, time). */
export function groupShifts(
  shifts: Shift[],
  shiftTypes: ShiftType[],
  locations: Location[],
): ShiftGroup[] {
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const groups = new Map<string, ShiftGroup>();

  for (const shift of shifts) {
    const key = [
      shift.shift_type_id ?? 'none',
      shift.location_id ?? 'none',
      shift.starts_at,
      shift.ends_at,
    ].join('|');

    const existing = groups.get(key);
    if (existing) {
      existing.total += 1;
      if (shift.staff_profile_id) existing.filled += 1;
      continue;
    }

    const type = shift.shift_type_id ? typeById.get(shift.shift_type_id) : undefined;
    const location = shift.location_id ? locationById.get(shift.location_id) : undefined;

    groups.set(key, {
      key,
      shiftTypeName: type?.name ?? 'Shift',
      colour: type?.colour ?? '#3B6FE0',
      locationName: location?.name ?? 'Unassigned location',
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      filled: shift.staff_profile_id ? 1 : 0,
      total: 1,
    });
  }

  return [...groups.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export interface PendingRequest {
  id: string;
  kind: 'leave' | 'swap';
  staffName: string;
  detail: string;
  dateLabel: string;
  createdAt: string;
}

/**
 * Pending leave requests + shift swaps, merged newest-first. Overtime is
 * deliberately not included. Overtime_requests exists in the schema but has
 * no service built on it yet, and querying the table directly here would
 * bypass RULES.md's "all Supabase access via src/services/*".
 */
export async function getPendingRequests(
  orgId: string,
  staffById: Map<string, StaffProfile>,
): Promise<PendingRequest[]> {
  const [leave, swaps] = await Promise.all([
    listOrgLeaveRequests(orgId),
    listOrgShiftSwaps(orgId),
  ]);

  const staffName = (id: string): string => {
    const s = staffById.get(id);
    return s ? `${s.first_name} ${s.last_name}` : 'Unknown';
  };

  const leaveRows: PendingRequest[] = leave
    .filter((r) => r.status === 'pending')
    .map((r) => ({
      id: r.id,
      kind: 'leave',
      staffName: staffName(r.staff_profile_id),
      detail: `${r.type} leave`,
      dateLabel: `${r.start_date}, ${r.end_date}`,
      createdAt: r.created_at,
    }));

  const swapRows: PendingRequest[] = swaps
    .filter((r) => r.status === 'pending')
    .map((r) => ({
      id: r.id,
      kind: 'swap',
      staffName: staffName(r.requested_by),
      detail: 'Shift swap',
      dateLabel: r.shift ? new Date(r.shift.starts_at).toLocaleDateString('en-GB') : '',
      createdAt: r.created_at,
    }));

  return [...leaveRows, ...swapRows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * Distinct staff with at least one expired compliance document (DBS, RTW,
 * etc.. See the `documents` table). No dedicated service exists for
 * `documents` yet, so this queries it directly. Still inside src/services,
 * per RULES.md.
 */
export async function countStaffWithExpiredDocuments(orgId: string): Promise<number> {
  const { data, error } = await supabase
    .from('documents')
    .select('staff_profile_id')
    .eq('org_id', orgId)
    .lt('expires_at', new Date().toISOString());

  if (error) throw error;
  return new Set((data ?? []).map((d) => d.staff_profile_id)).size;
}

export interface DashboardOverview {
  staff: StaffProfile[];
  locations: Location[];
  shiftTypes: ShiftType[];
  announcements: Announcement[];
  compliancePercent: number;
  monthShiftsByDate: Map<string, { total: number; filled: number }>;
  upcomingGroups: ShiftGroup[];
  /**
   * Today through the end of this week's staffing against each site's
   * minimum (0036_minimum_cover_rules.sql), summed across every site that
   * has one set. `required` is 0 for a date where no site has a rule, not a
   * claim that zero people are needed. Unlike `upcomingGroups`, this window
   * includes today.
   */
  weekCover: { date: string; required: number; onShift: number }[];
  /** Hours rostered today through the end of this week, by department. Staff with no department are omitted, not zeroed. */
  hoursByDepartment: { departmentId: string; departmentName: string; hours: number }[];
}

/** Everything the dashboard needs except the selected day's schedule (fetched separately for its own nav). */
export async function loadDashboardOverview(
  orgId: string,
  timezone: string,
  todayDate: string,
): Promise<DashboardOverview> {
  const month = resolvePeriod('month', todayDate, timezone);
  const week = resolvePeriod('week', todayDate, timezone);
  const today = resolvePeriod('day', todayDate, timezone);
  const upcomingFrom = today.toIso;
  const upcomingTo = week.toIso;

  const [
    staff,
    locations,
    departments,
    shiftTypes,
    announcements,
    expiredDocStaffCount,
    monthShifts,
    upcomingShifts,
    // Starts at today, not tomorrow: `upcomingShifts` deliberately excludes
    // today (the "Today's Schedule" card covers it separately), but
    // weekCover/hoursByDepartment below both need today included, or today
    // always reads as fully unstaffed regardless of the real rota.
    weekShifts,
    minimumCoverRules,
  ] = await Promise.all([
    listActiveStaff(orgId),
    listLocations(orgId),
    listDepartments(orgId),
    listShiftTypes(orgId),
    listAnnouncements(orgId),
    countStaffWithExpiredDocuments(orgId),
    listShiftsForPeriod({ orgId, fromIso: month.fromIso, toIso: month.toIso }),
    listShiftsForPeriod({ orgId, fromIso: upcomingFrom, toIso: upcomingTo }),
    listShiftsForPeriod({ orgId, fromIso: today.fromIso, toIso: week.toIso }),
    listMinimumCoverRulesForOrg(orgId),
  ]);

  const monthShiftsByDate = new Map<string, { total: number; filled: number }>();
  for (const date of month.dates) monthShiftsByDate.set(date, { total: 0, filled: 0 });
  for (const shift of monthShifts) {
    const date = shift.starts_at.slice(0, 10);
    const bucket = monthShiftsByDate.get(date) ?? { total: 0, filled: 0 };
    bucket.total += 1;
    if (shift.staff_profile_id) bucket.filled += 1;
    monthShiftsByDate.set(date, bucket);
  }

  const compliancePercent =
    staff.length === 0
      ? 100
      : Math.round(100 * ((staff.length - expiredDocStaffCount) / staff.length));

  // ---- Week cover vs each site's staffing minimum ----
  const rulesByLocation = new Map<string, Map<number, number>>();
  for (const rule of minimumCoverRules) {
    const byWeekday = rulesByLocation.get(rule.location_id) ?? new Map<number, number>();
    byWeekday.set(rule.weekday, rule.min_staff);
    rulesByLocation.set(rule.location_id, byWeekday);
  }
  // Distinct staff on shift, per site per date. Two shifts for the same
  // person the same day still count once.
  const onShiftByLocationDate = new Map<string, Set<string>>();
  for (const shift of weekShifts) {
    if (!shift.staff_profile_id || !shift.location_id) continue;
    const date = shift.starts_at.slice(0, 10);
    const key = `${shift.location_id}|${date}`;
    const set = onShiftByLocationDate.get(key) ?? new Set<string>();
    set.add(shift.staff_profile_id);
    onShiftByLocationDate.set(key, set);
  }
  const weekDates = week.dates.filter((d) => d >= todayDate);
  const weekCover = weekDates.map((date) => {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    let required = 0;
    let onShift = 0;
    for (const [locationId, byWeekday] of rulesByLocation) {
      const minStaff = byWeekday.get(weekday);
      if (minStaff === undefined) continue;
      required += minStaff;
      onShift += onShiftByLocationDate.get(`${locationId}|${date}`)?.size ?? 0;
    }
    return { date, required, onShift };
  });

  // ---- Hours rostered this week, by department ----
  const staffDeptById = new Map(staff.map((s) => [s.id, s.department_id]));
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));
  const hoursByDeptId = new Map<string, number>();
  for (const shift of weekShifts) {
    if (!shift.staff_profile_id) continue;
    const deptId = staffDeptById.get(shift.staff_profile_id);
    if (!deptId) continue;
    const hours =
      Math.max(
        0,
        new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime(),
      ) /
        3_600_000 -
      shift.break_minutes / 60;
    hoursByDeptId.set(deptId, (hoursByDeptId.get(deptId) ?? 0) + Math.max(0, hours));
  }
  const hoursByDepartment = Array.from(hoursByDeptId, ([departmentId, hours]) => ({
    departmentId,
    departmentName: departmentNameById.get(departmentId) ?? 'Unknown department',
    hours,
  })).sort((a, b) => b.hours - a.hours);

  return {
    staff,
    locations,
    shiftTypes,
    announcements,
    compliancePercent,
    monthShiftsByDate,
    upcomingGroups: groupShifts(upcomingShifts, shiftTypes, locations).slice(0, 3),
    weekCover,
    hoursByDepartment,
  };
}

/**
 * One person's own shifts, today through the end of this week, published
 * only. Same window as `loadDashboardOverview`'s `weekCover`/`upcomingGroups`,
 * for a staff member's "Your next shifts" card, which needs the individual
 * shift instances rather than the org-wide headcount groups `upcomingGroups`
 * carries.
 */
export async function loadMyUpcomingShifts(
  orgId: string,
  staffProfileId: string,
  timezone: string,
  todayDate: string,
): Promise<Shift[]> {
  const week = resolvePeriod('week', todayDate, timezone);
  const fromIso = resolvePeriod('day', todayDate, timezone).toIso;
  return listShiftsForPeriod({ orgId, fromIso, toIso: week.toIso, staffProfileId });
}
