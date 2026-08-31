import type { LeaveRequest, OvertimeRequest, ShiftSwap, StaffProfile } from '@/types';

/**
 * One queue over the three things a manager decides (CAP-093).
 *
 * Leave, swaps and overtime each had their own screen, and the dashboard tile
 * counted two of the three. So "what is waiting for me" meant opening three
 * pages and remembering the third, and the oldest request — the one somebody
 * has been waiting on longest — was the hardest thing in the product to find.
 *
 * Pure: no Supabase, no DOM, so it is unit-tested. `src/lib` runs under Node,
 * where a Supabase import fails at module load.
 */

/**
 * Only the swap fields this needs.
 *
 * `ShiftSwapWithShift` lives in `swapService`, and `src/lib` does not import
 * from `src/services` — the unit suite runs under Node, where that module's
 * Supabase import fails at load. A structural type takes the row this file
 * actually reads and nothing else.
 */
export type SwapForQueue = Pick<
  ShiftSwap,
  'id' | 'status' | 'requested_by' | 'target_staff_profile_id' | 'created_at'
>;

export type ApprovalKind = 'leave' | 'swap' | 'overtime';

export interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  /** Who is asking. "Somebody who has left" when the staff record is gone. */
  personName: string;
  /** One line: what is being asked for. */
  summary: string;
  /** When it was asked, ISO. Sorting key. */
  requestedAt: string;
  /** Whole days it has been waiting, for the oldest-first ordering and the badge. */
  waitingDays: number;
  /** Where the full context lives, if the manager wants it before deciding. */
  to: string;
}

function nameOf(staff: readonly StaffProfile[], id: string | null): string {
  const person = staff.find((s) => s.id === id);
  // A request outlives the staff record it came from — somebody can leave
  // between asking and being answered. Saying so is better than an empty
  // cell, which reads as a bug.
  return person ? `${person.first_name} ${person.last_name}` : 'A former team member';
}

function daysWaiting(requestedAt: string, now: Date): number {
  const ms = now.getTime() - new Date(requestedAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** `2026-09-04` → `4 Sep`. Deliberately short: these are list rows. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Everything still waiting on a decision, oldest first.
 *
 * Oldest first rather than newest: the queue exists so nothing is forgotten,
 * and a newest-first list buries the request somebody has been chasing for a
 * fortnight under this morning's.
 *
 * `now` is a parameter rather than `new Date()` so the ordering and the day
 * counts are testable. The suite runs in Europe/London and CI builds in UTC,
 * and a function that read the clock itself would pass in one and not the
 * other.
 */
export function buildApprovalQueue(input: {
  leave: readonly LeaveRequest[];
  swaps: readonly SwapForQueue[];
  overtime: readonly OvertimeRequest[];
  staff: readonly StaffProfile[];
  now: Date;
}): ApprovalRow[] {
  const { leave, swaps, overtime, staff, now } = input;
  const rows: ApprovalRow[] = [];

  for (const request of leave) {
    if (request.status !== 'pending') continue;
    const sameDay = request.start_date === request.end_date;
    rows.push({
      id: request.id,
      kind: 'leave',
      personName: nameOf(staff, request.staff_profile_id),
      summary: sameDay
        ? `${request.type} on ${shortDate(request.start_date)}`
        : `${request.type}, ${shortDate(request.start_date)} to ${shortDate(request.end_date)}`,
      requestedAt: request.created_at,
      waitingDays: daysWaiting(request.created_at, now),
      to: '/app/leave',
    });
  }

  for (const swap of swaps) {
    // A swap `pending` WITH a named colleague is waiting on that colleague,
    // not on a manager. Listing it here would put a row in the queue that the
    // person reading it cannot clear, and a queue with rows you cannot clear
    // stops being read. Without a target it is an open offer, which a manager
    // can decide; `accepted` means both people have agreed and it is waiting
    // on the final approval. Those two are the manager's.
    const waitingOnManager =
      swap.status === 'accepted' ||
      (swap.status === 'pending' && swap.target_staff_profile_id === null);
    if (!waitingOnManager) continue;

    rows.push({
      id: swap.id,
      kind: 'swap',
      personName: nameOf(staff, swap.requested_by),
      summary: swap.target_staff_profile_id
        ? `Swap agreed with ${nameOf(staff, swap.target_staff_profile_id)}`
        : 'Shift offered up, nobody has taken it',
      requestedAt: swap.created_at,
      waitingDays: daysWaiting(swap.created_at, now),
      to: '/app/swaps',
    });
  }

  for (const request of overtime) {
    if (request.status !== 'pending') continue;
    rows.push({
      id: request.id,
      kind: 'overtime',
      personName: nameOf(staff, request.staff_profile_id),
      summary: `${request.hours} hours on ${shortDate(request.date)}`,
      requestedAt: request.created_at,
      waitingDays: daysWaiting(request.created_at, now),
      to: '/app/overtime',
    });
  }

  return rows.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/**
 * How long is too long to leave somebody waiting.
 *
 * Three days, and it is a judgement rather than a policy: long enough that a
 * manager off for a weekend is not scolded on Monday, short enough that
 * somebody trying to book a holiday knows before the flights go up.
 */
export const WAITING_TOO_LONG_DAYS = 3;
