/**
 * The sign-in second-factor step, as a decision (CAP-049).
 *
 * Enrolment has worked since `0102`, but nothing after a password ever asked
 * for the code. A fresh sign-in therefore stopped at `aal1` for everybody,
 * `is_platform_admin()` could never be satisfied once `require_mfa` was on, and
 * the switch could not be turned on without locking every administrator out.
 *
 * This module decides what the gate shows. It is pure on purpose: the rule is
 * the part that has to be right, and it is the part a unit test can reach
 * without a Supabase client. `MfaGate` does the I/O and renders the result.
 *
 * ## The rule
 *
 * Supabase's own table (Auth guide, "Add a challenge step to sign in"):
 *
 *   current aal1, next aal1  no factor enrolled             -> proceed
 *   current aal1, next aal2  factor enrolled, not used yet  -> ask for the code
 *   current aal2, next aal2  factor used this session       -> proceed
 *   current aal2, next aal1  factor removed, stale token    -> proceed
 *
 * Only the second row asks. A null level means there is no session, which is
 * `ProtectedRoute`'s problem rather than this one's, so it proceeds and lets
 * that redirect happen.
 */

/** `aal1`, `aal2`, or a level GoTrue adds later, which never counts as either. */
export type AssuranceLevel = string | null;

export interface AssuranceLevels {
  currentLevel: AssuranceLevel;
  nextLevel: AssuranceLevel;
}

/** The shape of a factor this decision needs. Mirrors `MfaFactor` in the service. */
export interface ChallengeFactor {
  id: string;
  friendlyName: string | null;
  createdAt: string;
  status: 'verified' | 'unverified';
  factorType: string;
}

export type MfaStep =
  | { kind: 'proceed' }
  | {
      kind: 'challenge';
      /** Verified TOTP factors, oldest first. Never empty. */
      factors: ChallengeFactor[];
      /** Preselected, so a person with one factor never has to choose. */
      defaultFactorId: string;
    }
  /**
   * A second factor is owed but none this screen can take. Today that means a
   * phone or WebAuthn factor added outside this app, which RotaFlow does not
   * offer. Admitting the session would skip the factor; so the only honest
   * exit is signing out.
   */
  | { kind: 'unsupported' };

/** Whether this session owes a second factor before the app may load. */
export function needsSecondFactor(levels: AssuranceLevels): boolean {
  return levels.currentLevel === 'aal1' && levels.nextLevel === 'aal2';
}

/**
 * What the gate should show.
 *
 * `factors` only matters when a second factor is owed, and the gate does not
 * list them otherwise, so passing `[]` in the other cases is expected.
 */
export function decideMfaStep(
  levels: AssuranceLevels,
  factors: readonly ChallengeFactor[],
): MfaStep {
  if (!needsSecondFactor(levels)) return { kind: 'proceed' };

  // Unverified factors are abandoned enrolments: GoTrue will not accept a
  // challenge against one, and offering it would be a choice that always fails.
  const usable = factors
    .filter((f) => f.status === 'verified' && f.factorType === 'totp')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const first = usable[0];
  if (first === undefined) return { kind: 'unsupported' };

  return { kind: 'challenge', factors: usable, defaultFactorId: first.id };
}

/** Keep digits only, at most six. Pasted codes often arrive as "123 456". */
export function normaliseCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

export function isCompleteCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export type MfaVerifyFailure =
  'wrong-code' | 'expired' | 'rate-limited' | 'offline' | 'factor-missing' | 'unknown';

function field(err: unknown, key: 'code' | 'status' | 'message'): unknown {
  if (typeof err === 'object' && err !== null && key in err) {
    return (err as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * Sort a failed verification into something a person can act on.
 *
 * The error codes are GoTrue's (`auth-js` `ErrorCode`). A wrong code is by far
 * the most common case, and older servers send it without a `code`, only a
 * message, so that is matched too.
 */
export function classifyMfaError(err: unknown): MfaVerifyFailure {
  const code = field(err, 'code');
  const status = field(err, 'status');
  const message = field(err, 'message');

  if (code === 'mfa_verification_failed') return 'wrong-code';
  if (code === 'mfa_challenge_expired') return 'expired';
  if (code === 'mfa_factor_not_found') return 'factor-missing';
  if (code === 'over_request_rate_limit' || status === 429) return 'rate-limited';
  // auth-js reports a request that never reached the server as status 0.
  if (status === 0) return 'offline';
  if (typeof message === 'string' && /invalid totp code/i.test(message)) {
    return 'wrong-code';
  }
  return 'unknown';
}

export const MFA_FAILURE_MESSAGES: Record<MfaVerifyFailure, string> = {
  'wrong-code':
    'That code was not accepted. Codes change every 30 seconds, so enter the one your app is showing now.',
  expired:
    'That took too long and the request expired. Enter the code your app is showing now.',
  'rate-limited': 'Too many attempts. Wait a minute, then enter the current code.',
  offline:
    'Could not reach the server, so the code could not be checked. Check your connection and try again.',
  'factor-missing':
    'That authenticator is no longer on your account. Sign out and sign in again.',
  unknown: 'The code could not be checked. Try again, or sign out and sign in again.',
};
