import { supabase } from '@/lib/supabase';
import type { AuditLog } from '@/types';

/**
 * Reader for `audit_logs`.
 *
 * ## What this table currently contains, and why the screen says so
 *
 * `audit_logs` has been provisioned and RLS-enabled since `0002`, but it has
 * exactly one writer in the whole system: the `anonymize_staff_member` RPC in
 * `0011`. No login, rota publish, shift edit, role change, invite or export is
 * recorded. So for almost every organisation this query correctly returns
 * nothing.
 *
 * That is a real state, not a bug, and the Audit screen renders it as one —
 * an empty trail that explains *which* events are recorded today rather than a
 * spinner or a fabricated history. Writing the missing events is a migration
 * (audit01 §P1-5); it must land before this screen can claim to be an
 * accountability control.
 *
 * Reads are owner-only at the database: `audit_logs_select` restricts to org
 * owners, and there is no client write policy at all — entries are append-only
 * from the server. A manager hitting this query gets an empty list from RLS,
 * which is why the screen also gates on role rather than relying on the empty
 * result to communicate "not for you".
 */
export interface AuditLogEntry extends AuditLog {
  /** Joined display name of the actor; null when the actor row was deleted. */
  actorName: string | null;
}

interface AuditRow extends AuditLog {
  actor: { full_name: string | null; email: string } | null;
}

function toEntry(row: AuditRow): AuditLogEntry {
  return { ...row, actorName: row.actor?.full_name ?? row.actor?.email ?? null };
}

/** Most recent entries for an organisation, newest first. */
export async function listAuditLogs(
  orgId: string,
  limit = 100,
): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*, actor:profiles!audit_logs_actor_user_id_fkey(full_name, email)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as AuditRow[]).map(toEntry);
}

/**
 * The signed-in user's own entries, for `/app/account/activity`.
 *
 * Scoped by `org_id` as well as actor because `audit_logs_select` is an
 * owner-only policy — a staff member reading their own activity gets nothing
 * back, and the screen says so rather than implying they have done nothing.
 */
export async function listMyAuditLogs(
  orgId: string,
  userId: string,
  limit = 50,
): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*, actor:profiles!audit_logs_actor_user_id_fkey(full_name, email)')
    .eq('org_id', orgId)
    .eq('actor_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as AuditRow[]).map(toEntry);
}
