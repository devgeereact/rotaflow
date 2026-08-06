import { supabase } from '@/lib/supabase';
import type { SupportAccessScope, SupportAccessSession } from '@/lib/supportAccess';

/**
 * Temporary support access.
 *
 * Reads are plain client queries, `support_access_select` in 0019 admits
 * platform staff to every row and a tenant's own members to their own, so the
 * same function serves the console list and the tenant-facing banner without
 * either needing a privileged path.
 *
 * Both writes go through RPCs that raise. The reason minimum, the case
 * reference, the duration bounds and the customer's `support_access_allowed`
 * opt-out are all enforced inside those functions, so a refused request comes
 * back as an error rather than as a quietly-missing row.
 */

/** Shape of the joined select. Narrow, because this runs on every tenant page. */
interface SessionRow {
  id: string;
  org_id: string;
  admin_user_id: string;
  reason: string;
  case_ref: string;
  scope: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  organisations: { name: string } | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

const SELECT = `
  id, org_id, admin_user_id, reason, case_ref, scope,
  granted_at, expires_at, revoked_at, revoke_reason,
  organisations:org_id ( name ),
  profiles:admin_user_id ( full_name, email )
`;

function toSession(row: SessionRow): SupportAccessSession {
  return {
    id: row.id,
    orgId: row.org_id,
    orgName: row.organisations?.name ?? 'Unknown organisation',
    adminUserId: row.admin_user_id,
    // Falls back through name → email → a stated absence. Never an empty cell:
    // "who opened this session" is the whole point of the row.
    adminName: row.profiles?.full_name ?? row.profiles?.email ?? 'Platform administrator',
    reason: row.reason,
    caseRef: row.case_ref,
    scope: row.scope === 'read_write' ? 'read_write' : 'read',
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
  };
}

/** Every session this account may see, newest first. */
export async function listSupportAccessSessions(
  limit = 100,
): Promise<SupportAccessSession[]> {
  const { data, error } = await supabase
    .from('support_access_sessions')
    .select(SELECT)
    .order('granted_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as SessionRow[]).map(toSession);
}

/**
 * Open sessions against one organisation. What the tenant-facing banner asks.
 *
 * Filters on `revoked_at is null` and a future expiry in the query rather than
 * in JavaScript, so it uses 0019's partial index and returns nothing at all in
 * the overwhelmingly common case where no one is looking.
 */
export async function listActiveSessionsForOrg(
  orgId: string,
): Promise<SupportAccessSession[]> {
  const { data, error } = await supabase
    .from('support_access_sessions')
    .select(SELECT)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('granted_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as unknown as SessionRow[]).map(toSession);
}

/** Open a session. Returns the new session id; raises if the database refuses. */
export async function requestSupportAccess(input: {
  orgId: string;
  reason: string;
  caseRef: string;
  scope: SupportAccessScope;
  minutes: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_support_access', {
    p_org: input.orgId,
    p_reason: input.reason,
    p_case_ref: input.caseRef,
    p_scope: input.scope,
    p_minutes: input.minutes,
  });
  if (error) throw error;
  return data;
}

/**
 * End a session early.
 *
 * Callable by the administrator who opened it, a platform owner or admin, or
 * an owner of the tenant being looked at. The last of those being the reason
 * the tenant banner carries this button rather than only a countdown.
 */
export async function revokeSupportAccess(
  sessionId: string,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('revoke_support_access', {
    p_session: sessionId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}
