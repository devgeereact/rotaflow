/**
 * View model for the Team directory (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.team`). Pure: takes rows plus a reference date and returns
 * pre-formatted strings, never touches the SDK.
 */

import { addDays, format, startOfWeek } from 'date-fns';
import type { Department, LeaveRequest, Location, Shift, StaffProfile } from '@/types';

export type TeamTodayStatus = 'on_shift' | 'absent' | 'off';

export interface TeamRow {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  jobTitle: string | null;
  department: string;
  location: string;
  /** Every site this person works, for filtering. `location` is the label. */
  locationIds: string[];
  contractHoursLabel: string;
  rosteredHoursLabel: string;
  todayStatus: TeamTodayStatus;
  active: boolean;
}

export interface TeamTiles {
  teamMembers: number;
  onShiftToday: number;
  absentToday: number;
  onLeaveToday: number;
  documentsExpiring: number;
  invitesOutstanding: number;
}

/** Monday-start week instant range containing `anchor`, as ISO strings. */
export function weekRangeIso(anchor: Date): { fromIso: string; toIso: string } {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  return { fromIso: start.toISOString(), toIso: addDays(start, 7).toISOString() };
}

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}

/** Sum of hours across every shift a person has in the given window. */
export function sumRosteredHours(shifts: Shift[], staffProfileId: string): number {
  return shifts
    .filter((s) => s.staff_profile_id === staffProfileId)
    .reduce((sum, s) => sum + hoursBetween(s.starts_at, s.ends_at), 0);
}

/** "37.5h" / "-" when no contracted hours are on file. */
function hoursLabel(hours: number | null): string {
  return hours != null ? `${hours}h` : '-';
}

/** Approved leave of `type` covering `today`, as a set of staff-profile ids. */
export function onTypeOfLeaveToday(
  leave: LeaveRequest[],
  today: string,
  type: (raw: string | null) => boolean,
): Set<string> {
  return new Set(
    leave
      .filter(
        (r) =>
          r.status === 'approved' &&
          r.start_date <= today &&
          r.end_date >= today &&
          type(r.type),
      )
      .map((r) => r.staff_profile_id),
  );
}

export interface TeamRowContext {
  departments: Department[];
  locations: Location[];
  shiftsThisWeek: Shift[];
  onShiftToday: Set<string>;
  absentToday: Set<string>;
  /**
   * Sites each person works, where any have been recorded (CAP-089).
   *
   * Optional, and absence means "nothing recorded" rather than "works
   * nowhere": everyone without an entry falls back to their department's
   * site, which is what this file did for its whole life.
   */
  staffLocations?: Map<string, string[]>;
}

/**
 * The sites a person works.
 *
 * Explicit assignments win outright. Falling back to the department only when
 * there are none is deliberate: once somebody has been given sites, adding
 * their department's on top would grant one nobody assigned, and the whole
 * point of the feature is that the two can differ.
 */
function locationIdsFor(profile: StaffProfile, context: TeamRowContext): string[] {
  const explicit = context.staffLocations?.get(profile.id);
  if (explicit && explicit.length > 0) return explicit;

  const department = context.departments.find((d) => d.id === profile.department_id);
  return department?.location_id ? [department.location_id] : [];
}

function locationNameFor(profile: StaffProfile, context: TeamRowContext): string {
  const ids = locationIdsFor(profile, context);
  const names = ids
    .map((id) => context.locations.find((l) => l.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) return '-';
  if (names.length === 1) return names[0] ?? '-';
  // Two sites are worth naming; five are a column nobody can read. The
  // filter still matches all of them either way.
  return names.length === 2
    ? names.join(' and ')
    : `${names[0]} and ${names.length - 1} more`;
}

export function buildTeamRows(staff: StaffProfile[], context: TeamRowContext): TeamRow[] {
  return staff.map((profile) => {
    const rostered = sumRosteredHours(context.shiftsThisWeek, profile.id);
    const status: TeamTodayStatus = context.absentToday.has(profile.id)
      ? 'absent'
      : context.onShiftToday.has(profile.id)
        ? 'on_shift'
        : 'off';
    return {
      id: profile.id,
      firstName: profile.first_name,
      lastName: profile.last_name,
      photoUrl: profile.photo_url,
      jobTitle: profile.job_title,
      department:
        context.departments.find((d) => d.id === profile.department_id)?.name ?? '-',
      location: locationNameFor(profile, context),
      locationIds: locationIdsFor(profile, context),
      contractHoursLabel: hoursLabel(profile.weekly_hours),
      rosteredHoursLabel: `${rostered.toFixed(1)}h`,
      todayStatus: status,
      active: profile.active,
    };
  });
}

export function buildTeamTiles(
  staff: StaffProfile[],
  onShiftToday: Set<string>,
  absentToday: Set<string>,
  onLeaveToday: Set<string>,
  documentsExpiringCount: number,
  invitesOutstandingCount: number,
): TeamTiles {
  const active = staff.filter((s) => s.active);
  return {
    teamMembers: active.length,
    onShiftToday: active.filter((s) => onShiftToday.has(s.id)).length,
    absentToday: active.filter((s) => absentToday.has(s.id)).length,
    onLeaveToday: active.filter((s) => onLeaveToday.has(s.id)).length,
    documentsExpiring: documentsExpiringCount,
    invitesOutstanding: invitesOutstandingCount,
  };
}

/** "d MMM yyyy" formatter shared by the row/detail views for a start date. */
export function formatJoined(startDate: string | null): string {
  return startDate ? format(new Date(startDate), 'd MMMM yyyy') : 'Start date not set';
}
