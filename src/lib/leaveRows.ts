/**
 * Formatting helpers for `/app/leave` (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.leave`). Pure: pre-formatted strings from ISO dates, never a
 * timezone-sensitive Date across a render and never a Supabase row.
 */

import { format, isSameMonth, isSameYear, parseISO } from 'date-fns';

/**
 * `leave_requests.type` is free text with a `'holiday'` default and no CHECK
 * (0002_rotaflow.sql:243), so this is a mapping, not an enum. Anything
 * unrecognised lands in `other` rather than being dropped.
 */
export type LeaveTypeKey = 'annual' | 'sick' | 'personal' | 'carer' | 'other';

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

const TYPE_ALIASES: Record<string, LeaveTypeKey> = {
  holiday: 'annual',
  annual: 'annual',
  annual_leave: 'annual',
  sick: 'sick',
  sick_leave: 'sick',
  personal: 'personal',
  personal_leave: 'personal',
  carer: 'carer',
  carers: 'carer',
  carers_leave: 'carer',
  compassionate: 'carer',
};

/** Map a stored `type` string onto the fixed product-level palette. */
export function leaveTypeKey(raw: string | null): LeaveTypeKey {
  if (!raw) return 'other';
  return (
    TYPE_ALIASES[
      raw
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    ] ?? 'other'
  );
}

/**
 * Date-only columns are parsed with `parseISO`, which reads "2025-05-30" as
 * local midnight. `new Date(string)` reads it as UTC and then formats in the
 * system zone, which silently shows the previous day west of Greenwich. The
 * bug class `.github/workflows/ci.yml` pins `TZ: UTC` over.
 */
function parseDay(iso: string): Date {
  return parseISO(iso);
}

/**
 * Inclusive calendar days, matching `sumApprovedLeaveDays` in
 * `services/leaveService.ts`. Not working days. The schema carries no working
 * pattern to exclude someone's off-days against, and a precise-looking wrong
 * number is worse than a coarse right one.
 */
export function leaveDayCount(startIso: string, endIso: string): number {
  const start = parseDay(startIso).getTime();
  const end = parseDay(endIso).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/** "3 days" / "1 day". The reference's Duration column. */
export function formatLeaveDuration(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * "28 May 2025" for one day, "9-13 June 2025" within a month, and
 * "30 May-1 June 2025" across one, exactly as the reference writes them.
 */
export function formatLeaveRange(startIso: string, endIso: string): string {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  if (startIso === endIso) return format(start, 'd MMMM yyyy');
  if (isSameMonth(start, end) && isSameYear(start, end)) {
    return `${format(start, 'd')}-${format(end, 'd MMMM yyyy')}`;
  }
  if (isSameYear(start, end)) {
    return `${format(start, 'd MMMM')}-${format(end, 'd MMMM yyyy')}`;
  }
  return `${format(start, 'd MMMM yyyy')}-${format(end, 'd MMMM yyyy')}`;
}

/** "Fri. Sun" / "Wed", the muted weekday span under the dates. */
export function formatLeaveDays(startIso: string, endIso: string): string {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  if (startIso === endIso) return format(start, 'EEE');
  return `${format(start, 'EEE')}-${format(end, 'EEE')}`;
}

/**
 * "Today, 09:15" / "Yesterday, 16:30" / "21 May 2025". The Requested column.
 * `now` is injected so the caller controls the clock (and a test can too).
 */
export function formatRequestedAt(iso: string, now: Date): string {
  const at = new Date(iso);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsedDays = Math.floor((dayStart.getTime() - at.getTime()) / 86_400_000);
  if (at >= dayStart) return `Today, ${format(at, 'HH:mm')}`;
  if (elapsedDays < 1) return `Yesterday, ${format(at, 'HH:mm')}`;
  return format(at, 'd MMMM yyyy');
}
