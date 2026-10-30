/**
 * Cover eligibility, candidate ranking and swap staleness (R2 slice S12). Pure functions only.
 *
 * Ported from SiteRelay `backend/src/Mod/Cover.php` and `src/features/cover/cover.ts`, re-made
 * for RotaFlow's rows. The server is the authority (`backend/src/CoverRules.php`, called inside
 * the approval transaction); this copy explains a candidate's reasons on screen. The leave,
 * availability, rest and weekly-hours arithmetic is S11's `schedulingRules`, not a second copy.
 * Mirrored cases: `coverRules.test.ts` and `backend/tests/suites/245-cover-rules.php`.
 *
 * Approved leave and declared unavailability BLOCK cover (somebody said they cannot work then);
 * short rest and a long week stay warnings, as S11 decided.
 */
import {
  shiftWarnings,
  type SchedulingLimits,
  type SchedulingWarning,
  type WarnAvailability,
  type WarnLeave,
  type WarnShift,
} from '@/lib/schedulingRules';

export type CoverReasonCode =
  | 'inactive'
  | 'absent'
  | 'overlap'
  | 'leave'
  | 'unavailable'
  | 'documents';

export interface CoverReason {
  code: CoverReasonCode;
  message: string;
}

export const COVER_REASON_LABELS: Record<CoverReasonCode, string> = {
  inactive: 'Not active',
  absent: 'Cannot attend',
  overlap: 'Already working',
  leave: 'On leave',
  unavailable: 'Unavailable',
  documents: 'Documents',
};

export interface CoverPerson {
  active: boolean;
  absent: boolean;
  /** Null when documents are not checked; otherwise the S10 eligibility result. */
  documents: { ok: boolean; missing: string[] } | null;
}

export interface CoverAssessment {
  reasons: CoverReason[];
  warnings: SchedulingWarning[];
}

/** Do any of `others` ([start, end) in ms) overlap [s, e)? */
export function overlaps(
  others: readonly { s: number; e: number }[],
  s: number,
  e: number,
): boolean {
  return others.some((o) => o.s < e && o.e > s);
}

/** Why `staff` cannot take `shift` (empty `reasons` = they can), plus the warnings that do not block. */
export function assessCover(
  staff: string,
  shift: Pick<WarnShift, 'id' | 'starts_at' | 'ends_at' | 'break_minutes' | 'timezone'>,
  person: CoverPerson,
  others: readonly WarnShift[],
  leave: readonly WarnLeave[],
  availability: readonly WarnAvailability[],
  limits: SchedulingLimits,
  orgTz: string,
): CoverAssessment {
  const reasons: CoverReason[] = [];
  if (!person.active)
    reasons.push({ code: 'inactive', message: 'Not an active member of staff' });
  if (person.absent)
    reasons.push({ code: 'absent', message: 'Said they cannot work this shift' });
  const s = Date.parse(shift.starts_at);
  const e = Date.parse(shift.ends_at);
  const mine = others.filter(
    (x) => x.id !== shift.id && x.staff_profile_id === staff && x.status !== 'cancelled',
  );
  if (
    overlaps(
      mine.map((x) => ({ s: Date.parse(x.starts_at), e: Date.parse(x.ends_at) })),
      s,
      e,
    )
  ) {
    reasons.push({ code: 'overlap', message: 'Already working at this time' });
  }
  const target: WarnShift = {
    id: shift.id,
    staff_profile_id: staff,
    starts_at: shift.starts_at,
    ends_at: shift.ends_at,
    break_minutes: shift.break_minutes,
    status: 'assigned',
    timezone: shift.timezone ?? null,
  };
  const byCode = new Map<string, SchedulingWarning>();
  for (const w of shiftWarnings([target], mine, leave, availability, limits, orgTz)[
    shift.id
  ] ?? []) {
    byCode.set(w.code, w);
  }
  for (const c of ['leave', 'unavailable'] as const) {
    const w = byCode.get(c);
    if (w) reasons.push({ code: c, message: w.message });
  }
  if (person.documents && !person.documents.ok) {
    const missing = person.documents.missing.join(', ');
    reasons.push({
      code: 'documents',
      message:
        missing === ''
          ? 'Required documents are not in order'
          : `Missing or expired: ${Array.from(missing).slice(0, 160).join('')}`,
    });
  }
  const warnings: SchedulingWarning[] = [];
  for (const c of ['rest', 'weekly_hours'] as const) {
    const w = byCode.get(c);
    if (w) warnings.push(w);
  }
  return { reasons, warnings };
}

export interface RankRow {
  eligible: boolean;
  applied: boolean;
  hours: number;
  reasons: readonly unknown[];
  name: string;
}

/** Eligible first, then people who applied, then fewest hours that week, then fewer reasons, then name. */
export function rankCandidates<T extends RankRow>(rows: readonly T[]): T[] {
  const key = (r: T): (number | string)[] => [
    r.eligible ? 0 : 1,
    r.applied ? 0 : 1,
    r.hours,
    r.reasons.length,
    r.name.toLowerCase(),
  ];
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const x = ka[i] as number | string;
      const y = kb[i] as number | string;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
}

export type SwapVoidReason = 'shift_changed' | 'shift_started';

/** Why a pending or accepted swap can no longer go ahead (same order as the server), or null. */
export function swapStaleReason(
  raisedFingerprint: string | null,
  currentFingerprint: string,
  shiftStatus: string,
  rotaStatus: string | null,
  startsAtMs: number,
  nowMs: number,
): SwapVoidReason | null {
  if (
    (raisedFingerprint !== null && raisedFingerprint !== currentFingerprint) ||
    shiftStatus === 'cancelled' ||
    rotaStatus === 'archived'
  ) {
    return 'shift_changed';
  }
  return startsAtMs <= nowMs ? 'shift_started' : null;
}

export const SWAP_VOID_TEXT: Record<SwapVoidReason, string> = {
  shift_changed: 'Cancelled automatically: the shift changed after the swap was raised',
  shift_started: 'Cancelled automatically: the shift started before it was decided',
};

export type CoverStatus =
  | 'open'
  | 'covered'
  | 'dismissed'
  | 'withdrawn'
  | 'filled'
  | 'cancelled'
  | 'pending'
  | 'approved'
  | 'rejected';

/** Plain words for a cover record's status, for absence reports, requests and applications alike. */
export function coverStatusLabel(
  kind: 'absence' | 'request' | 'application',
  status: CoverStatus,
): string {
  if (kind === 'absence') {
    return (
      (
        {
          open: 'Waiting for a manager',
          covered: 'Cover arranged',
          dismissed: 'Still on the shift',
          withdrawn: 'Withdrawn',
        } as Record<string, string>
      )[status] ?? status
    );
  }
  if (kind === 'request') {
    return (
      (
        { open: 'Looking for cover', filled: 'Filled', cancelled: 'Closed' } as Record<
          string,
          string
        >
      )[status] ?? status
    );
  }
  return (
    (
      {
        pending: 'Waiting for a decision',
        approved: 'You are covering it',
        rejected: 'Not this time',
        withdrawn: 'Withdrawn',
      } as Record<string, string>
    )[status] ?? status
  );
}
