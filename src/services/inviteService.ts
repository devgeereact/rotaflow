import { supabase } from '@/lib/supabase';
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
  const { data, error } = await supabase.rpc('create_invite', {
    p_org: orgId,
    p_email: email,
    p_role: role,
    // The database re-checks that both belong to `orgId` — `create_invite` is
    // SECURITY DEFINER, so RLS is not standing behind it and a foreign key
    // alone would accept another tenant's id.
    p_department: assignment.departmentId ?? null,
    p_location: assignment.locationId ?? null,
  });

  if (error) throw error;

  const row = data?.[0];
  if (!row) throw new Error('The invitation could not be created.');

  return {
    inviteId: row.invite_id,
    token: row.token,
    expiresAt: row.expires_at,
    acceptUrl: buildAcceptUrl(row.token),
  };
}

/**
 * What does this token point at? Callable while signed out, so the accept
 * screen can say who the invite is for before asking the user to sign in.
 * Resolves to null for an invalid, expired, revoked or spent token.
 */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const { data, error } = await supabase.rpc('preview_invite', { p_token: token });
  if (error) throw error;

  const row = data?.[0];
  if (!row) return null;

  return {
    orgName: row.org_name,
    role: row.role as MembershipRole,
    email: row.email,
    expiresAt: row.expires_at,
  };
}

/** Redeem a token and join the org. Returns the org id joined. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
  if (error) throw error;
  if (!data) throw new Error('The invitation could not be accepted.');
  return data;
}

/** Pending (unaccepted, unrevoked, unexpired) invites for an org. */
export async function listPendingInvites(orgId: string): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Revoke an invite. Soft. The row stays for audit, and the partial unique
 * index treats it as no longer live so the address can be re-invited.
 */
export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId);

  if (error) throw error;
}

export interface InviteEmailResult {
  sent: boolean;
  /** Present when the send failed; safe to show a manager. */
  reason?: string;
}

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
  // Typed at the call, matching billingCheckoutService: an untyped invoke
  // returns `any` and destructuring it trips no-unsafe-assignment.
  const result = await supabase.functions.invoke<{ sent?: boolean; error?: string }>(
    'send-invite',
    { body: { orgId, inviteId: invite.inviteId, token: invite.token } },
  );

  if (result.error) {
    // The function returns a human-readable `error` for the cases a manager can
    // act on — no mailbox configured, SMTP refused — and it is more useful than
    // "FunctionsHttpError". Same unwrap as billingCheckoutService.
    let reason: string | undefined;
    const context = (result.error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = (await context.json()) as { error?: string };
        reason = body.error;
      } catch {
        reason = undefined;
      }
    }
    return { sent: false, reason };
  }

  return { sent: Boolean(result.data?.sent) };
}
