import type { ShiftSwap } from '@/types';

/**
 * The four states design/Swap-Request.png actually shows. The table is one row
 * per request, so the DB's five-value `shift_swaps.status` is folded down:
 * `accepted` (the colleague said yes, the manager has not) is still "Pending
 * Approval" from a reviewer's point of view, and `rejected` is shown as
 * "Declined" because that is the word every screen in the reference uses.
 */
export type SwapDisplayStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

/** Every tab in the reference, including the unfiltered one. */
export type SwapTab = 'all' | SwapDisplayStatus;

export interface SwapParty {
  firstName: string;
  lastName: string;
  /** "Care Assistant" — the line under the name. */
  jobTitle: string | null;
  photoUrl: string | null;
}

/** One side of a swap: the shift being given away, or the one being taken. */
export interface SwapShiftSide {
  /** Pre-formatted, e.g. "Tue 27 May 2025". */
  dateLabel: string;
  /** Pre-formatted, e.g. "07:00 – 15:00". */
  timeLabel: string;
  locationName: string | null;
}

export interface SwapRow {
  id: string;
  /** The person giving their shift away. */
  from: SwapParty;
  /** The colleague taking it — null when the request is open to anyone. */
  to: SwapParty | null;
  /**
   * The shift changing hands. Both halves of the Shifts column render from
   * this one row: `shift_swaps` is a hand-over (A gives, B takes), not a
   * two-shift exchange, and design/Swap-Request.png shows the same date, time
   * and location on both sides of every row.
   */
  shift: SwapShiftSide | null;
  /** Pre-formatted, e.g. "Today, 09:15". */
  requestedLabel: string;
  requestedByName: string;
  status: SwapDisplayStatus;
  /** Second line under the pill, e.g. "Needs your approval". Omitted when unknown. */
  statusNote: string | null;
  /** Drives the row button: "Review" when a decision is still owed, else "View". */
  needsReview: boolean;
}

export interface SwapStatusCount {
  status: SwapDisplayStatus;
  label: string;
  count: number;
}

/** Maps the stored status onto the four the screen shows. */
export function toDisplayStatus(status: ShiftSwap['status']): SwapDisplayStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'declined';
    case 'cancelled':
      return 'cancelled';
    default:
      // 'pending' and 'accepted' both still await a manager.
      return 'pending';
  }
}

/**
 * Token classes per status, written out in full so Tailwind's content scan can
 * see each one (a concatenated class name is purged). Every use is paired with
 * the status spelled out in words (docs/DESIGN.md §5).
 */
export const SWAP_STATUS_LABEL: Record<SwapDisplayStatus, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/** Pill fill + ink. */
export const SWAP_STATUS_TONE: Record<SwapDisplayStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-success/10 text-success',
  declined: 'bg-danger/10 text-danger',
  cancelled:
    'bg-divider text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

/** Legend dot. */
export const SWAP_STATUS_DOT: Record<SwapDisplayStatus, string> = {
  pending: 'bg-warning',
  approved: 'bg-success',
  declined: 'bg-danger',
  cancelled: 'bg-secondary dark:bg-secondary-dark',
};

/** Donut arc. */
export const SWAP_STATUS_STROKE: Record<SwapDisplayStatus, string> = {
  pending: 'stroke-warning',
  approved: 'stroke-success',
  declined: 'stroke-danger',
  cancelled: 'stroke-secondary dark:stroke-secondary-dark',
};

/** Counts per status, in the order the legend and tabs list them. */
export function countByStatus(rows: SwapRow[]): SwapStatusCount[] {
  const order: SwapDisplayStatus[] = ['pending', 'approved', 'declined', 'cancelled'];
  return order.map((status) => ({
    status,
    label: SWAP_STATUS_LABEL[status],
    count: rows.filter((row) => row.status === status).length,
  }));
}
