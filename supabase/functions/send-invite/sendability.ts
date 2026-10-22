// The part of send-invite that decides whether an invitation may be emailed.
//
// No Deno globals, so vitest runs it (`sendability.test.ts`), as with
// `ai-rota-assistant/grounding.ts` and `stripe-webhook/reconcile.ts`. BUG-015
// ("invitation emails") is about delivery, which only a real inbox can prove;
// what the repository can prove is that an invitation that should not go out is
// refused with a reason, and that the address always comes from the invite row.

export interface InviteRow {
  email: string;
  role: string;
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface Refusal {
  status: 400 | 409;
  error: string;
}

/**
 * Why this invite must not be emailed, or `null` when it may be.
 *
 * Order matters: a used or revoked invite is reported as such even when the
 * token also fails to match, because that is the fact the manager can act on.
 */
export function inviteRefusal(
  invite: InviteRow,
  suppliedTokenHash: string,
  now: Date,
): Refusal | null {
  if (invite.accepted_at || invite.revoked_at) {
    return { status: 409, error: 'That invite is no longer live' };
  }
  if (new Date(invite.expires_at) <= now) {
    return { status: 409, error: 'That invite has expired' };
  }
  // Proves the caller holds the real token, so a mistyped or stale one is
  // refused rather than emailed as a link that will not work.
  if (suppliedTokenHash !== invite.token_hash) {
    return { status: 400, error: 'That token does not match this invite' };
  }
  return null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'an owner',
  manager: 'a manager',
  staff: 'a team member',
};

export interface InviteEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * The message itself. The recipient is the invite row's address and nothing
 * else: a caller supplies the token, never the destination.
 */
export function inviteEmail(
  invite: InviteRow,
  orgName: string,
  origin: string,
  token: string,
): InviteEmail {
  const link = `${origin}/invite/${token}`;
  const expires = new Date(invite.expires_at).toUTCString();
  const roleLabel = ROLE_LABEL[invite.role] ?? 'a team member';
  return {
    to: invite.email,
    subject: `You have been invited to join ${orgName} on RotaFlow`,
    text: [
      `You have been invited to join ${orgName} on RotaFlow as ${roleLabel}.`,
      '',
      'Open this link to accept:',
      link,
      '',
      `The link expires on ${expires}.`,
      '',
      'If you were not expecting this, you can ignore this email — nothing happens until you open the link.',
    ].join('\n'),
  };
}
