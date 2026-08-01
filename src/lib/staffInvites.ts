import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Invite, MembershipRole } from '@/types';

/**
 * Pure shaping for the Staff workspace's Invitations tab. No Supabase import
 * here — `src/services/inviteService.ts` fetches, this turns rows into what
 * the table and the summary tiles render.
 */

/**
 * How close to lapsing an invite has to be before the screen flags it, so a
 * manager can reissue before the invitee loses their only link.
 */
export const EXPIRING_SOON_DAYS = 2;

export const INVITE_ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

/** Shown under the role field in the invite form, in invite order. */
export const INVITE_ROLE_HINTS: Record<MembershipRole, string> = {
  owner: 'Everything, including org settings and billing',
  manager: 'Build rotas, approve requests, manage staff',
  staff: 'View their rota, clock in, request leave',
};

export interface InviteRow {
  id: string;
  email: string;
  role: MembershipRole;
  roleLabel: string;
  /** "12 Mar 2026" — when the invitation was minted. */
  invitedOn: string;
  /** Whole calendar days since it was minted. */
  invitedDaysAgo: number;
  /** Whole calendar days left; 0 means it lapses today. */
  daysLeft: number;
  /** "in 5 days" / "tomorrow" / "today". */
  expiresLabel: string;
  expiringSoon: boolean;
}

export interface InviteStats {
  pending: number;
  expiringSoon: number;
  /** Manager and owner invites — the ones worth a second look before they land. */
  elevated: number;
  staff: number;
  /** Minted in the last seven calendar days, today included. */
  sentThisWeek: number;
}

/**
 * `invites.role` is a plain `text` column, so a row can carry anything the
 * database accepted. Anything unrecognised reads as the least-privileged role
 * rather than crashing a label lookup — the DB policy, not this, is what
 * actually grants access.
 */
export function toMembershipRole(value: string): MembershipRole {
  return value === 'owner' || value === 'manager' ? value : 'staff';
}

function expiryLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft} days`;
}

/**
 * Days are counted as **calendar** days in the reader's timezone, not as
 * fixed 24-hour blocks: an invite minted at 23:00 that lapses at 09:00 two
 * mornings later expires "in 2 days" to the person reading it, whatever the
 * elapsed milliseconds say. Subtracting timestamps also silently loses or
 * gains a day across a DST boundary.
 */
export function toInviteRow(invite: Invite, now: Date): InviteRow {
  const role = toMembershipRole(invite.role);
  const createdAt = parseISO(invite.created_at);
  const daysLeft = differenceInCalendarDays(parseISO(invite.expires_at), now);

  return {
    id: invite.id,
    email: invite.email,
    role,
    roleLabel: INVITE_ROLE_LABELS[role],
    invitedOn: format(createdAt, 'd MMM yyyy'),
    invitedDaysAgo: differenceInCalendarDays(now, createdAt),
    daysLeft,
    expiresLabel: expiryLabel(daysLeft),
    expiringSoon: daysLeft <= EXPIRING_SOON_DAYS,
  };
}

export function buildInviteStats(rows: InviteRow[]): InviteStats {
  return {
    pending: rows.length,
    expiringSoon: rows.filter((row) => row.expiringSoon).length,
    elevated: rows.filter((row) => row.role !== 'staff').length,
    staff: rows.filter((row) => row.role === 'staff').length,
    // Today plus the six days before it, so "this week" means the last seven
    // days a manager could have sent one, not an ISO week that resets Monday.
    sentThisWeek: rows.filter((row) => row.invitedDaysAgo <= 6).length,
  };
}

/** Free-text match over invitee and role, driving the tab's search field. */
export function matchesInvite(row: InviteRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return `${row.email} ${row.roleLabel}`.toLowerCase().includes(needle);
}
