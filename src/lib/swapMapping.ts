import { format, isToday, isYesterday } from 'date-fns';
import { toDisplayStatus } from '@/lib/swapRows';
import type { ShiftSwapWithShift } from '@/services/swapService';
import type { SwapParty, SwapRow } from '@/lib/swapRows';
import type { Location, StaffProfile } from '@/types';

export interface SwapMappingContext {
  staffById: Map<string, StaffProfile>;
  locationsById: Map<string, Location>;
  /** The signed-in user's `auth.users.id`, for "Approved by you". */
  userId: string | null;
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
  };
}
