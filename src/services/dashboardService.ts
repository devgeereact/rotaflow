import { supabase } from '@/lib/supabase';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listShiftTypes } from '@/services/shiftTypeService';
import {
  listLocations,
  listDepartments,
  listMinimumCoverRulesForOrg,
} from '@/services/locationService';
import { listActiveStaff } from '@/services/staffService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listOrgShiftSwaps } from '@/services/swapService';
import { listAnnouncements } from '@/services/announcementService';
import { listRotas } from '@/services/rotaService';
import { shiftNetMinutes } from '@/lib/rotaInsights';
import { resolvePeriod, stepPeriod } from '@/lib/schedulePeriod';
import type {
  Announcement,
  Location,
  MinimumCoverRule,
  Shift,
  ShiftType,
  StaffProfile,
} from '@/types';

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
}

/** Everything the dashboard needs except the selected day's schedule (fetched separately for its own nav). */
export async function loadDashboardOverview(
  orgId: string,
  timezone: string,
  todayDate: string,
): Promise<DashboardOverview> {
  const month = resolvePeriod('month', todayDate, timezone);
  const upcomingFrom = resolvePeriod('day', todayDate, timezone).toIso;
  const upcomingTo = resolvePeriod('week', todayDate, timezone).toIso;

  const [
    staff,
    locations,
    shiftTypes,
    announcements,
    expiredDocStaffCount,
    monthShifts,
    upcomingShifts,
  ] = await Promise.all([
    listActiveStaff(orgId),
    listLocations(orgId),
    listShiftTypes(orgId),
    listAnnouncements(orgId),
    countStaffWithExpiredDocuments(orgId),
    listShiftsForPeriod({ orgId, fromIso: month.fromIso, toIso: month.toIso }),
    listShiftsForPeriod({ orgId, fromIso: upcomingFrom, toIso: upcomingTo }),
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

  return {
    staff,
    locations,
    shiftTypes,
    announcements,
    compliancePercent,
    monthShiftsByDate,
    upcomingGroups: groupShifts(upcomingShifts, shiftTypes, locations).slice(0, 3),
  };
}

export interface WeeklyCoverDay {
  date: string;
  onShift: number;
  required: number;
}

export interface DepartmentHours {
  name: string;
  hours: number;
}

/** A person whose rostered hours this week are flagged, over the statutory 48h weekly limit or over their own contract by a wide margin. */
export interface OverLimitStaff {
  staffName: string;
  hours: number;
  contractHours: number;
  /** true = over the 48-hour statutory limit; false = over their own contract only. */
  overStatutory: boolean;
}

export interface WeeklyRosterSummary {
  totalHours: number;
  coverByDate: WeeklyCoverDay[];
  hoursByDepartment: DepartmentHours[];
  overLimitStaff: OverLimitStaff[];
  /** 'none' = no rota exists yet for this week at any location. */
  rotaStatus: 'draft' | 'published' | 'none';
}

/** Summed staffing minimum across `locations`, for one weekday, from each site's own rule (0036_minimum_cover_rules.sql). A site with no rule for that weekday contributes 0, not a fabricated default: silence means no policy, not a minimum of zero. */
function requiredForWeekday(
  weekday: number,
  locations: Location[],
  minimumCoverRules: MinimumCoverRule[],
): number {
  const locationIds = new Set(locations.map((l) => l.id));
  let required = 0;
  for (const rule of minimumCoverRules) {
    if (rule.weekday !== weekday) continue;
    if (!locationIds.has(rule.location_id)) continue;
    required += rule.min_staff;
  }
  return required;
}

/**
 * The manager's working week for the Dashboard's cover chart, rota status and
 * hours-by-department cards (`docs/ORGANISATION_WORKSPACE.html`'s "Cover
 * against minimum" / "Rota status" / "Hours by department").
 *
 * Deliberately draft-inclusive (`publishedOnly: false`): a manager builds the
 * rota to hit this cover target *before* publishing, so a chart that only
 * counted published shifts would show every day short until the moment they
 * hit Publish, which is not a useful chart. Contrast `loadMyWeekSummary`
 * below, which is staff-facing and stays published-only.
 *
 * The staffing minimum itself is per site per weekday
 * (0036_minimum_cover_rules.sql), summed across every site in scope for the
 * day in question, the same computation `computeDailyTotals` and
 * `computeRotaInsights` use in the rota builder, so the dashboard, the
 * Coverage tab and the publish gate can never disagree about what "short"
 * means.
 */
export async function loadWeeklyRosterSummary(
  orgId: string,
  weekDates: string[],
  fromIso: string,
  toIso: string,
  staff: StaffProfile[],
): Promise<WeeklyRosterSummary> {
  const [shifts, departments, rotas, locations, minimumCoverRules] = await Promise.all([
    listShiftsForPeriod({ orgId, fromIso, toIso, publishedOnly: false }),
    listDepartments(orgId),
    listRotas(orgId),
    listLocations(orgId),
    listMinimumCoverRulesForOrg(orgId),
  ]);

  const departmentById = new Map(departments.map((d) => [d.id, d.name]));
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const onShiftByDate = new Map<string, Set<string>>(
    weekDates.map((d) => [d, new Set()]),
  );
  const hoursByDepartment = new Map<string, number>();
  const hoursByStaff = new Map<string, number>();
  let totalHours = 0;

  for (const shift of shifts) {
    if (!shift.staff_profile_id) continue;
    const date = shift.starts_at.slice(0, 10);
    onShiftByDate.get(date)?.add(shift.staff_profile_id);

    const hours = shiftNetMinutes(shift) / 60;
    totalHours += hours;
    hoursByStaff.set(
      shift.staff_profile_id,
      (hoursByStaff.get(shift.staff_profile_id) ?? 0) + hours,
    );
    const deptName = shift.department_id
      ? (departmentById.get(shift.department_id) ?? 'Unassigned')
      : 'Unassigned';
    hoursByDepartment.set(deptName, (hoursByDepartment.get(deptName) ?? 0) + hours);
  }

  const overLimitStaff: OverLimitStaff[] = [];
  for (const [staffId, hours] of hoursByStaff) {
    const person = staffById.get(staffId);
    if (!person) continue;
    const contractHours = person.weekly_hours ?? 0;
    const overStatutory = hours > 48;
    if (overStatutory || hours > contractHours + 12) {
      overLimitStaff.push({
        staffName: `${person.first_name} ${person.last_name}`,
        hours,
        contractHours,
        overStatutory,
      });
    }
  }
  overLimitStaff.sort((a, b) => b.hours - a.hours);

  const weekStart = weekDates[0] ?? fromIso.slice(0, 10);
  const weekEnd = weekDates[weekDates.length - 1] ?? weekStart;
  const overlapping = rotas.filter(
    (r) => r.period_start <= weekEnd && r.period_end >= weekStart,
  );
  const rotaStatus: WeeklyRosterSummary['rotaStatus'] =
    overlapping.length === 0
      ? 'none'
      : overlapping.every((r) => r.status === 'published')
        ? 'published'
        : 'draft';

  return {
    totalHours,
    coverByDate: weekDates.map((date) => ({
      date,
      onShift: onShiftByDate.get(date)?.size ?? 0,
      required: requiredForWeekday(
        new Date(`${date}T00:00:00`).getDay(),
        locations,
        minimumCoverRules,
      ),
    })),
    hoursByDepartment: [...hoursByDepartment.entries()]
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours),
    overLimitStaff,
    rotaStatus,
  };
}

export interface MyWeekSummary {
  hours: number;
  shiftsBooked: number;
}

/** A staff member's own published week: hours and shift count for the "Your hours this week" / "Shifts booked" tiles. Published-only, unlike the manager's summary above; a shift not yet published is not theirs to see. */
export async function loadMyWeekSummary(
  orgId: string,
  staffProfileId: string,
  fromIso: string,
  toIso: string,
): Promise<MyWeekSummary> {
  const shifts = await listShiftsForPeriod({ orgId, fromIso, toIso, staffProfileId });
  return {
    hours: shifts.reduce((sum, s) => sum + shiftNetMinutes(s) / 60, 0),
    shiftsBooked: shifts.length,
  };
}

/**
 * A staff member's own published upcoming shifts, for the "Your next shifts"
 * card. `groupShifts` de-dupes multi-person shifts into one row; over a
 * single person's own shifts it degenerates to one row per shift, which is
 * exactly what a personal shift list is.
 */
export async function loadMyUpcomingShifts(
  orgId: string,
  staffProfileId: string,
  fromIso: string,
  toIso: string,
  shiftTypes: ShiftType[],
  locations: Location[],
): Promise<ShiftGroup[]> {
  const shifts = await listShiftsForPeriod({ orgId, fromIso, toIso, staffProfileId });
  return groupShifts(shifts, shiftTypes, locations);
}

/**
 * Total rostered hours for each of the last `weeks` weeks, oldest first, for
 * the "Rostered this week" sparkline (`docs/ORGANISATION_WORKSPACE.html`'s
 * `spark` array). Draft-inclusive like `loadWeeklyRosterSummary`, so this
 * week's still-unpublished shifts count the same way past published ones do.
 *
 * One query across the whole span rather than `weeks` separate ones: the
 * range is contiguous, and a week-per-request fan-out would be `weeks` round
 * trips for data one query already returns.
 */
export async function loadRosteredHoursTrend(
  orgId: string,
  currentWeekAnchor: string,
  timezone: string,
  weeks = 7,
): Promise<number[]> {
  const anchors: string[] = [];
  let anchor = currentWeekAnchor;
  for (let i = 0; i < weeks; i++) {
    anchors.unshift(anchor);
    anchor = stepPeriod('week', anchor, -1);
  }
  const windows = anchors.map((a) => resolvePeriod('week', a, timezone));
  const fromIso = windows[0]!.fromIso;
  const toIso = windows[windows.length - 1]!.toIso;

  const shifts = await listShiftsForPeriod({
    orgId,
    fromIso,
    toIso,
    publishedOnly: false,
  });
  const totals = new Array(weeks).fill(0) as number[];

  for (const shift of shifts) {
    if (!shift.staff_profile_id) continue;
    const date = shift.starts_at.slice(0, 10);
    const weekIndex = windows.findIndex(
      (w) => date >= w.dates[0]! && date <= w.dates[w.dates.length - 1]!,
    );
    if (weekIndex >= 0) {
      totals[weekIndex] = (totals[weekIndex] ?? 0) + shiftNetMinutes(shift) / 60;
    }
  }

  return totals;
}
