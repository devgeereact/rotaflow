import { describe, expect, it } from 'vitest';
import {
  buildInviteStats,
  matchesInvite,
  toInviteRow,
  toMembershipRole,
} from '@/lib/staffInvites';
import type { InviteRow } from '@/lib/staffInvites';
import type { Invite } from '@/types';

/**
 * Expiry arithmetic for the Staff workspace's Invitations tab.
 *
 * A day miscounted here is a manager who thinks an invitation is live when it
 * lapsed overnight, and it never surfaces as an error. `.github/workflows/ci.yml`
 * pins `TZ: UTC`; these assertions must hold under any offset, including across
 * a DST boundary — which is exactly what subtracting two timestamps gets wrong.
 */

let seq = 0;
function invite(
  expiresAt: string,
  role = 'staff',
  createdAt = '2026-03-12T09:00:00Z',
): Invite {
  seq += 1;
  return {
    id: `invite-${seq}`,
    org_id: 'org-1',
    email: `person${seq}@example.com`,
    role,
    token_hash: 'hash',
    expires_at: expiresAt,
    created_at: createdAt,
    updated_at: createdAt,
    invited_by: null,
    accepted_at: null,
    accepted_by: null,
    revoked_at: null,
  };
}

describe('toInviteRow', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // 23:00 on the 12th → 09:00 on the 14th is 34 hours, i.e. one whole
    // 24-hour block. To the reader it is two sleeps away.
    const row = toInviteRow(
      invite('2026-03-14T09:00:00'),
      new Date('2026-03-12T23:00:00'),
    );
    expect(row.daysLeft).toBe(2);
    expect(row.expiresLabel).toBe('in 2 days');
  });

  it('survives a spring-forward DST boundary', () => {
    // Europe/London loses an hour on 29 March 2026, so this span is 167 wall
    // hours there and 168 under CI's UTC. A millisecond subtraction floors to
    // 6 in London and 7 in UTC — the same code, two answers.
    const row = toInviteRow(
      invite('2026-04-03T12:00:00'),
      new Date('2026-03-27T12:00:00'),
    );
    expect(row.daysLeft).toBe(7);
  });

  it('labels the near boundaries in words', () => {
    const now = new Date('2026-03-12T10:00:00');
    expect(toInviteRow(invite('2026-03-12T23:00:00'), now).expiresLabel).toBe('today');
    expect(toInviteRow(invite('2026-03-13T01:00:00'), now).expiresLabel).toBe('tomorrow');
    expect(toInviteRow(invite('2026-03-15T01:00:00'), now).expiresLabel).toBe(
      'in 3 days',
    );
  });

  it('flags an invite inside the expiring-soon window', () => {
    const now = new Date('2026-03-12T10:00:00');
    expect(toInviteRow(invite('2026-03-14T10:00:00'), now).expiringSoon).toBe(true);
    expect(toInviteRow(invite('2026-03-15T10:00:00'), now).expiringSoon).toBe(false);
  });

  it('formats the invited-on date from created_at', () => {
    const row = toInviteRow(
      invite('2026-03-19T09:00:00Z', 'manager', '2026-03-12T09:00:00Z'),
      new Date('2026-03-12T10:00:00Z'),
    );
    expect(row.invitedOn).toBe('12 Mar 2026');
    expect(row.roleLabel).toBe('Manager');
  });
});

describe('toMembershipRole', () => {
  it('passes through the three real roles', () => {
    expect(toMembershipRole('owner')).toBe('owner');
    expect(toMembershipRole('manager')).toBe('manager');
    expect(toMembershipRole('staff')).toBe('staff');
  });

  it('falls back to the least-privileged role for anything else', () => {
    expect(toMembershipRole('super_admin')).toBe('staff');
    expect(toMembershipRole('')).toBe('staff');
  });
});

describe('buildInviteStats', () => {
  it('splits pending invites by urgency and by privilege', () => {
    const now = new Date('2026-03-12T10:00:00');
    const rows = [
      toInviteRow(invite('2026-03-13T10:00:00', 'manager'), now),
      toInviteRow(invite('2026-03-20T10:00:00', 'owner'), now),
      toInviteRow(invite('2026-03-20T10:00:00', 'staff'), now),
      toInviteRow(invite('2026-03-14T10:00:00', 'staff'), now),
    ];

    expect(buildInviteStats(rows)).toEqual({
      pending: 4,
      expiringSoon: 2,
      elevated: 2,
      staff: 2,
      // Every fixture is minted on the 12th, i.e. today.
      sentThisWeek: 4,
    });
  });

  it('counts the last seven days, today included, as this week', () => {
    const now = new Date('2026-03-12T10:00:00');
    const rows = [
      // Minted today, six days ago, and seven days ago.
      toInviteRow(invite('2026-03-19T10:00:00', 'staff', '2026-03-12T09:00:00'), now),
      toInviteRow(invite('2026-03-13T10:00:00', 'staff', '2026-03-06T09:00:00'), now),
      toInviteRow(invite('2026-03-12T23:00:00', 'staff', '2026-03-05T09:00:00'), now),
    ];

    expect(rows.map((row) => row.invitedDaysAgo)).toEqual([0, 6, 7]);
    expect(buildInviteStats(rows).sentThisWeek).toBe(2);
  });

  it('reports zeroes for an empty list rather than throwing', () => {
    expect(buildInviteStats([])).toEqual({
      pending: 0,
      expiringSoon: 0,
      elevated: 0,
      staff: 0,
      sentThisWeek: 0,
    });
  });
});

describe('matchesInvite', () => {
  const row: InviteRow = toInviteRow(
    { ...invite('2026-03-20T10:00:00Z', 'manager'), email: 'Ada.Lovelace@example.com' },
    new Date('2026-03-12T10:00:00Z'),
  );

  it('matches on address and role, case-insensitively', () => {
    expect(matchesInvite(row, 'ADA')).toBe(true);
    expect(matchesInvite(row, 'manager')).toBe(true);
    expect(matchesInvite(row, 'example.com')).toBe(true);
  });

  it('keeps every row when the term is blank', () => {
    expect(matchesInvite(row, '   ')).toBe(true);
  });

  it('excludes a row nothing matches', () => {
    expect(matchesInvite(row, 'grace')).toBe(false);
  });
});
