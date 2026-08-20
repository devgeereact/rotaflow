/**
 * Pure aggregation for `/app/reports`'s dashboard
 * (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.reports`). No network, no
 * React — the page fetches rows, this turns them into tiles and bar rows.
 *
 * The reference's six tiles include Staff cost and Agency spend. Neither is
 * backable: nothing in the schema stores an hourly rate or an agency-shift
 * flag (`docs/SCHEMA.md`), and a cost figure built from an invented rate
 * would be worse than no figure — it would look like payroll math. Four real
 * tiles ship instead of six invented ones.
 */

import { shiftNetMinutes } from '@/lib/rotaInsights';
import type { LeaveReportRow } from '@/services/reportsService';
import type { Department, MinimumCoverRule, OvertimeRequest, Shift } from '@/types';

export function sumHoursWorked(shifts: Shift[]): number {
  return (
    shifts
      .filter((s) => s.staff_profile_id)
      .reduce((total, s) => total + shiftNetMinutes(s), 0) / 60
  );
}

export function sumOvertimeHours(
  requests: OvertimeRequest[],
  fromIso: string,
  toIso: string,
): number {
  const from = fromIso.slice(0, 10);
  const to = toIso.slice(0, 10);
  return requests
    .filter((r) => r.status === 'approved' && r.date >= from && r.date < to)
    .reduce((total, r) => total + r.hours, 0);
}

export function countAbsenceDays(leave: LeaveReportRow[]): number {
  return leave
    .filter((l) => l.status === 'approved')
    .reduce((total, l) => {
      const days =
        (new Date(l.endDate).getTime() - new Date(l.startDate).getTime()) / 86_400_000 +
        1;
      return total + Math.max(1, Math.round(days));
    }, 0);
}

/**
 * One (location, day) pair counts as a shortfall when fewer distinct staff
 * were on shift there than that weekday's `minimum_cover_rules` row asks
 * for. A location with no rule for a day is never short of a minimum it was
 * never given.
 */
export function countCoverShortfalls(shifts: Shift[], rules: MinimumCoverRule[]): number {
  if (rules.length === 0) return 0;
  const ruleByLocationWeekday = new Map(
    rules.map((r) => [`${r.location_id}|${r.weekday}`, r.min_staff]),
  );

  const byLocationDay = new Map<string, Set<string>>();
  for (const shift of shifts) {
    if (!shift.location_id || !shift.staff_profile_id) continue;
    const date = shift.starts_at.slice(0, 10);
    const key = `${shift.location_id}|${date}`;
    const staffSet = byLocationDay.get(key) ?? new Set<string>();
    staffSet.add(shift.staff_profile_id);
    byLocationDay.set(key, staffSet);
  }

  let shortfalls = 0;
  for (const [key, staffSet] of byLocationDay) {
    const [locationId, date] = key.split('|') as [string, string];
    const weekday = new Date(`${date}T00:00:00`).getDay();
    const min = ruleByLocationWeekday.get(`${locationId}|${weekday}`);
    if (min !== undefined && staffSet.size < min) shortfalls += 1;
  }
  return shortfalls;
}

export interface DepartmentHoursRow {
  id: string;
  label: string;
  hours: number;
}

/** Hours by department, sorted busiest first — the mockup's own row order. */
export function hoursByDepartment(
  shifts: Shift[],
  departments: Department[],
): DepartmentHoursRow[] {
  const totals = new Map<string, number>();
  for (const shift of shifts) {
    if (!shift.department_id || !shift.staff_profile_id) continue;
    totals.set(
      shift.department_id,
      (totals.get(shift.department_id) ?? 0) + shiftNetMinutes(shift) / 60,
    );
  }
  return departments
    .map((d) => ({ id: d.id, label: d.name, hours: totals.get(d.id) ?? 0 }))
    .filter((row) => row.hours > 0)
    .sort((a, b) => b.hours - a.hours);
}

export interface AbsenceReasonRow {
  id: string;
  label: string;
  days: number;
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  annual: 'Annual leave',
  sick: 'Sickness',
  personal: 'Personal',
  carer: "Carer's leave",
  compassionate: 'Compassionate',
  unpaid: 'Unpaid',
};

/** Absence days by leave type, busiest first. */
export function absenceReasons(leave: LeaveReportRow[]): AbsenceReasonRow[] {
  const totals = new Map<string, number>();
  for (const row of leave) {
    if (row.status !== 'approved') continue;
    const days =
      (new Date(row.endDate).getTime() - new Date(row.startDate).getTime()) / 86_400_000 +
      1;
    totals.set(row.type, (totals.get(row.type) ?? 0) + Math.max(1, Math.round(days)));
  }
  return [...totals.entries()]
    .map(([type, days]) => ({
      id: type,
      label: LEAVE_TYPE_LABELS[type] ?? type,
      days,
    }))
    .sort((a, b) => b.days - a.days);
}
