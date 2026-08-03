import type { Shift } from '@/types';

/**
 * Overlap detection for shift assignment.
 *
 * NEW_STRUCTURE §41 requires the builder to validate overlapping shifts and to
 * refuse to "silently allow invalid assignments". Before this module, every
 * write path — add, drag, paste, copy-previous-week, auto-fill — called
 * `createShift` unconditionally, so running "Copy previous week" onto a week
 * that already had a rota doubled every shift in it. That is exactly how the
 * live demo data ended up with each person rostered twice a day.
 *
 * The rule is deliberately narrow: two shifts clash only when the *same named
 * person* is on both and the time ranges intersect. Open (unassigned) shifts
 * never clash — several may legitimately sit in the same window awaiting cover,
 * which is what a shortage looks like.
 */

export interface ShiftWindow {
  staffProfileId: string | null;
  /** ISO instant. */
  startsAt: string;
  /** ISO instant. */
  endsAt: string;
}

/**
 * The fields a clash check actually reads. Kept narrower than `Shift` so
 * callers holding not-yet-inserted rows — the AI assistant checking its own
 * batch, for one — can take part without inventing a full database row.
 */
export interface ShiftLike {
  id: string;
  staff_profile_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
}

/**
 * Half-open intersection: a shift ending exactly when the next starts is a
 * back-to-back pair, not a clash. Compared as instants rather than as ISO text,
 * because Postgres may hand back the same moment with a different UTC offset
 * and string comparison would then disagree with the clock.
 */
export function windowsOverlap(a: ShiftWindow, b: ShiftWindow): boolean {
  const aStart = new Date(a.startsAt).getTime();
  const aEnd = new Date(a.endsAt).getTime();
  const bStart = new Date(b.startsAt).getTime();
  const bEnd = new Date(b.endsAt).getTime();
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Thrown when a write is refused because the person is already rostered.
 *
 * Tagged rather than a bare `Error` so the UI can safely show its message:
 * §45 forbids surfacing raw database errors, and a generic catch cannot tell
 * "you double-booked someone" from "the connection dropped".
 */
export class ShiftClashError extends Error {
  readonly clash: Shift;

  constructor(message: string, clash: Shift) {
    super(message);
    this.name = 'ShiftClashError';
    this.clash = clash;
  }
}

export function isShiftClashError(error: unknown): error is ShiftClashError {
  return error instanceof ShiftClashError;
}

export interface ClashQuery {
  /** Shift being edited, excluded from its own clash check. */
  ignoreShiftId?: string | null;
}

/**
 * The first existing shift the candidate would double-book, or null.
 *
 * Returns the earliest-starting clash so the message a manager sees names the
 * shift already in the diary rather than an arbitrary one.
 */
export function findClashingShift<T extends ShiftLike>(
  candidate: ShiftWindow,
  existing: readonly T[],
  query: ClashQuery = {},
): T | null {
  if (!candidate.staffProfileId) return null;

  const clashes = existing.filter((shift) => {
    if (shift.id === query.ignoreShiftId) return false;
    if (shift.status === 'cancelled') return false;
    if (shift.staff_profile_id !== candidate.staffProfileId) return false;
    return windowsOverlap(candidate, {
      staffProfileId: shift.staff_profile_id,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
    });
  });

  return clashes.sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
}

/**
 * Every pair of overlapping shifts already sitting in a set, keyed by the
 * later shift's id. Used to flag a rota that is *already* double-booked —
 * the guard above only stops new ones being written.
 */
export function findExistingClashes<T extends ShiftLike>(shifts: readonly T[]): T[] {
  const byStaff = new Map<string, T[]>();
  for (const shift of shifts) {
    if (!shift.staff_profile_id || shift.status === 'cancelled') continue;
    const group = byStaff.get(shift.staff_profile_id) ?? [];
    group.push(shift);
    byStaff.set(shift.staff_profile_id, group);
  }

  const clashed: T[] = [];
  for (const group of byStaff.values()) {
    const ordered = [...group].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        if (!a || !b) continue;
        if (
          windowsOverlap(
            {
              staffProfileId: a.staff_profile_id,
              startsAt: a.starts_at,
              endsAt: a.ends_at,
            },
            {
              staffProfileId: b.staff_profile_id,
              startsAt: b.starts_at,
              endsAt: b.ends_at,
            },
          )
        ) {
          clashed.push(b);
        }
      }
    }
  }
  return clashed;
}
