/**
 * Data subject requests — the statutory clock.
 *
 * ## Why this is not `+ 30 * 86_400_000`
 *
 * Article 12(3) says *one month*, not thirty days, and the difference is not
 * academic: a request received on 31 January is due 28 February, and adding
 * thirty days would give 2 March — two days of breach that nobody notices
 * until someone complains. Everything here does calendar arithmetic on date
 * components.
 *
 * Nothing in this file touches the local clock either. Dates arrive as
 * `YYYY-MM-DD` strings from a `date` column and stay that way, so a machine in
 * UTC and a machine in Europe/London agree about which day it is — this
 * repository's suite deliberately runs in both.
 */

export type GdprRequestKind =
  'access' | 'portability' | 'rectification' | 'erasure' | 'restriction' | 'objection';

export type GdprRequestStatus =
  'received' | 'in_progress' | 'awaiting_information' | 'completed' | 'refused';

export interface GdprRequest {
  id: string;
  orgId: string | null;
  orgName: string | null;
  subjectEmail: string;
  subjectName: string | null;
  kind: GdprRequestKind;
  status: GdprRequestStatus;
  receivedOn: string;
  dueOn: string;
  extendedTo: string | null;
  extensionReason: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  closedAt: string | null;
  outcomeNote: string | null;
}

/** The Article 15–22 rights, in the order the regulation lists them. */
export const GDPR_KIND_LABELS: Record<GdprRequestKind, string> = {
  access: 'Access (Art. 15)',
  portability: 'Portability (Art. 20)',
  rectification: 'Rectification (Art. 16)',
  erasure: 'Erasure (Art. 17)',
  restriction: 'Restriction (Art. 18)',
  objection: 'Objection (Art. 21)',
};

export const GDPR_STATUS_LABELS: Record<GdprRequestStatus, string> = {
  received: 'Received',
  in_progress: 'In progress',
  awaiting_information: 'Awaiting information',
  completed: 'Completed',
  refused: 'Refused',
};

export const CLOSED_STATUSES: readonly GdprRequestStatus[] = ['completed', 'refused'];

export function isClosed(status: GdprRequestStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/**
 * Add whole calendar months to a `YYYY-MM-DD` date, clamping to the end of the
 * target month.
 *
 * 31 January + 1 month is 28 February (29 in a leap year), because there is no
 * 31 February and the deadline cannot fall in March. `Date` would roll over to
 * 2 or 3 March on its own, which is the bug this exists to prevent.
 */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;

  const targetMonthIndex = m - 1 + months;
  const year = y + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;

  // Day 0 of the following month is the last day of this one.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTarget);

  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The statutory deadline for a request received on this date. */
export function statutoryDueDate(receivedOn: string): string {
  return addMonths(receivedOn, 1);
}

/** Where the extension would land. Two further months from the original due date. */
export function extendedDueDate(dueOn: string): string {
  return addMonths(dueOn, 2);
}

/** The deadline that actually applies — the extension when one was granted. */
export function effectiveDueDate(
  request: Pick<GdprRequest, 'dueOn' | 'extendedTo'>,
): string {
  return request.extendedTo ?? request.dueOn;
}

/**
 * Whole days from `today` until `due`, negative once overdue.
 *
 * Both are date-only strings, compared as UTC midnights, so the answer does
 * not shift with the viewer's timezone.
 */
export function daysUntil(due: string, today: string): number {
  const toUtc = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    // A malformed date must not silently become NaN and propagate into a
    // deadline calculation — the whole point of this module is that the number
    // is right. Treat it as epoch so the difference is obviously wrong rather
    // than quietly absent.
    //
    // `isFinite`, not `!== undefined`: the original check only caught a value
    // with too few parts. A full ISO timestamp has three, and its third is
    // `"02T00:00:00.000Z"`, which `Number` turns into NaN — so the guard passed
    // and `Date.UTC` returned NaN, which reached the screen as "NaN days left".
    // Anything that is not a finite number is not a date.
    if (y === undefined || m === undefined || d === undefined) return 0;
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(due) - toUtc(today)) / 86_400_000);
}

export type DeadlineState = 'closed' | 'overdue' | 'due_soon' | 'on_track';

/**
 * How much trouble a request is in.
 *
 * "Due soon" is seven days. A data subject request usually needs someone to
 * gather records from a customer, so a week is the point at which chasing has
 * to start rather than the point at which it is already too late.
 */
export function deadlineState(
  request: Pick<GdprRequest, 'dueOn' | 'extendedTo' | 'status'>,
  today: string,
): DeadlineState {
  if (isClosed(request.status)) return 'closed';
  const remaining = daysUntil(effectiveDueDate(request), today);
  if (remaining < 0) return 'overdue';
  if (remaining <= 7) return 'due_soon';
  return 'on_track';
}

/** Plain-English deadline, e.g. "3 days left" or "overdue by 2 days". */
export function formatDeadline(
  request: Pick<GdprRequest, 'dueOn' | 'extendedTo' | 'status'>,
  today: string,
): string {
  if (isClosed(request.status)) return 'Closed';
  const remaining = daysUntil(effectiveDueDate(request), today);
  if (remaining < 0) {
    const over = Math.abs(remaining);
    return `Overdue by ${over} day${over === 1 ? '' : 's'}`;
  }
  if (remaining === 0) return 'Due today';
  return `${remaining} day${remaining === 1 ? '' : 's'} left`;
}

/** Today as `YYYY-MM-DD`, in the viewer's own timezone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * How many requests were closed in the {@link window} days ending today.
 *
 * `closedAt` is a timestamp and `today` is a date, so the comparison is made on
 * the date part alone. A request closed earlier today is inside a zero-day
 * window, which is what a reader expects "closed in the last 90 days" to mean.
 */
export function closedWithin(
  requests: readonly Pick<GdprRequest, 'closedAt'>[],
  today: string,
  window = 90,
): number {
  return requests.filter((r) => {
    if (!r.closedAt) return false;
    const age = daysUntil(r.closedAt.slice(0, 10), today);
    // `daysUntil` counts forward, so a past date is negative.
    return age <= 0 && -age <= window;
  }).length;
}

/**
 * Median days from receipt to closure, across the closed requests only.
 *
 * The median rather than the mean: one request that sat for three months
 * would drag a mean far past what the queue actually feels like, and this
 * figure is read as "how long does a request take here".
 *
 * Returns `null` when nothing has been closed — a turnaround of zero would
 * read as instant rather than as unknown.
 */
export function medianTurnaroundDays(
  requests: readonly Pick<GdprRequest, 'receivedOn' | 'closedAt'>[],
): number | null {
  const spans = requests
    .filter((r): r is { receivedOn: string; closedAt: string } => Boolean(r.closedAt))
    .map((r) => -daysUntil(r.receivedOn, r.closedAt.slice(0, 10)))
    .filter((days) => Number.isFinite(days) && days >= 0)
    .sort((a, b) => a - b);
  if (spans.length === 0) return null;
  const mid = Math.floor(spans.length / 2);
  const median =
    spans.length % 2 === 1 ? spans[mid]! : (spans[mid - 1]! + spans[mid]!) / 2;
  return Math.round(median * 10) / 10;
}

/** Open erasure requests — the ones that end in data actually being destroyed. */
export function pendingErasures(
  requests: readonly Pick<GdprRequest, 'kind' | 'status'>[],
): number {
  return requests.filter((r) => r.kind === 'erasure' && !isClosed(r.status)).length;
}
