/**
 * The dashboard's "Needs you" feed (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.dashboard`) lists a missed clock-in alongside pending leave and
 * swaps. Nothing computed one before this: `ClockInPage.tsx` shows a
 * person their own stage, but nothing told a manager someone else's shift
 * had started with no clock event against it.
 */

import type { ClockEvent, Shift } from '@/types';

export interface MissedClockIn {
  staffProfileId: string;
  shiftId: string;
  startsAt: string;
  minutesLate: number;
}

/**
 * A shift counts as missed when it started at least `thresholdMinutes` ago,
 * is assigned to someone, and that person has no 'in' clock event anywhere
 * in the same window. Capped at 12 hours late, a shift from yesterday that
 * was simply never worked is a timesheet problem, not something to alert on
 * every time the dashboard loads.
 */
export function findMissedClockIns(
  shifts: Shift[],
  clockEvents: ClockEvent[],
  now: Date,
  thresholdMinutes = 30,
): MissedClockIn[] {
  const clockedInStaff = new Set(
    clockEvents.filter((e) => e.type === 'in').map((e) => e.staff_profile_id),
  );

  const results: MissedClockIn[] = [];
  for (const shift of shifts) {
    if (!shift.staff_profile_id || clockedInStaff.has(shift.staff_profile_id)) continue;
    const minutesLate = (now.getTime() - new Date(shift.starts_at).getTime()) / 60_000;
    if (minutesLate >= thresholdMinutes && minutesLate <= 12 * 60) {
      results.push({
        staffProfileId: shift.staff_profile_id,
        shiftId: shift.id,
        startsAt: shift.starts_at,
        minutesLate: Math.round(minutesLate),
      });
    }
  }
  return results.sort((a, b) => b.minutesLate - a.minutesLate);
}
