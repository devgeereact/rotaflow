import { api, orgPath } from '@/lib/api';
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
  org_name: string | null;
  admin_user_id: string;
  admin_email: string | null;
  reason: string;
  case_ref: string;
  scope: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

function toSession(row: SessionRow): SupportAccessSession {
  return {
    id: row.id,
    orgId: row.org_id,
    orgName: row.org_name ?? 'Unknown organisation',
    adminUserId: row.admin_user_id,
    adminName: row.admin_email ?? 'Platform administrator',
    reason: row.reason,
    caseRef: row.case_ref,
    scope: row.scope === 'read_write' ? 'read_write' : 'read',
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
  };
}

async function orgSessions(orgId: string): Promise<SupportAccessSession[]> {
  const r = await api.get<{ sessions: SessionRow[] }>(
    orgPath(orgId, '/support-sessions'),
  );
  return r.sessions.map(toSession);
}

export async function listSupportAccessSessions(
  limit = 100,
): Promise<SupportAccessSession[]> {
  const r = await api.get<{ sessions: SessionRow[] }>('/platform/support-sessions');
  return r.sessions.slice(0, limit).map(toSession);
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
  const now = Date.now();
  return (await orgSessions(orgId)).filter(
    (s) => s.revokedAt === null && new Date(s.expiresAt).getTime() > now,
  );
}

/**
 * Every session ever opened against one organisation, newest first.
 *
 * The organisation detail page used to read the platform-wide list capped at
 * 200 and filter it in the browser, so past that cap the Support tab asserted
 * "No support session has ever been opened against this organisation" about a
 * tenant whose sessions had simply been crowded out by other tenants'. Scoped
 * in the query instead; at tenant scope this needs no paging.
 */
export async function listSessionsForOrg(orgId: string): Promise<SupportAccessSession[]> {
  return orgSessions(orgId);
}

/** Open a session. Returns the new session id; raises if the database refuses. */
export async function requestSupportAccess(input: {
  orgId: string;
  reason: string;
  caseRef: string;
  scope: SupportAccessScope;
  minutes: number;
}): Promise<string> {
  const r = await api.post<{ id: string }>(
    `/platform/orgs/${encodeURIComponent(input.orgId)}/support-sessions`,
    {
      reason: input.reason,
      case_ref: input.caseRef,
      scope: input.scope,
      minutes: input.minutes,
    },
  );
  return r.id;
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
  // A platform administrator ends their own or anyone's session here; an organisation's owner uses
  // revokeSupportAccessForOrg.
  await api.post(`/platform/support-sessions/${encodeURIComponent(sessionId)}/revoke`, {
    reason: reason ?? null,
  });
}

/** The organisation's owner (or manager) ends a support session on their organisation. */
export async function revokeSupportAccessForOrg(
  orgId: string,
  sessionId: string,
  reason?: string,
): Promise<void> {
  await api.post(
    orgPath(orgId, `/support-sessions/${encodeURIComponent(sessionId)}/revoke`),
    {
      reason: reason ?? null,
    },
  );
}
