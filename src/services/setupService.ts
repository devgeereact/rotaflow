import { supabase } from '@/lib/supabase';
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
async function readCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await query;
  // Rethrown as an Error rather than the PostgREST object: the object is not
  // an Error, so the lint rule is right, and the message is the part any
  // caller or Sentry breadcrumb actually reads.
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `count: 'exact', head: true` — the row payload is never sent. */
const HEAD = { count: 'exact', head: true } as const;

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
  const { data, error } = await supabase
    .from('invites')
    .select('accepted_at, revoked_at, expires_at, last_sent_at, send_error')
    .eq('org_id', orgId)
    .is('revoked_at', null);
  if (error) throw error;

  const now = Date.now();
  const counts: InviteCounts = {
    pending: 0,
    accepted: 0,
    expired: 0,
    neverSent: 0,
    failed: 0,
  };

  for (const row of data ?? []) {
    if (row.accepted_at) {
      counts.accepted += 1;
      continue;
    }
    if (new Date(row.expires_at).getTime() <= now) {
      counts.expired += 1;
      continue;
    }
    counts.pending += 1;
    // Only live, unaccepted invitations are worth chasing. An expired one is
    // reissued rather than re-sent, and an accepted one's delivery history is
    // of no further interest.
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
    minimumCoverRules,
    staff,
    staffWithoutAccount,
    rotasAny,
    rotasPublished,
    invites,
  ] = await Promise.all([
    getOrganisation(orgId),
    readCount(supabase.from('locations').select('id', HEAD).eq('org_id', orgId)),
    readCount(supabase.from('departments').select('id', HEAD).eq('org_id', orgId)),
    // Archived titles still count as "set up": the catalogue exists, and an
    // organisation that has retired one is further along, not further back.
    readCount(supabase.from('job_titles').select('id', HEAD).eq('org_id', orgId)),
    readCount(supabase.from('shift_types').select('id', HEAD).eq('org_id', orgId)),
    readCount(
      supabase.from('minimum_cover_rules').select('id', HEAD).eq('org_id', orgId),
    ),
    readCount(
      supabase
        .from('staff_profiles')
        .select('id', HEAD)
        .eq('org_id', orgId)
        .eq('active', true),
    ),
    // A staff record with no `user_id` is somebody whose hours are recorded
    // and who cannot see them. That is the gap the sign-in step is about.
    readCount(
      supabase
        .from('staff_profiles')
        .select('id', HEAD)
        .eq('org_id', orgId)
        .eq('active', true)
        .is('user_id', null),
    ),
    readCount(supabase.from('rotas').select('id', HEAD).eq('org_id', orgId)),
    readCount(
      supabase
        .from('rotas')
        .select('id', HEAD)
        .eq('org_id', orgId)
        .eq('status', 'published'),
    ),
    countInvites(orgId),
  ]);

  return {
    organisation,
    locations,
    departments,
    jobTitles,
    shiftTypes,
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
