import type { BadgeTone } from '@/components/ui/Badge';
import type { ShiftSwap } from '@/types';

/**
 * The states `/app/swaps` shows (`docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.swaps`). Richer than the mockup's three (`open`/`pending`/
 * `approved`): the real schema lets a request name a colleague directly
 * (`target_staff_profile_id`), which the mockup's model has no equivalent
 * for, so a named-but-unanswered request gets its own state rather than
 * being folded into "open".
 */
export type SwapDisplayStatus =
  | 'open'
  | 'awaiting_colleague'
  | 'awaiting_manager'
  | 'approved'
  | 'declined'
  | 'cancelled';

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
      return 'awaiting_manager';
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
  awaiting_manager: 'Awaiting manager',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const SWAP_STATUS_TONE: Record<SwapDisplayStatus, BadgeTone> = {
  open: 'info',
  awaiting_colleague: 'warning',
  awaiting_manager: 'warning',
  approved: 'success',
  declined: 'danger',
  cancelled: 'neutral',
};
