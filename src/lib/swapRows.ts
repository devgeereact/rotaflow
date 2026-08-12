import type { BadgeTone } from '@/components/ui/Badge';
import type { ShiftSwap } from '@/types';

/**
 * The states `/app/swaps` shows (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.swaps`). Richer than the raw five-value `shift_swaps.status`:
 * whether a colleague was named splits `pending` into `open` (nobody has it
 * yet) and `awaiting_colleague` (someone specific hasn't answered).
 *
 * `accepted` means the colleague has said yes and the row is now awaiting
 * whichever of the requester or a manager finalises it first — see
 * `statusNote` in `swapMapping.ts`, which depends on Settings → Policies'
 * swap-approval toggle.
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
  /** Drives whether the row shows the viewer a decision to make. */
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

/** Tile counts for the pagehead (`SCREENS.swaps`'s four `tiles([...])`). */
export interface SwapTileCounts {
  open: number;
  waitingOnYou: number;
  approved: number;
  declined: number;
}

export function countSwapTiles(rows: SwapRow[]): SwapTileCounts {
  return {
    open: rows.filter((r) => r.status === 'open').length,
    waitingOnYou: rows.filter((r) => r.needsReview).length,
    approved: rows.filter((r) => r.status === 'approved').length,
    declined: rows.filter((r) => r.status === 'declined').length,
  };
}
