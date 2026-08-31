import { supabase } from '@/lib/supabase';

/**
 * Two-factor authentication (CAP-049).
 *
 * `platform_settings.require_mfa` has existed since `0027`, defaulted to
 * true, and been enforced by nothing — its comment said "Supabase Auth is the
 * enforcement point", which was not true, because enrolment is a client call
 * and this application had never made one. `0102` makes the switch real;
 * this is the half that lets somebody satisfy it.
 *
 * TOTP only. WebAuthn is the better factor and Supabase supports it, but it
 * is device-bound: a ward tablet shared by a shift cannot hold a passkey for
 * each person, and the accounts this is protecting first are platform
 * administrators signing in from wherever they are. An authenticator app
 * works on the phone they already have.
 */

export interface MfaFactor {
  id: string;
  friendlyName: string | null;
  createdAt: string;
  status: 'verified' | 'unverified';
}

/** A started enrolment: what to show, and the id needed to finish it. */
export interface MfaEnrolment {
  factorId: string;
  /** An SVG data URI. Rendered as an image; never re-encoded. */
  qrCode: string;
  /**
   * The same secret as the QR code, in text. Not a fallback nicety — somebody
   * setting this up on the phone that is displaying the page cannot scan the
   * screen with that phone.
   */
  secret: string;
}

/** Every factor on the account, verified or not. */
export async function listMfaFactors(): Promise<MfaFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;

  return (data?.all ?? []).map((factor) => ({
    id: factor.id,
    friendlyName: factor.friendly_name ?? null,
    createdAt: factor.created_at,
    status: factor.status === 'verified' ? 'verified' : 'unverified',
  }));
}

/**
 * Start enrolling an authenticator app.
 *
 * Supabase refuses a duplicate friendly name, and an abandoned enrolment
 * leaves an unverified factor behind — somebody who closes the page mid-setup
 * and comes back would otherwise be permanently unable to start again. So any
 * unverified factor is cleared first. Verified ones are never touched here:
 * removing one is a deliberate act with its own control.
 */
export async function startMfaEnrolment(friendlyName: string): Promise<MfaEnrolment> {
  for (const factor of await listMfaFactors()) {
    if (factor.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) throw error;

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/**
 * Finish enrolment with a code from the app.
 *
 * `challengeAndVerify` is one call rather than challenge-then-verify: two
 * calls means holding a challenge id in component state, and a challenge that
 * expires while somebody types produces an error message about a challenge,
 * which means nothing to the person reading it.
 *
 * On success the session is upgraded to `aal2` — which is what
 * `is_platform_admin()` looks for once the requirement is on.
 */
export async function confirmMfaEnrolment(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.trim(),
  });
  if (error) throw error;
}

/**
 * Remove a factor.
 *
 * Supabase requires an `aal2` session to unenroll, which is the right rule and
 * is enforced server-side: somebody who has stolen a password cannot quietly
 * strip the second factor off the account.
 */
export async function removeMfaFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/**
 * Whether this session has completed a second factor.
 *
 * Read from GoTrue rather than from the JWT in the browser, so it reflects
 * what the server would decide rather than what a stale token says.
 */
export async function sessionIsAal2(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data?.currentLevel === 'aal2';
}
