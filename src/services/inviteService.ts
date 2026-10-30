import { activeOrgPath, api, isApiCode, orgPath, seg } from '@/lib/api';
import { appUrlFor } from '@/lib/appOrigin';
import type { Invite, MembershipRole } from '@/types';

/**
 * Invites are minted, previewed and redeemed through SECURITY DEFINER
 * functions rather than table writes.
 *
 * The invitee is authenticated but is not yet a member of the org, so the
 * org-scoped RLS policy on `invites` correctly hides the row from the one
 * person who needs to read it. Widening that policy would expose every
 * pending invite in the system, so redemption goes through
 * `accept_invite()` instead (see supabase/migrations/0006_invites.sql).
 *
 * Only a sha256 hash of the token is stored. `createInvite` returns the raw
 * token exactly once, if it is not put into the link there and then, it is
 * unrecoverable and the invite has to be reissued.
 */

export interface CreatedInvite {
  inviteId: string;
  /** Raw token. Returned once, never persisted. Put it straight into the link. */
  token: string;
  expiresAt: string;
  /** Ready-to-send URL for the invitee. */
  acceptUrl: string;
  /**
   * The API emails the invitation as part of creating it. These carry that first outcome, which
   * `sendInviteEmail` reports instead of sending a second copy.
   */
  emailSent?: boolean;
  emailError?: string | null;
}

export interface InvitePreview {
  orgName: string;
  role: MembershipRole;
  email: string;
  expiresAt: string;
}

/**
 * Absolute accept-invite URL.
 *
 * Built from the current origin, so an invite minted on localhost is
 * acceptable on localhost. It previously preferred `VITE_APP_URL` despite a
 * comment claiming it fell back to the origin in dev. It could not, because
 * that fallback only fires when the variable is empty (see lib/appOrigin.ts).
 * In production the two are the same value; in dev only one of them works.
 */
export function buildAcceptUrl(token: string): string {
  return appUrlFor(`/invite/${token}`);
}

/**
 * Where this person is being invited to work. Both optional, both applied to
 * their staff record when they accept (0126).
 *
 * These are ids, not names. "Invite your team" offered a Location dropdown
 * from the start and staged the chosen NAME in component state, where it was
 * shown back in the review table and then dropped on the floor: `createInvite`
 * took org, email and role, and `invites` had no column for either. A manager
 * assigned twenty people to sites during onboarding and every one of them
 * joined unassigned (RF-11).
 */
export interface InviteAssignment {
  departmentId?: string | null;
  locationId?: string | null;
}

/** Mint an invite. Owners/managers only. Enforced in the database. */
export async function createInvite(
  orgId: string,
  email: string,
  role: MembershipRole,
  assignment: InviteAssignment = {},
): Promise<CreatedInvite> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  if (role === 'owner') {
    // Owner invitations are the platform's to issue (organisations are by invitation only).
    const r = await api.post<{
      token: string;
      email_sent?: boolean;
      email_error?: string | null;
    }>(`/platform/orgs/${seg(orgId)}/owner-invites`, { owner_email: email });
    return {
      inviteId: '',
      token: r.token,
      expiresAt,
      acceptUrl: buildAcceptUrl(r.token),
      emailSent: r.email_sent ?? false,
      emailError:
        r.email_error ?? (r.email_sent ? null : 'Copy the link and send it yourself.'),
    };
  }
  const r = await api.post<{
    invite: { id: string };
    token: string;
    email_sent: boolean;
    email_error: string | null;
  }>(orgPath(orgId, '/invites'), {
    email,
    role,
    department_id: assignment.departmentId ?? null,
    location_id: assignment.locationId ?? null,
  });
  return {
    inviteId: r.invite.id,
    token: r.token,
    expiresAt,
    acceptUrl: buildAcceptUrl(r.token),
    emailSent: r.email_sent,
    emailError: r.email_error,
  };
}

/**
 * What does this token point at? Callable while signed out, so the accept
 * screen can say who the invite is for before asking the user to sign in.
 * Resolves to null for an invalid, expired, revoked or spent token.
 */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  try {
    const r = await api.post<{
      org_name: string;
      role: string;
      email: string;
      expires_at: string;
    }>('/invites/preview', { token });
    return {
      orgName: r.org_name,
      role: r.role as MembershipRole,
      email: r.email,
      expiresAt: r.expires_at,
    };
  } catch (error) {
    if (isApiCode(error, 'invite_invalid', 'not_found')) return null;
    throw error;
  }
}

/** Redeem a token and join the org. Returns the org id joined. */
export async function acceptInvite(token: string): Promise<string> {
  const r = await api.post<{ org_id: string }>('/invites/accept', { token });
  return r.org_id;
}

/** Pending (unaccepted, unrevoked, unexpired) invites for an org. */
export async function listPendingInvites(orgId: string): Promise<Invite[]> {
  const r = await api.get<{ invites: (Invite & { state: string })[] }>(
    orgPath(orgId, '/invites'),
  );
  return r.invites
    .filter((i) => i.state === 'pending')
    .map(({ state: _state, ...i }) => ({ ...i, org_id: orgId }));
}

/**
 * Revoke an invite. Soft. The row stays for audit, and the partial unique
 * index treats it as no longer live so the address can be re-invited.
 */
export async function revokeInvite(inviteId: string): Promise<void> {
  await api.post(activeOrgPath(`/invites/${seg(inviteId)}/revoke`));
}

export interface InviteEmailResult {
  sent: boolean;
  /** Present when the send failed; safe to show a manager. */
  reason?: string;
}

/**
 * Record the outcome against the invitation itself (`0129`).
 *
 * The result used to live only in the toast the manager saw. Reload the page
 * and a delivered invitation and one the SMTP server refused were both simply
 * "pending" — and they need opposite actions, because one is waiting on the
 * invitee and the other on the manager.
 *
 * Deliberately never throws. This is the record of a send, not the send: an
 * invitation that went out and whose bookkeeping failed must still be reported
 * as sent, and the caller's own return value is what the screen shows.
 */

/**
 * Email the join link to the person invited.
 *
 * Split from `createInvite` on purpose rather than folded into it: the invite
 * is the durable thing and the email is a delivery attempt, so a mail server
 * being down must not roll back a perfectly good invitation. The caller keeps
 * the link either way and can still pass it on by hand — which was the only
 * option before this existed (docs/SAAS.md GAP-005).
 *
 * The token is sent because it exists nowhere else: `invites` stores only its
 * sha256. The Edge Function verifies it against that hash and reads the
 * destination address from the invite row, so this cannot redirect an
 * invitation to somewhere the database did not say.
 */
export async function sendInviteEmail(
  orgId: string,
  invite: CreatedInvite,
): Promise<InviteEmailResult> {
  // Straight after creation: report the email the API already sent with it, once.
  if (invite.emailSent !== undefined) {
    const result: InviteEmailResult =
      invite.emailSent || !invite.emailError
        ? { sent: invite.emailSent }
        : { sent: false, reason: invite.emailError };
    invite.emailSent = undefined;
    return result;
  }
  if (!invite.inviteId)
    return { sent: false, reason: 'Copy the link and send it yourself.' };
  // Otherwise a resend: a fresh link is issued and emailed, so the old one stops working.
  const r = await api.post<{
    token: string;
    email_sent: boolean;
    email_error: string | null;
  }>(orgPath(orgId, `/invites/${seg(invite.inviteId)}/resend`));
  invite.token = r.token;
  invite.acceptUrl = buildAcceptUrl(r.token);
  return r.email_sent
    ? { sent: true }
    : { sent: false, reason: r.email_error ?? undefined };
}
