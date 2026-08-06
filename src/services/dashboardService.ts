import { supabase } from '@/lib/supabase';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { listLocations } from '@/services/locationService';
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
