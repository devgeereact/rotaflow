import { supabase } from '@/lib/supabase';

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
  const { data, error } = await supabase
    .from('role_delegations')
    .select('id, from_user_id, to_user_id, starts_at, ends_at, note, revoked_at')
    .eq('org_id', orgId)
    .order('starts_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    note: row.note,
    revokedAt: row.revoked_at,
  }));
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
  const { data, error } = await supabase.rpc('delegate_role', {
    p_org: orgId,
    p_to: toUserId,
    p_until: until,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data;
}

/** End cover early. The person who arranged it, or any real manager. */
export async function revokeDelegation(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_delegation', { p_id: id });
  if (error) throw error;
}

/** Live right now: started, not ended, not revoked. */
export function isLive(delegation: Delegation, now: Date = new Date()): boolean {
  if (delegation.revokedAt) return false;
  const at = now.toISOString();
  return delegation.startsAt <= at && delegation.endsAt > at;
}
