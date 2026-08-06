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

/** Mint an invite. Owners/managers only. Enforced in the database. */
export async function createInvite(
  orgId: string,
  email: string,
  role: MembershipRole,
): Promise<CreatedInvite> {
  const { data, error } = await supabase.rpc('create_invite', {
    p_org: orgId,
    p_email: email,
    p_role: role,
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
