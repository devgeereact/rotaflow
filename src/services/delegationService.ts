import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import { listOrgMembers } from '@/services/orgService';

/**
 * Temporary managerial cover (CAP-090, `0106`).
 *
 * "Deputy Manager" was a display label — `roleLabels` renames the three real
 * roles and changes nothing about what anybody may do. A manager going away
 * for a fortnight could either be promoted-and-hopefully-demoted, or leave
 * every request unanswered until they were back.
 *
 * A delegation confers `manager` and never `owner`: an owner who delegates
 * gets a deputy manager, not somebody who can delete the organisation or
 * change billing. It expires by time rather than by anybody remembering.
 */

export interface Delegation {
  id: string;
  fromUserId: string;
  toUserId: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
  revokedAt: string | null;
}

/** Every delegation in the organisation, newest first. */
export async function listDelegations(orgId: string): Promise<Delegation[]> {
  // The API lists live and future cover only; ended and revoked cover is in the audit trail.
  const r = await api.get<{
    delegations: {
      id: string;
      from_user_id: string;
      to_user_id: string;
      starts_at: string;
      ends_at: string;
      note: string | null;
      revoked_at: string | null;
    }[];
  }>(orgPath(orgId, '/delegations'));
  return r.delegations
    .map((row) => ({
      id: row.id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      note: row.note,
      revokedAt: row.revoked_at,
    }))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

/**
 * Hand somebody cover until a date.
 *
 * A function rather than an insert: the database has to check that the
 * caller is lending authority they actually hold, and — the part that
 * matters — that they are not themselves a delegate. Authority that chains
 * cannot be reasoned about.
 */
export async function delegateRole(
  orgId: string,
  toUserId: string,
  until: string,
  note?: string,
): Promise<string> {
  const member = (await listOrgMembers(orgId)).find(
    (m) => m.user_id === toUserId && m.status === 'active',
  );
  if (!member) throw new Error('That person is not in this organisation.');
  const r = await api.post<{ id: string }>(orgPath(orgId, '/delegations'), {
    membership_id: member.id,
    ends_at: until,
    note: note ?? null,
  });
  return r.id;
}

/** End cover early. The person who arranged it, or any real manager. */
export async function revokeDelegation(id: string): Promise<void> {
  await api.post(activeOrgPath(`/delegations/${seg(id)}/revoke`));
}

/** Live right now: started, not ended, not revoked. */
export function isLive(delegation: Delegation, now: Date = new Date()): boolean {
  if (delegation.revokedAt) return false;
  const at = now.toISOString();
  return delegation.startsAt <= at && delegation.endsAt > at;
}
