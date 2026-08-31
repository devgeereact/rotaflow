/**
 * Tile arithmetic for `/app/leave` (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.leave`). Pure: takes rows plus a reference date and returns
 * numbers, never a Date across a render, never an SDK call. Same reason
 * `leaveEntitlement.ts` is pure — a service import drags in `@/lib/supabase`,
 * which needs a global `WebSocket` Node doesn't have.
 */

import { addDays, format } from 'date-fns';
import { sumApprovedLeaveDays } from '@/lib/leaveEntitlement';
import { leaveDayCount, leaveTypeKey } from '@/lib/leaveRows';
import type { LeaveRequest, StaffProfile } from '@/types';
import {
  carriedOverDays,
  DEFAULT_LEAVE_YEAR,
  formatLeaveYear,
  leaveYearFor,
  proRataEntitlement,
  type LeaveYearPolicy,
} from '@/lib/leaveYear';

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function addDaysIso(iso: string, days: number): string {
  return format(addDays(parseDay(iso), days), 'yyyy-MM-dd');
}

/** `holiday_allowance` is `numeric(6,2)`; never show more than one decimal. */
export function roundDays(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface AwaitingDecision {
  count: number;
  /** Age of the oldest pending request in whole days; null when the queue is empty. */
  oldestPendingDays: number | null;
}

/** Manager tile 1: the approval queue and how stale its oldest member is. */
export function computeAwaitingDecision(
  requests: LeaveRequest[],
  now: Date,
): AwaitingDecision {
  const pending = requests.filter((r) => r.status === 'pending');
  if (pending.length === 0) return { count: 0, oldestPendingDays: null };
  const oldestCreatedAt = pending.reduce(
    (oldest, r) => (r.created_at < oldest ? r.created_at : oldest),
    pending[0]!.created_at,
  );
  const oldestPendingDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(oldestCreatedAt).getTime()) / 86_400_000),
  );
  return { count: pending.length, oldestPendingDays };
}

/** Manager tile 2: approved requests whose span overlaps the next `windowDays`. */
export function countApprovedOverlapping(
  requests: LeaveRequest[],
  fromIso: string,
  windowDays: number,
): number {
  const toIso = addDaysIso(fromIso, windowDays);
  return requests.filter(
    (r) => r.status === 'approved' && r.start_date < toIso && r.end_date >= fromIso,
  ).length;
}

/**
 * Manager tile 3: approved sick-leave days within the calendar month
 * containing `monthAnchorIso`. Reuses `sumApprovedLeaveDays`'s clip-to-window
 * arithmetic rather than re-deriving it.
 */
export function sumSicknessDaysInMonth(
  requests: LeaveRequest[],
  monthAnchorIso: string,
): number {
  const anchor = parseDay(monthAnchorIso);
  const monthStart = format(
    new Date(anchor.getFullYear(), anchor.getMonth(), 1),
    'yyyy-MM-dd',
  );
  const monthEnd = format(
    new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1),
    'yyyy-MM-dd',
  );
  const sick = requests.filter((r) => leaveTypeKey(r.type) === 'sick');
  return sumApprovedLeaveDays(sick, monthStart, monthEnd);
}

export interface CoverRisk {
  startDate: string;
  endDate: string;
  approvedCount: number;
  pendingCount: number;
}

/**
 * Manager tile 4: the soonest date, within `lookaheadDays` of `fromIso`,
 * where two or more staff have approved-or-pending leave overlapping —
 * cover actually at risk, not just leave on the books. Reports the maximal
 * contiguous run from that day while the overlap holds, and how many of the
 * requests touching that run are settled versus still awaiting a decision.
 * `null` when no such day exists in the window.
 */
export function findCoverRisk(
  requests: LeaveRequest[],
  fromIso: string,
  lookaheadDays: number,
): CoverRisk | null {
  const relevant = requests.filter(
    (r) => r.status === 'approved' || r.status === 'pending',
  );
  if (relevant.length === 0) return null;

  const staffOnLeave = (dateIso: string): Set<string> =>
    new Set(
      relevant
        .filter((r) => r.start_date <= dateIso && r.end_date >= dateIso)
        .map((r) => r.staff_profile_id),
    );

  let riskStart: string | null = null;
  let cursor = fromIso;
  for (let i = 0; i < lookaheadDays; i++) {
    if (staffOnLeave(cursor).size >= 2) {
      riskStart = cursor;
      break;
    }
    cursor = addDaysIso(cursor, 1);
  }
  if (!riskStart) return null;

  let riskEnd = riskStart;
  let next = addDaysIso(riskEnd, 1);
  for (let i = 0; i < lookaheadDays; i++) {
    if (staffOnLeave(next).size < 2) break;
    riskEnd = next;
    next = addDaysIso(next, 1);
  }

  const touching = relevant.filter(
    (r) => r.start_date <= riskEnd && r.end_date >= riskStart,
  );
  return {
    startDate: riskStart,
    endDate: riskEnd,
    approvedCount: touching.filter((r) => r.status === 'approved').length,
    pendingCount: touching.filter((r) => r.status === 'pending').length,
  };
}

/** "Aug 25-29" (same month), "Aug 30-Sep 2" (crossing one) or "Aug 25" (one day). */
export function formatCoverRiskRange(startIso: string, endIso: string): string {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  if (startIso === endIso) return format(start, 'MMM d');
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${format(start, 'MMM d')}-${format(end, 'd')}`;
  }
  return `${format(start, 'MMM d')}-${format(end, 'MMM d')}`;
}

/**
 * Manager tile 5: org-wide annual-leave allowance used, calendar-year window
 * (no configurable leave-year in the schema). `null` when nobody has an
 * allowance recorded — a "0% used" tile would otherwise be indistinguishable
 * from "nobody has an allowance to use".
 */
export function teamEntitlementUsedFraction(
  staff: StaffProfile[],
  requests: LeaveRequest[],
  yearAnchorIso: string,
): number | null {
  const withAllowance = staff.filter((s) => (s.holiday_allowance ?? 0) > 0);
  if (withAllowance.length === 0) return null;

  const year = parseDay(yearAnchorIso).getFullYear();
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;

  let totalAllowance = 0;
  let totalUsed = 0;
  for (const person of withAllowance) {
    const allowance = Number(person.holiday_allowance);
    totalAllowance += allowance;
    totalUsed += sumApprovedLeaveDays(
      requests.filter((r) => r.staff_profile_id === person.id),
      from,
      to,
    );
  }
  return totalAllowance > 0 ? totalUsed / totalAllowance : null;
}

export interface StaffLeaveTiles {
  entitlementDays: number | null;
  takenDays: number;
  remainingDays: number | null;
  pendingDays: number;
  /** Which leave year these figures are for, written out (CAP-085). */
  yearLabel: string;
  /** Days brought forward, already included in `entitlementDays`. */
  carriedOverDays: number;
  /** True when the allowance was reduced because the person joined mid-year. */
  proRata: boolean;
}

/**
 * The staff-side tiles: one person's own entitlement, taken, remaining and
 * pending. `requests` must already be scoped to that person.
 */
export function computeStaffLeaveTiles(
  profile: StaffProfile,
  requests: LeaveRequest[],
  yearAnchorIso: string,
  policy: LeaveYearPolicy = DEFAULT_LEAVE_YEAR,
): StaffLeaveTiles {
  const allowance = profile.holiday_allowance;

  // The leave year, which is not necessarily the calendar year (CAP-085).
  // This used to be hardcoded to 1 January, so for the many organisations
  // running an April year every balance was wrong for nine months of it — in
  // a way nobody questions, because the number still looks reasonable.
  const year = leaveYearFor(yearAnchorIso, policy.startMonth, policy.startDay);
  const previous = leaveYearFor(
    isoDayBefore(year.from),
    policy.startMonth,
    policy.startDay,
  );

  const annual = requests.filter((r) => leaveTypeKey(r.type) === 'annual');
  const takenDays = roundDays(sumApprovedLeaveDays(annual, year.from, year.to));
  const pendingDays = roundDays(
    requests
      .filter((r) => r.status === 'pending')
      .reduce(
        (total, r) =>
          total + leaveDayCount(r.start_date, r.end_date, r.starts_half, r.ends_half),
        0,
      ),
  );

  if (allowance == null) {
    return {
      entitlementDays: null,
      takenDays,
      remainingDays: null,
      pendingDays,
      yearLabel: formatLeaveYear(year),
      carriedOverDays: 0,
      proRata: false,
    };
  }

  const earned = proRataEntitlement(allowance, profile.start_date, year);

  // Last year's leftovers, capped. Computed from the same allowance, which
  // assumes it did not change — the honest simplification, since the schema
  // records one allowance per person rather than one per year.
  const previousTaken = roundDays(
    sumApprovedLeaveDays(annual, previous.from, previous.to),
  );
  const previousEarned = proRataEntitlement(allowance, profile.start_date, previous);
  const carried = carriedOverDays(
    previousEarned - previousTaken,
    policy.carryOverMaxDays,
  );

  const entitlement = roundDays(earned + carried);

  return {
    entitlementDays: entitlement,
    takenDays,
    remainingDays: roundDays(Math.max(0, entitlement - takenDays)),
    pendingDays,
    yearLabel: formatLeaveYear(year),
    carriedOverDays: roundDays(carried),
    proRata: earned < allowance,
  };
}

/** The day before an ISO date, for anchoring into the previous leave year. */
function isoDayBefore(iso: string): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
}
