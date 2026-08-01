/**
 * View model for the Leave screen (design/Leave.png).
 *
 * The table and the rail are presentational — they render pre-formatted
 * strings and never touch a Date, a timezone or a Supabase row. The live page
 * maps `leave_requests` into these shapes and the design preview supplies them
 * literally, so both feed the identical component tree.
 */

import { format, isSameMonth, isSameYear, parseISO } from 'date-fns';
import type { LeaveRequest } from '@/types';

/**
 * `leave_requests.type` is free text with a `'holiday'` default and no CHECK
 * (0002_rotaflow.sql:243), so this is a mapping, not an enum. Anything
 * unrecognised lands in `other` rather than being dropped.
 */
export type LeaveTypeKey = 'annual' | 'sick' | 'personal' | 'carer' | 'other';

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRow {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  photoUrl: string | null;
  type: LeaveTypeKey;
  /** Pre-formatted, e.g. "30 May – 1 June 2025". */
  dateLabel: string;
  /** Weekday span under the dates, e.g. "Fri – Sun". */
  dayLabel: string;
  /** Pre-formatted, e.g. "3 days". */
  durationLabel: string;
  status: LeaveStatus;
  /**
   * The muted line under the pill — "Needs approval", "Approved by you", a
   * decline reason. `null` where nothing is recorded; never invented.
   */
  statusNote: string | null;
  /** Pre-formatted, e.g. "Today, 09:15". */
  requestedLabel: string;
  /** Who raised it — the muted line under the timestamp. */
  requestedBy: string;
}

/** One slice of the Leave Overview donut, and its legend row. */
export interface LeaveTypeCount {
  type: LeaveTypeKey;
  label: string;
  days: number;
}

export interface LeaveBalance {
  type: LeaveTypeKey;
  label: string;
  balanceDays: number;
  allowanceDays: number;
  /**
   * Meter fill, 0–1, supplied rather than derived: an allowance of 0 (statutory
   * sick leave has no entitlement pot) makes `balance / allowance` undefined,
   * and the caller is the only place that knows what the bar should mean.
   */
  fraction: number;
}

/** A row in the rail's approval queue — leave, swaps, overtime. */
export interface LeaveApprovalCount {
  id: string;
  label: string;
  note: string;
  count: number;
}

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
 * system zone, which silently shows the previous day west of Greenwich — the
 * bug class `.github/workflows/ci.yml` pins `TZ: UTC` over.
 */
function parseDay(iso: string): Date {
  return parseISO(iso);
}

/**
 * Inclusive calendar days, matching `sumApprovedLeaveDays` in
 * `services/leaveService.ts`. Not working days — the schema carries no working
 * pattern to exclude someone's off-days against, and a precise-looking wrong
 * number is worse than a coarse right one.
 */
export function leaveDayCount(startIso: string, endIso: string): number {
  const start = parseDay(startIso).getTime();
  const end = parseDay(endIso).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/** "3 days" / "1 day" — the reference's Duration column. */
export function formatLeaveDuration(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * "28 May 2025" for one day, "9 – 13 June 2025" within a month, and
 * "30 May – 1 June 2025" across one, exactly as the reference writes them.
 */
export function formatLeaveRange(startIso: string, endIso: string): string {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  if (startIso === endIso) return format(start, 'd MMMM yyyy');
  if (isSameMonth(start, end) && isSameYear(start, end)) {
    return `${format(start, 'd')} – ${format(end, 'd MMMM yyyy')}`;
  }
  if (isSameYear(start, end)) {
    return `${format(start, 'd MMMM')} – ${format(end, 'd MMMM yyyy')}`;
  }
  return `${format(start, 'd MMMM yyyy')} – ${format(end, 'd MMMM yyyy')}`;
}

/** "Fri – Sun" / "Wed" — the muted weekday span under the dates. */
export function formatLeaveDays(startIso: string, endIso: string): string {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  if (startIso === endIso) return format(start, 'EEE');
  return `${format(start, 'EEE')} – ${format(end, 'EEE')}`;
}

/**
 * "Today, 09:15" / "Yesterday, 16:30" / "21 May 2025" — the Requested column.
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

/**
 * Approved days per leave type across the given requests — the Leave Overview
 * donut. Counts the same inclusive calendar days the balances use.
 */
export function countLeaveDaysByType(
  requests: LeaveRequest[],
  labels: Record<LeaveTypeKey, string>,
): LeaveTypeCount[] {
  const totals = new Map<LeaveTypeKey, number>();
  for (const request of requests) {
    if (request.status !== 'approved') continue;
    const key = leaveTypeKey(request.type);
    const days = leaveDayCount(request.start_date, request.end_date);
    totals.set(key, (totals.get(key) ?? 0) + days);
  }
  return [...totals.entries()]
    .map(([type, days]) => ({ type, label: labels[type], days }))
    .sort((a, b) => b.days - a.days);
}
