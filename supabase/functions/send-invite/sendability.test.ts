import { describe, expect, it } from 'vitest';
import { inviteEmail, inviteRefusal, type InviteRow } from './sendability';

/**
 * BUG-015, re-tested 2026-10-21 under GAP-115. Delivery into a mailbox is
 * proved only by sending one (an owner action in the work queue). These tests
 * hold what the repository can prove: a dead invitation is refused with the
 * reason a manager can act on, and the message goes to the invite row's
 * address with a link that opens it.
 */

const now = new Date('2026-10-21T12:00:00Z');

const live: InviteRow = {
  email: 'new.starter@example.org',
  role: 'staff',
  token_hash: 'abc123',
  expires_at: '2026-10-28T12:00:00Z',
  accepted_at: null,
  revoked_at: null,
};

describe('inviteRefusal', () => {
  it('lets a live invitation with the right token through', () => {
    expect(inviteRefusal(live, 'abc123', now)).toBeNull();
  });

  it('refuses an accepted or revoked invitation, before checking the token', () => {
    expect(
      inviteRefusal({ ...live, accepted_at: '2026-10-20T09:00:00Z' }, 'wrong', now),
    ).toEqual({
      status: 409,
      error: 'That invite is no longer live',
    });
    expect(
      inviteRefusal({ ...live, revoked_at: '2026-10-20T09:00:00Z' }, 'abc123', now)
        ?.status,
    ).toBe(409);
  });

  it('refuses an invitation at or after its expiry', () => {
    expect(
      inviteRefusal({ ...live, expires_at: now.toISOString() }, 'abc123', now),
    ).toEqual({
      status: 409,
      error: 'That invite has expired',
    });
  });

  it('refuses a token that does not match the row', () => {
    expect(inviteRefusal(live, 'abc124', now)).toEqual({
      status: 400,
      error: 'That token does not match this invite',
    });
  });
});

describe('inviteEmail', () => {
  it('addresses the row, names the organisation and role, and links the token', () => {
    const message = inviteEmail(
      live,
      'Sunnyside Care',
      'https://rotaflow.space',
      'tok-1',
    );
    expect(message.to).toBe('new.starter@example.org');
    expect(message.subject).toBe(
      'You have been invited to join Sunnyside Care on RotaFlow',
    );
    expect(message.text).toContain('as a team member');
    expect(message.text).toContain('https://rotaflow.space/invite/tok-1');
    expect(message.text).toContain(new Date(live.expires_at).toUTCString());
  });

  it('falls back to "a team member" for a role it does not know', () => {
    expect(
      inviteEmail({ ...live, role: 'auditor' }, 'Org', 'https://x.test', 't').text,
    ).toContain('as a team member');
    expect(
      inviteEmail({ ...live, role: 'manager' }, 'Org', 'https://x.test', 't').text,
    ).toContain('as a manager');
  });
});
