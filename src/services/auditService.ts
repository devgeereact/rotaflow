import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';
import type { AuditLog } from '@/types';

/**
 * Reader for `audit_logs`.
 *
 * ## What this table contains
 *
 * Until 0016 it had exactly one writer in the whole system — the
 * `anonymize_staff_member` RPC in 0011 — so for almost every organisation this
 * query correctly returned nothing (audit01 §P1-5). 0016 adds the writers:
 * database triggers for events the database can observe (membership role and
 * status changes, rota publish/unpublish, invites issued/revoked/accepted,
 * organisation plan/name/settings changes, platform role grants) and a
 * whitelisted `log_audit_event` RPC for the ones it cannot — exports, which
 * are reads and leave no row behind.
 *
 * Shifts are deliberately not audited individually: publishing a rota writes
 * hundreds of rows, and one audit entry each would make this a second shifts
 * table. Rota activity is recorded at the decision, not the consequence.
 *
 * ## Why the actor is read from the row, not joined
 *
 * The previous implementation joined `profiles!audit_logs_actor_user_id_fkey`.
 * That join resolved to `null` for every actor except the reader themselves,
 * because `profiles` RLS was own-row-only — so the screen showed "—" in the
 * actor column for everything. 0016 snapshots `actor_name`/`actor_email` onto
 * the row at write time instead, which fixes the display without widening
 * `profiles` so co-members can read each other's email addresses. It is also
 * more truthful: an audit record should say who acted *then*, not who that
 * account happens to be now.
 *
 * ## Visibility
 *
 * `audit_logs_select` (0016) admits a non-platform reader only to rows with
 * `visibility = 'org'` and a non-null `org_id` where they hold owner in that
 * org — or where they are the actor, which is what makes
 * `/app/account/activity` work for everyone. Platform-scoped rows carry a null
 * `org_id` and `visibility = 'platform_only'` and are unreachable from a tenant
 * session. There is still no client write policy at all.
 */
export interface AuditLogEntry extends AuditLog {
  /**
   * Display name of the actor at the time they acted; null for rows written
   * before 0016, and for events performed by the server with no session.
   */
  actorName: string | null;
}

function toEntry(row: AuditLog): AuditLogEntry {
  return { ...row, actorName: row.actor_name ?? row.actor_email ?? null };
}

/** Most recent entries for an organisation, newest first. */
export async function listAuditLogs(
  orgId: string,
  limit = 100,
): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toEntry);
}

/**
 * The signed-in user's own entries, for `/app/account/activity`.
 *
 * Scoped by `org_id` as well as actor because the events are org-scoped, and
 * because a staff member should see their activity in the organisation they
 * are looking at rather than a merged trail across every tenant they belong to.
 * Since 0016 this returns rows for any role, not just owners: the read policy
 * admits a reader to their own actions.
 */
export async function listMyAuditLogs(
  orgId: string,
  userId: string,
  limit = 50,
): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('org_id', orgId)
    .eq('actor_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toEntry);
}

/**
 * Record an event the database cannot observe for itself.
 *
 * Only exports qualify today: an export is a read, so no trigger can see it.
 * The action strings are whitelisted in the RPC — a client-callable audit
 * writer records intent, not proof, and without the whitelist it would be a
 * tool for seeding a plausible false trail.
 *
 * Deliberately swallows its error. Failing to record an export must not fail
 * the export the user asked for; the alternative is a screen that refuses to
 * hand over data it already assembled because the audit write timed out.
 */
export async function logAuditEvent(
  orgId: string,
  action: 'gdpr.export' | 'report.exported' | 'timesheet.exported' | 'staff.exported',
  entityType?: string,
  entityId?: string,
): Promise<void> {
  const { error } = await supabase.rpc('log_audit_event', {
    p_org: orgId,
    p_action: action,
    p_entity_type: entityType ?? null,
    p_entity_id: entityId ?? null,
  });
  if (error) reportError(error, { area: 'audit:log' });
}
