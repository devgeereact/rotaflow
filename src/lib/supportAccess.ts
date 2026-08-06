/**
 * Temporary support access. The pure half.
 *
 * Duration options, status derivation and countdown formatting. Kept out of
 * `services/` so it can be unit-tested under Node without dragging in the
 * Supabase client's WebSocket.
 *
 * Status is derived here *and* in SQL (`support_access_status`). That
 * duplication is deliberate: the database must not depend on a client to know
 * whether a grant is live, and the client must not have to round-trip to
 * re-render a countdown every second. Both read the same three fields in the
 * same order, and the tests below pin the order.
 */

export type SupportAccessStatus = 'active' | 'expired' | 'revoked';

export type SupportAccessScope = 'read' | 'read_write';

export interface SupportAccessSession {
  id: string;
  orgId: string;
  orgName: string;
  adminUserId: string;
  adminName: string;
  reason: string;
  caseRef: string;
  scope: SupportAccessScope;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

/**
 * The durations the console offers, matching the 15-minute floor and 24-hour
 * ceiling that `request_support_access` enforces. Kept in one place so the
 * dropdown cannot drift out of the range the database will accept.
 */
export const SUPPORT_ACCESS_DURATIONS: readonly { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '24 hours' },
] as const;

export const MIN_REASON_LENGTH = 15;

export const SCOPE_LABELS: Record<SupportAccessScope, string> = {
  read: 'Read only',
  read_write: 'Read and write',
};

/**
 * Where a session stands, at a given moment.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the countdown and
 * the tests agree about what "now" means. Passing it in is also what lets a
 * single render pass judge a whole list against one instant, instead of each
 * row sampling the clock a few microseconds apart.
 */
export function sessionStatus(
  session: Pick<SupportAccessSession, 'expiresAt' | 'revokedAt'>,
  now: Date,
): SupportAccessStatus {
  if (session.revokedAt !== null) return 'revoked';
  return new Date(session.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
}

/** Milliseconds left, floored at zero, never negative, never NaN for a bad date. */
export function millisecondsRemaining(expiresAt: string, now: Date): number {
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - now.getTime());
}

/**
 * Countdown for the banner, e.g. "43 minutes" or "3 hours 5 minutes".
 *
 * Rounds *down*, deliberately. A session with 90 seconds left should read
 * "1 minute", not "2 minutes". Overstating remaining access is the direction
 * that misleads, and the banner exists to make expiry feel imminent.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'under a minute';
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`;
  if (minutes === 0) return hourPart;
  return `${hourPart} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Client-side validation, mirroring the CHECK constraints so a person gets a
 * sentence rather than a Postgres error code. The database is still the
 * authority. This exists to be kind, not to be trusted.
 */
export function validateRequest(input: {
  orgId: string;
  reason: string;
  caseRef: string;
  minutes: number;
}): Partial<Record<'orgId' | 'reason' | 'caseRef' | 'minutes', string>> {
  const errors: Partial<Record<'orgId' | 'reason' | 'caseRef' | 'minutes', string>> = {};

  if (!input.orgId) errors.orgId = 'Choose the organisation you need access to.';

  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    errors.reason = `Explain why access is needed, at least ${MIN_REASON_LENGTH} characters.`;
  }
  if (input.caseRef.trim().length < 3) {
    errors.caseRef = 'Enter the support case this relates to.';
  }
  if (!SUPPORT_ACCESS_DURATIONS.some((d) => d.minutes === input.minutes)) {
    errors.minutes = 'Choose one of the offered durations.';
  }
  return errors;
}

export interface SupportAccessStats {
  /** Open right now. */
  active: number;
  /** Granted since the first of the current month. */
  grantedThisMonth: number;
  /** Median minutes from grant to end, over sessions that have ended. */
  medianMinutes: number | null;
  /** Ended by a person rather than by the clock. */
  revokedEarly: number;
  /** Ran to expiry. Indistinguishable from "opened and forgotten". */
  expired: number;
}

/**
 * Summarise the session log for `/admin/support-access`.
 *
 * All of these are computed rather than stored: the table records a grant time,
 * an expiry and an optional revocation, and everything an administrator wants
 * to know about their own use of the door falls out of those three.
 *
 * **Median, not mean.** One four-hour investigation among twenty five-minute
 * look-ups drags a mean past both, and the number is read as "how long does a
 * support session usually last". The median answers that; the mean answers a
 * question nobody asked.
 *
 * "Expired unused" is deliberately named "expired" here: nothing records
 * whether anything was actually read during a session, so a session that ran to
 * its expiry is indistinguishable from one that was opened and forgotten. The
 * screen must not claim to know which.
 */
export function summariseSessions(
  sessions: readonly SupportAccessSession[],
  now: Date,
): SupportAccessStats {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const durations: number[] = [];
  let active = 0;
  let grantedThisMonth = 0;
  let revokedEarly = 0;
  let expired = 0;

  for (const session of sessions) {
    const granted = new Date(session.grantedAt).getTime();
    if (Number.isFinite(granted) && granted >= monthStart) grantedThisMonth += 1;

    const state = sessionStatus(session, now);
    if (state === 'active') {
      active += 1;
      continue;
    }
    if (state === 'revoked') revokedEarly += 1;
    if (state === 'expired') expired += 1;

    const ended = session.revokedAt
      ? new Date(session.revokedAt).getTime()
      : new Date(session.expiresAt).getTime();
    if (Number.isFinite(granted) && Number.isFinite(ended) && ended > granted) {
      durations.push((ended - granted) / 60_000);
    }
  }

  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const medianMinutes =
    durations.length === 0
      ? null
      : durations.length % 2 === 1
        ? Math.round(durations[mid] ?? 0)
        : Math.round(((durations[mid - 1] ?? 0) + (durations[mid] ?? 0)) / 2);

  return { active, grantedThisMonth, medianMinutes, revokedEarly, expired };
}
