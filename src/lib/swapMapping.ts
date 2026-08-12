import { format, isToday, isYesterday } from 'date-fns';
import { toDisplayStatus } from '@/lib/swapRows';
import type { SwapActivityEntry } from '@/components/swaps/SwapActivityCard';
import type { ShiftSwapWithShift } from '@/services/swapService';
import type { SwapParty, SwapRow } from '@/lib/swapRows';
import type { Location, StaffProfile } from '@/types';

export interface SwapMappingContext {
  staffById: Map<string, StaffProfile>;
  locationsById: Map<string, Location>;
  /** The signed-in user's `auth.users.id`, for "Approved by you". */
  userId: string | null;
  /** The signed-in user's own `staff_profiles.id`, for the `accepted` note. */
  viewerStaffId: string | null;
  /** Manager/owner. Drives `needsReview` for open and accepted swaps. */
  canApprove: boolean;
}

/**
 * Whether the signed-in viewer owes this row a decision right now:
 *   - a manager, on anything still open or accepted (unchanged capability)
 *   - the named target, once named but not yet answered
 *   - the requester, once the target has said yes (0043 — no manager needed)
 */
function needsReview(
  status: SwapRow['status'],
  swap: ShiftSwapWithShift,
  context: SwapMappingContext,
): boolean {
  if (context.canApprove && (status === 'open' || status === 'accepted')) return true;
  if (
    status === 'awaiting_colleague' &&
    swap.target_staff_profile_id === context.viewerStaffId
  ) {
    return true;
  }
  if (status === 'accepted' && swap.requested_by === context.viewerStaffId) return true;
  return false;
}

function fullName(person: StaffProfile | undefined): string {
  return person ? `${person.first_name} ${person.last_name}` : 'Unknown';
}

function toParty(person: StaffProfile | undefined): SwapParty {
  if (!person) {
    return { firstName: 'Unknown', lastName: '', jobTitle: null, photoUrl: null };
  }
  return {
    firstName: person.first_name,
    lastName: person.last_name,
    jobTitle: person.job_title,
    photoUrl: person.photo_url,
  };
}

/** "Today, 09:15" · "Yesterday, 16:40" · "25 May 2025, 11:20". */
export function requestedLabel(iso: string): string {
  const when = new Date(iso);
  if (isToday(when)) return `Today, ${format(when, 'HH:mm')}`;
  if (isYesterday(when)) return `Yesterday, ${format(when, 'HH:mm')}`;
  return format(when, 'd MMM yyyy, HH:mm');
}

/**
 * The line under the status pill. Only states we can actually evidence get a
 * note; a decline reason is not stored, so declined rows carry none rather
 * than an invented one.
 */
function statusNote(
  swap: ShiftSwapWithShift,
  status: SwapRow['status'],
  context: SwapMappingContext,
): string | null {
  if (status === 'approved') {
    return swap.reviewed_by && swap.reviewed_by === context.userId
      ? 'Approved by you'
      : 'Approved';
  }
  if (status === 'cancelled') return 'Cancelled by requester';
  if (status === 'accepted') {
    // The colleague said yes; either the requester or a manager can close
    // it out now (0043), so the note names whichever applies to whoever is
    // actually looking at it.
    if (swap.requested_by === context.viewerStaffId) return 'Ready for your approval';
    if (swap.target_staff_profile_id === context.viewerStaffId)
      return 'Waiting on requester';
    return 'Awaiting requester';
  }
  return null;
}

/** One stored swap → one request-list row (`SCREENS.swaps`). */
export function toSwapRow(
  swap: ShiftSwapWithShift,
  context: SwapMappingContext,
): SwapRow {
  const shift = swap.shift;
  const location = shift?.location_id
    ? context.locationsById.get(shift.location_id)
    : undefined;
  const status = toDisplayStatus(swap.status, Boolean(swap.target_staff_profile_id));

  return {
    id: swap.id,
    from: toParty(context.staffById.get(swap.requested_by)),
    fromStaffId: swap.requested_by,
    to: swap.target_staff_profile_id
      ? toParty(context.staffById.get(swap.target_staff_profile_id))
      : null,
    toStaffId: swap.target_staff_profile_id,
    shift: shift
      ? {
          dateLabel: format(new Date(shift.starts_at), 'EEE d MMM yyyy'),
          timeLabel: `${format(new Date(shift.starts_at), 'HH:mm')}, ${format(
            new Date(shift.ends_at),
            'HH:mm',
          )}`,
          locationName: location?.name ?? null,
        }
      : null,
    requestedLabel: requestedLabel(swap.created_at),
    note: swap.note,
    status,
    statusNote: statusNote(swap, status, context),
    needsReview: needsReview(status, swap, context),
  };
}

/**
 * The "Recent Activity" rail, newest first. Derived from the swaps already
 * loaded rather than a separate feed — there is no activity table, and
 * inventing one would show entries the database cannot back.
 */
export function toSwapActivity(
  swaps: ShiftSwapWithShift[],
  context: SwapMappingContext,
  limit = 3,
): SwapActivityEntry[] {
  return [...swaps]
    .sort(
      (a, b) =>
        new Date(b.updated_at ?? b.created_at).getTime() -
        new Date(a.updated_at ?? a.created_at).getTime(),
    )
    .slice(0, limit)
    .map((swap) => {
      const requester = fullName(context.staffById.get(swap.requested_by));
      const target = swap.target_staff_profile_id
        ? fullName(context.staffById.get(swap.target_staff_profile_id))
        : 'anyone';
      const at = requestedLabel(swap.updated_at ?? swap.created_at);

      if (swap.status === 'approved') {
        return {
          id: swap.id,
          kind: 'approved' as const,
          title: `${requester}'s swap was approved`,
          detail: `With ${target}`,
          timeLabel: at,
        };
      }
      if (swap.status === 'rejected') {
        return {
          id: swap.id,
          kind: 'declined' as const,
          title: `${requester}'s swap was declined`,
          detail: `With ${target}`,
          timeLabel: at,
        };
      }
      return {
        id: swap.id,
        kind: 'requested' as const,
        title: 'New swap request received',
        detail: `${requester} → ${target}`,
        timeLabel: at,
      };
    });
}
