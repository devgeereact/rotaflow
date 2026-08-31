/**
 * Leave years that are not the calendar year (CAP-085).
 *
 * `computeStaffLeaveTiles` hardcoded 1 January to 31 December. Plenty of
 * organisations run their holiday year from 1 April — the public sector
 * almost universally — and for them every balance the product showed was
 * wrong for nine months of the year, in a way nobody would think to question
 * because the number looked reasonable.
 *
 * Three rules, and each is a decision somebody has to be able to argue with:
 *
 *   * **when the year starts.** A month and a day, stored on the organisation.
 *   * **pro rata for a joiner.** Somebody who starts in October has not
 *     earned a full year's holiday by December.
 *   * **carry-over, capped.** Unused days that move into the next year, up to
 *     a limit, because uncapped carry-over is how somebody accumulates three
 *     months of untaken leave nobody has budgeted cover for.
 *
 * Pure: dates in and out as `YYYY-MM-DD`, arithmetic in UTC. `src/lib` is
 * unit-tested under Node, and the suite runs in Europe/London while CI builds
 * in UTC — a helper that used local dates would pass in one and fail in the
 * other.
 */

export interface LeaveYear {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, EXCLUSIVE — the first day of the next leave year. */
  to: string;
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The leave year containing a date.
 *
 * A year starting on 1 April means the year containing 2026-02-10 runs from
 * 2025-04-01: the anchor is *before* the start, so it belongs to the year
 * that began the previous calendar year. Getting this backwards is the whole
 * bug, and it only shows up in the months before the start date.
 */
export function leaveYearFor(
  anchorIso: string,
  startMonth: number,
  startDay: number,
): LeaveYear {
  const anchor = utcDate(anchorIso);
  const year = anchor.getUTCFullYear();

  const thisYearStart = Date.UTC(year, startMonth - 1, startDay);
  const startYear = anchor.getTime() >= thisYearStart ? year : year - 1;

  return {
    from: isoOf(new Date(Date.UTC(startYear, startMonth - 1, startDay))),
    to: isoOf(new Date(Date.UTC(startYear + 1, startMonth - 1, startDay))),
  };
}

/** Whole days between two ISO dates, `to` exclusive. */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcDate(toIso).getTime() - utcDate(fromIso).getTime()) / 86_400_000);
}

/**
 * A joiner's entitlement for the year they started.
 *
 * Rounded to the nearest half day, which is how holiday is actually
 * administered — an entitlement of 17.3 days is a number no one can book
 * against. Somebody who started before the year began gets the full
 * allowance, and somebody who has not started yet gets none rather than a
 * negative.
 *
 * This is the common convention, not the only one. An organisation that
 * accrues monthly, or rounds up, will disagree — and when one does, the fix
 * is a policy here rather than a different sum in a component.
 */
export function proRataEntitlement(
  allowanceDays: number,
  startDateIso: string | null,
  year: LeaveYear,
): number {
  if (!startDateIso || startDateIso <= year.from) return allowanceDays;
  if (startDateIso >= year.to) return 0;

  const yearDays = daysBetween(year.from, year.to);
  const employedDays = daysBetween(startDateIso, year.to);
  return Math.round((allowanceDays * employedDays * 2) / yearDays) / 2;
}

/**
 * How much of last year's unused allowance comes forward.
 *
 * Capped, and the cap is the point: uncapped carry-over is how somebody
 * accumulates three months of untaken leave that nobody has budgeted cover
 * for, and how an employer ends up owing it in cash when that person leaves.
 * A cap of zero means "use it or lose it", which is a legitimate policy and
 * the reason this takes a number rather than a boolean.
 */
export function carriedOverDays(previousRemaining: number, capDays: number): number {
  return Math.max(0, Math.min(previousRemaining, capDays));
}

/** `2026-04-01` → `1 April 2026`, for saying which year a balance is for. */
export function formatLeaveYear(year: LeaveYear): string {
  const start = utcDate(year.from);
  const end = new Date(utcDate(year.to).getTime() - 86_400_000);
  const fmt = (d: Date): string =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return `${fmt(start)} to ${fmt(end)}`;
}

/** The months a leave year may start on, for the settings screen. */
export const LEAVE_YEAR_START_MONTHS = [
  { value: 1, label: 'January' },
  { value: 4, label: 'April' },
  { value: 7, label: 'July' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
] as const;

/** How an organisation runs its holiday year (CAP-085). */
export interface LeaveYearPolicy {
  /** 1-12. */
  startMonth: number;
  /** Day of that month. In practice always 1, but stored rather than assumed. */
  startDay: number;
  /**
   * The most days that may be carried into the next year.
   *
   * Zero is "use it or lose it", a legitimate policy — which is why this is a
   * number and not a boolean.
   */
  carryOverMaxDays: number;
}

/** The calendar year, no carry-over. What the product did before it asked. */
export const DEFAULT_LEAVE_YEAR: LeaveYearPolicy = {
  startMonth: 1,
  startDay: 1,
  carryOverMaxDays: 0,
};
