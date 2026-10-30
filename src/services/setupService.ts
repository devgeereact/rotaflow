import { api, orgPath } from '@/lib/api';
import { getOrganisation } from '@/services/orgService';
import type { SetupFacts } from '@/lib/setupProgress';

/**
 * What the database holds for one organisation, as counts.
 *
 * The setup screen needs to know whether a table has anything in it, not what
 * is in it. `count: 'exact', head: true` sends no rows at all, so a checklist
 * for an organisation with 250 staff and 10,000 shifts costs the same as one
 * for an empty organisation — and, more to the point, it cannot be the read
 * that quietly truncates at the API row cap the way a `select('*')` would.
 *
 * Each query carries `org_id`, so RLS and the predicate agree.
 */

/**
 * Read the count off a head-only query.
 *
 * Written to take the built query rather than a table name and a callback:
 * the callback version needed a generic over PostgREST's builder that
 * TypeScript could not reconcile across two structurally identical copies of
 * the same declaration, and the cure was worse than the repetition.
 *
 * Nothing here catches an error into a zero. A failed count rendered as
 * "0 locations" would tell a customer with six sites to go and create one.
 */
async function count(orgId: string, path: string, key: string): Promise<unknown[]> {
  const r = await api.get<Record<string, unknown[]>>(orgPath(orgId, path));
  return r[key] ?? [];
}

interface InviteCounts {
  pending: number;
  accepted: number;
  expired: number;
  neverSent: number;
  failed: number;
}

/**
 * The four states an invitation can be in, told apart.
 *
 * `listPendingInvites` collapses them: anything unaccepted, unrevoked and
 * unexpired is "pending", which puts an invitation whose email was refused by
 * the SMTP server in the same bucket as one somebody is simply slow to answer.
 * Those need opposite actions — one is waiting on the manager and one is
 * waiting on the invitee — so they are counted separately here, using the
 * delivery record `0129` added.
 *
 * Read as rows rather than as five head-counts: five round trips for
 * information one bounded query returns, and the invitation list for an
 * organisation is small by construction (a live invitation expires).
 */
async function countInvites(orgId: string): Promise<InviteCounts> {
  const r = await api.get<{
    invites: {
      accepted_at: string | null;
      revoked_at: string | null;
      expires_at: string;
      last_sent_at: string | null;
      send_error: string | null;
    }[];
  }>(orgPath(orgId, '/invites'));

  const now = Date.now();
  const counts: InviteCounts = {
    pending: 0,
    accepted: 0,
    expired: 0,
    neverSent: 0,
    failed: 0,
  };
  for (const row of r.invites) {
    if (row.revoked_at) continue;
    if (row.accepted_at) {
      counts.accepted += 1;
      continue;
    }
    if (new Date(row.expires_at).getTime() <= now) {
      counts.expired += 1;
      continue;
    }
    counts.pending += 1;
    if (row.send_error) counts.failed += 1;
    else if (!row.last_sent_at) counts.neverSent += 1;
  }
  return counts;
}

/**
 * Everything the setup checklist reads, in one pass.
 *
 * Issued together rather than in sequence: they are independent, and a
 * checklist that takes nine round trips to render is a checklist somebody
 * navigates away from before it finishes.
 */
export async function loadSetupFacts(orgId: string): Promise<SetupFacts> {
  const [
    organisation,
    locations,
    departments,
    jobTitles,
    shiftTypes,
    cover,
    staffRows,
    rotaRows,
    invites,
  ] = await Promise.all([
    getOrganisation(orgId),
    count(orgId, '/locations', 'locations'),
    count(orgId, '/departments', 'departments'),
    count(orgId, '/job-titles', 'job_titles'),
    count(orgId, '/shift-types', 'shift_types'),
    count(orgId, '/minimum-cover', 'rules'),
    api.get<{ staff: { user_id: string | null }[] }>(orgPath(orgId, '/staff'), {
      active: 1,
    }),
    api.get<{ rotas: { status: string }[] }>(orgPath(orgId, '/rotas')),
    countInvites(orgId),
  ]);

  const staff = staffRows.staff.length;
  const staffWithoutAccount = staffRows.staff.filter((s) => s.user_id === null).length;
  const rotasAny = rotaRows.rotas.length;
  const rotasPublished = rotaRows.rotas.filter((r) => r.status === 'published').length;
  const minimumCoverRules = cover.length;

  return {
    organisation,
    locations: locations.length,
    departments: departments.length,
    jobTitles: jobTitles.length,
    shiftTypes: shiftTypes.length,
    minimumCoverRules,
    staff,
    staffWithoutAccount,
    invitesPending: invites.pending,
    invitesAccepted: invites.accepted,
    invitesExpired: invites.expired,
    invitesNeverSent: invites.neverSent,
    invitesFailed: invites.failed,
    rotasAny,
    rotasPublished,
  };
}
