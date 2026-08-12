import type { BadgeTone } from '@/components/ui/Badge';
import type { ShiftSwap } from '@/types';

/**
 * The states `/app/swaps` shows (`design/Swap-Request.png`). Richer than
 * the raw five-value `shift_swaps.status`: whether a colleague was named
 * splits `pending` into `open` (nobody has it yet) and `awaiting_colleague`
 * (someone specific hasn't answered).
 *
 * `accepted` no longer means "awaiting a manager" — since
 * `0043_swap_requester_finalize.sql`, the REQUESTER can also close out a
 * named-colleague swap once the colleague has said yes, so this state is
 * genuinely "awaiting whichever of them acts first", not manager-specific.
 * The exact wording shown depends on who's looking; see `statusNote` in
 * `swapMapping.ts`.
 */
export type SwapDisplayStatus =
  'open' | 'awaiting_colleague' | 'accepted' | 'approved' | 'declined' | 'cancelled';

export interface SwapParty {
  firstName: string;
  lastName: string;
  /** "Care Assistant". The line under the name. */
  jobTitle: string | null;
  photoUrl: string | null;
}

/** One half of a swap: the shift being given away, or the one being taken. */
export interface SwapShiftSide {
  /** Pre-formatted, e.g. "Tue 27 May 2025". */
  dateLabel: string;
  /** Pre-formatted, e.g. "07:00-15:00". */
  timeLabel: string;
  locationName: string | null;
}

export interface SwapRow {
  id: string;
  /** The person giving their shift away. */
  from: SwapParty;
  fromStaffId: string;
  /** The colleague taking it. Null when the request is open to anyone. */
  to: SwapParty | null;
  toStaffId: string | null;
  /**
   * The shift changing hands. `shift_swaps` is a hand-over (A gives, B
   * takes), not a two-shift exchange, so both halves of the row render from
   * this one shift.
   */
  shift: SwapShiftSide | null;
  /** Pre-formatted, e.g. "Today, 09:15". */
  requestedLabel: string;
  note: string | null;
  status: SwapDisplayStatus;
  /** Second line under the pill, e.g. "Approved by you". Omitted when unknown. */
  statusNote: string | null;
  /** Drives the row button: "Review" when the viewer owes this row a decision, else "View". */
  needsReview: boolean;
}

/**
 * Folds the raw five-value `shift_swaps.status` plus whether a colleague was
 * named into the six states the screen distinguishes.
 */
export function toDisplayStatus(
  status: ShiftSwap['status'],
  hasTarget: boolean,
): SwapDisplayStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'declined';
    case 'cancelled':
      return 'cancelled';
    case 'accepted':
      return 'accepted';
    default:
      // 'pending': a named colleague hasn't answered yet, or nobody has.
      return hasTarget ? 'awaiting_colleague' : 'open';
  }
}

/**
 * Token classes per status, written out in full so Tailwind's content scan
 * can see each one. Every use is paired with the status spelled out in words
 * (docs/DESIGN.md §5).
 */
export const SWAP_STATUS_LABEL: Record<SwapDisplayStatus, string> = {
  open: 'Open',
  awaiting_colleague: 'Awaiting colleague',
  accepted: 'Accepted',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const SWAP_STATUS_TONE: Record<SwapDisplayStatus, BadgeTone> = {
  open: 'info',
  awaiting_colleague: 'warning',
  accepted: 'warning',
  approved: 'success',
  declined: 'danger',
  cancelled: 'neutral',
};

/** Legend dot on the Swap Overview donut. */
export const SWAP_STATUS_DOT: Record<SwapDisplayStatus, string> = {
  open: 'bg-info',
  awaiting_colleague: 'bg-warning',
  accepted: 'bg-warning',
  approved: 'bg-success',
  declined: 'bg-danger',
  cancelled: 'bg-secondary dark:bg-secondary-dark',
};

/** Swap Overview donut arc. */
export const SWAP_STATUS_STROKE: Record<SwapDisplayStatus, string> = {
  open: 'stroke-info',
  awaiting_colleague: 'stroke-warning',
  accepted: 'stroke-warning',
  approved: 'stroke-success',
  declined: 'stroke-danger',
  cancelled: 'stroke-secondary dark:stroke-secondary-dark',
};

export interface SwapStatusCount {
  status: SwapDisplayStatus;
  label: string;
  count: number;
}

/** Counts per status, in the order the legend lists them. */
export function countByStatus(rows: SwapRow[]): SwapStatusCount[] {
  const order: SwapDisplayStatus[] = [
    'open',
    'awaiting_colleague',
    'accepted',
    'approved',
    'declined',
    'cancelled',
  ];
  return order.map((status) => ({
    status,
    label: SWAP_STATUS_LABEL[status],
    count: rows.filter((row) => row.status === status).length,
  }));
}

/**
 * Tabs above the table (`design/Swap-Request.png`): coarser than the six
 * row-level statuses. "Pending Approval" is every state that still needs
 * someone — open, awaiting a named colleague, or accepted and awaiting
 * final approval — folded into one tab so a reviewer has a single place to
 * see everything not yet settled, while the row itself still shows which
 * of the three it actually is.
 */
export type SwapTab = 'all' | 'pending' | 'approved' | 'declined' | 'cancelled';

export function toSwapTab(status: SwapDisplayStatus): Exclude<SwapTab, 'all'> {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'declined':
      return 'declined';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}
