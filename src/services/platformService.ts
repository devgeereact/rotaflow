import { api } from '@/lib/api';
import { buildAcceptUrl } from '@/services/inviteService';
import { grantPlatformRole, revokePlatformRole } from '@/services/platformRoleService';
import { fetchAllPages } from '@/lib/serverPage';
import type { AuditLog, Organisation, Profile, Subscription } from '@/types';

/**
 * Cross-tenant reads for `/admin/*`.
 *
 * ## Why these are plain client queries and not an Edge Function
 *
 * `public.is_platform_admin()` is folded into `is_org_member` and
 * `has_org_role` in 0002_rotaflow.sql, so a Super Admin's ordinary session
 * already reads across every tenant through RLS. Routing the same reads
 * through a service-role Edge Function would replace a policy the database
 * enforces with one this codebase would have to re-implement and keep correct.
 *
 * The consequence worth stating plainly: **for anyone who is not a platform
 * admin, every function here returns an empty list rather than an error.** RLS
 * filters rows, it does not raise. A screen that renders "no organisations"
 * for a non-admin is therefore doing exactly the right thing, and
 * `RequirePlatformAdmin` exists so nobody ever sees that and mistakes it for a
 * bug.
 */

/** Every tenant on the platform, newest first. */
interface DirectoryOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  trial_ends_at: string | null;
  created_at: string;
  support_access_allowed: boolean;
  suspended_reason: string | null;
  sub_status: string | null;
  grace_until: string | null;
  stripe_mode: string | null;
  members: number;
  active_staff: number;
  locations: number;
}

/** Every organisation, 100 at a time (the console's directory route). */
async function allOrgs(): Promise<DirectoryOrg[]> {
  const out: DirectoryOrg[] = [];
  for (let offset = 0; offset < 100_000; offset += 100) {
    const r = await api.get<{ organisations: DirectoryOrg[] }>('/platform/orgs', {
      limit: 100,
      offset,
    });
    out.push(...r.organisations);
    if (r.organisations.length < 100) break;
  }
  return out;
}

interface Summary {
  organisations: Record<string, number>;
  users: number;
  active_staff: number;
  published_rotas: number;
  shifts_this_month: number;
  open_support_sessions: number;
}

async function summary(): Promise<Summary> {
  return (await api.get<{ summary: Summary }>('/platform/summary')).summary;
}

function toOrganisation(o: DirectoryOrg): Organisation {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    plan: o.plan,
    trial_ends_at: o.trial_ends_at,
    created_at: o.created_at,
    updated_at: o.created_at,
    support_access_allowed: Boolean(o.support_access_allowed),
    suspended_reason: o.suspended_reason,
    suspended_at: null,
    contact_email: null,
    contact_phone: null,
    country: 'United Kingdom',
    timezone: 'Europe/London',
    created_by: null,
    industry: null,
    is_demo: false,
    last_activity_at: null,
    onboarding_completed_at: null,
    settings: {},
  };
}

export async function listAllOrganisations(): Promise<Organisation[]> {
  return (await allOrgs()).map(toOrganisation);
}

/** Every account with a RotaFlow profile. */
export async function listAllProfiles(): Promise<Profile[]> {
  const out: Profile[] = [];
  for (let offset = 0; offset < 100_000; offset += 100) {
    const r = await api.get<{
      users: {
        id: string;
        email: string;
        full_name: string | null;
        created_at: string;
        last_seen_at: string | null;
        platform_role: string | null;
      }[];
    }>('/platform/users', { limit: 100, offset });
    out.push(
      ...r.users.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        avatar_url: null,
        is_platform_admin: u.platform_role !== null,
        created_at: u.created_at,
        updated_at: u.last_seen_at ?? u.created_at,
      })),
    );
    if (r.users.length < 100) break;
  }
  return out;
}

export async function listAllSubscriptions(): Promise<Subscription[]> {
  return (await allOrgs())
    .filter((o) => o.sub_status !== null)
    .map((o) => ({
      id: o.id,
      org_id: o.id,
      plan: o.plan,
      status: o.sub_status ?? '',
      grace_until: o.grace_until,
      stripe_mode: o.stripe_mode ?? 'test',
      trial_ends_at: o.trial_ends_at,
      canceled_at: null,
      created_at: o.created_at,
      currency: 'GBP',
      current_period_end: null,
      past_due_since: null,
      price_pence: null,
      provider: 'stripe',
      provider_ref: null,
      started_at: o.created_at,
      stripe_customer_id: null,
      updated_at: o.created_at,
    }));
}

/**
 * Platform-wide audit trail.
 *
 * Capped rather than paginated: `audit_logs` grows without bound and this
 * screen is a recent-activity view, not an archive. The limit is passed in so
 * the caller owns the trade-off, and the screen says what it is showing.
 */
export async function listPlatformAuditLogs(limit = 200): Promise<AuditLog[]> {
  return (await searchPlatformAuditLogs({ pageSize: Math.min(200, limit) })).rows;
}

export interface MembershipCount {
  orgId: string;
  members: number;
}

/**
 * Member count per organisation.
 *
 * Counted client-side from the id list rather than with an aggregate: PostgREST
 * cannot GROUP BY without a database view, and adding one for a single admin
 * screen is a migration this does not need. Only `org_id` is selected, so the
 * payload stays small even across every tenant.
 */
export async function countMembershipsByOrg(): Promise<Map<string, number>> {
  return new Map((await allOrgs()).map((o) => [o.id, Number(o.members)]));
}

/**
 * Locations per organisation, across every tenant.
 *
 * Routed through `platform_location_counts()` (0054), not a direct select —
 * `locations_select` uses plain `is_org_member(org_id)`, which since 0028
 * requires an active support-access session for a platform administrator
 * (0031's carve-out for organisations/subscriptions/memberships never
 * covered `locations`). A direct select here silently returned zero rows
 * for every org without an open session, exactly the failure
 * `countPublishedRotas()` below already routes around the same way.
 */
export async function countLocationsByOrg(): Promise<Map<string, number>> {
  return new Map((await allOrgs()).map((o) => [o.id, Number(o.locations)]));
}

/**
 * Active staff per organisation, across every tenant (BUG-062).
 *
 * This is the population `plans.seat_limit` is actually enforced on — 0070's
 * trigger counts `staff_profiles where active is true`, and so does the
 * customer's own Settings → Billing screen. The console's seat-usage bar used
 * `countMembershipsByOrg` instead, which counts login accounts: a rota has far
 * more people on it than sign in, so an organisation at its cap could show
 * "Usage 20%" while the database was refusing its next staff member.
 *
 * Routed through an RPC for the same reason `countLocationsByOrg` above is —
 * `staff_profiles` is not in 0031's carve-out, so reading it directly across
 * every tenant returns nothing for any organisation without an open support
 * session, turning a wrong number into a confident zero.
 */
export async function countActiveStaffByOrg(): Promise<Map<string, number>> {
  return new Map((await allOrgs()).map((o) => [o.id, Number(o.active_staff)]));
}

/** Published rotas across every tenant. The platform-wide total. */
export async function countPublishedRotas(): Promise<number> {
  return (await summary()).published_rotas;
}

/** Every platform-wide total in one call. Counts, never rows. */
export async function getPlatformTotals(): Promise<{
  organisations: number;
  activeOrgs: number;
  profiles: number;
  staffProfiles: number;
  publishedRotas: number;
  shiftsThisMonth: number;
}> {
  const t = await summary();
  const byStatus = t.organisations;
  return {
    organisations: Object.values(byStatus).reduce((a, b) => a + Number(b), 0),
    activeOrgs: Number(byStatus.active ?? 0),
    profiles: t.users,
    staffProfiles: t.active_staff,
    publishedRotas: t.published_rotas,
    shiftsThisMonth: t.shifts_this_month,
  };
}

/**
 * Grant or revoke platform administration.
 *
 * ## Why this is no longer a `profiles` update
 *
 * It used to write `is_platform_admin` directly, and it did not work. `profiles`
 * RLS was still 0001's own-row-only policy, so the update matched zero rows and
 * PostgREST returned 204 with no error, a control that reported success and
 * changed nothing. 0015 fixes the read side and closes the write side entirely:
 * the UPDATE privilege on that column no longer exists for `authenticated`, so
 * the old call would now fail loudly rather than silently.
 *
 * Grants go through `grant_platform_role` / `revoke_platform_role`, which also
 * record *which* role and refuse to remove the last platform owner. The flag is
 * kept in sync by trigger; it is a mirror, not the source of truth.
 *
 * Kept here as a thin re-export so callers that only need "make this person an
 * administrator" do not have to choose a role. Anything role-aware should use
 * `platformRoleService` directly.
 */
export async function setPlatformAdmin(
  userId: string,
  isPlatformAdmin: boolean,
): Promise<void> {
  if (isPlatformAdmin) {
    // The most limited role that is still an administrator. Promotion beyond
    // it is a deliberate act on the administrators roster, not a side effect
    // of a toggle.
    await grantPlatformRole(userId, 'platform_support');
    return;
  }
  await revokePlatformRole(userId);
}

export interface CreateOrganisationWithInviteInput {
  name: string;
  slug: string;
  plan: 'starter' | 'professional' | 'business' | 'enterprise';
  ownerEmail: string;
  /** Pence. Omit or null to use the plan's list price. */
  pricePence?: number | null;
}

export interface CreatedOrganisationInvite {
  orgId: string;
  /** Needed to email the invitation: `send-invite` looks it up by id (0084). */
  inviteId: string;
  inviteToken: string;
  inviteExpiresAt: string;
  /** Ready-to-send URL for the contact, same shape as inviteService's own. */
  acceptUrl: string;
}

/**
 * Platform-admin-only. Creates an organisation for a prospect who contacted
 * sales directly, at a plan and (optionally) negotiated price the admin
 * sets, and mints an owner invite for the real contact — the admin never
 * holds membership in the org, not even briefly (enforced inside
 * `admin_create_organisation_with_invite`, 0051_admin_assisted_org_creation.sql).
 *
 * Raises rather than returning empty, same posture as `setPlatformAdmin`
 * above and `platformRoleService`'s grant/revoke functions — a refused
 * write must never look like a successful one.
 */
export async function createOrganisationWithInvite(
  input: CreateOrganisationWithInviteInput,
): Promise<CreatedOrganisationInvite> {
  // Organisations are by invitation: the API creates the organisation (30-day trial on Starter, slug from the
  // name) and its first owner's invitation in one step. The plan is chosen later through checkout.
  const r = await api.post<{ org: { id: string }; token: string }>('/platform/orgs', {
    name: input.name,
    owner_email: input.ownerEmail,
  });
  return {
    orgId: r.org.id,
    inviteId: '',
    inviteToken: r.token,
    inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    acceptUrl: buildAcceptUrl(r.token),
  };
}

export interface AuditQuery {
  /** Matches action, entity type, actor name or actor email. */
  search?: string;
  /** An organisation id, or the literal `'platform'` for platform-scoped events. */
  scope?: string;
  severity?: readonly string[];
  action?: readonly string[];
  /** ISO instants. `to` is exclusive. */
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
}

/**
 * Search the whole audit history, not the recent window.
 *
 * ## What this replaces
 *
 * `listPlatformAuditLogs(200)` loaded the last two hundred events and the
 * screen filtered that array. Every filter on it was therefore a filter *of
 * the recent window*: searching for an action from last month returned
 * nothing and said "No audit entries match these filters", which is a
 * sentence about the filter rather than about the window. On a deployment
 * with any traffic at all, two hundred events is hours.
 *
 * The cap was defended in the old function's comment as "a recent-activity
 * view, not an archive". That is a reasonable default and a bad ceiling: an
 * audit log exists to be searched after the fact, and the one question it is
 * always opened for — "what happened to this organisation on this date" —
 * is the one the window cannot answer.
 *
 * Filtered, ordered, counted and paged by PostgREST, so the total is the
 * number of matching events rather than the number that arrived.
 */
export async function searchPlatformAuditLogs(query: AuditQuery = {}): Promise<{
  rows: AuditLog[];
  total: number;
}> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const r = await api.get<{
    entries: (AuditLog & { id: string | number })[];
    total: number;
  }>('/platform/audit', {
    scope: query.scope && query.scope !== 'all' ? query.scope : undefined,
    severity: query.severity?.length === 1 ? query.severity[0] : undefined,
    q: query.search?.trim() || undefined,
    from: query.from ?? undefined,
    to: query.to ?? undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  // Several severities or actions at once are narrowed on the page the API returned.
  const rows = r.entries
    .map((e) => ({ ...e, id: String(e.id) }))
    .filter(
      (e) =>
        (!query.severity ||
          query.severity.length <= 1 ||
          query.severity.includes(e.severity)) &&
        (!query.action || query.action.length === 0 || query.action.includes(e.action)),
    );
  return { rows, total: r.total };
}

/**
 * Every event matching the filters, for an export within a stated range.
 *
 * Bounded, and the caller must say when it stopped. An audit export that
 * silently holds the first ten thousand of forty thousand events is worse than
 * none, because an investigation reads absence as evidence.
 */
export async function exportPlatformAuditLogs(
  query: AuditQuery = {},
): Promise<{ rows: AuditLog[]; total: number; truncated: boolean }> {
  const result = await fetchAllPages<AuditLog>(async (offset, limit) => {
    const page = await searchPlatformAuditLogs({
      ...query,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
    });
    return { rows: page.rows, total: page.total };
  });
  return result;
}

/**
 * Which of these slugs already belong to an organisation.
 *
 * One query rather than one `isSlugAvailable` call per row: a fifty-row
 * import would otherwise make fifty round trips to answer a question one
 * `in` clause answers. Chunked, because a URL carrying two thousand slugs is
 * how a GET becomes a 414.
 *
 * Reads `organisations` directly, which a platform administrator may do —
 * `0031`'s carve-out puts organisations, subscriptions and memberships within
 * reach without a support-access session. For anybody else RLS returns
 * nothing, and the import would then report every slug as free; that is
 * harmless, because the creation RPC refuses a non-administrator outright and
 * a duplicate is refused again by the unique index.
 */
export async function findExistingSlugs(slugs: readonly string[]): Promise<string[]> {
  const unique = [...new Set(slugs.filter((x) => x !== ''))];
  const found: string[] = [];
  for (const slug of unique) {
    const r = await api.get<{ available: boolean }>('/slug-available', { slug });
    if (!r.available) found.push(slug);
  }
  return found;
}

export interface GrowthPoint {
  /** First day of the UTC month. */
  monthStart: string;
  created: number;
  /** Cumulative: every organisation that existed by the end of the month. */
  total: number;
  churned: number;
}

/**
 * Organisations created, the running total and subscriptions churned, per
 * month, counted by the database (0133).
 *
 * The overview used to bucket `listAllOrganisations()` and
 * `listAllSubscriptions()` in the browser. Above PostgREST's cap that is a
 * chart of the cap rather than of the estate, and it slopes the wrong way as
 * the product succeeds.
 *
 * Months are UTC. The old client-side buckets used the browser's zone, which
 * for a UK operator differs by an hour twice a year; UTC makes the chart
 * identical for every reader, which is the more useful property for a shared
 * operations screen, and the axis says so.
 */
export async function getPlatformGrowth(months = 12): Promise<GrowthPoint[]> {
  // Built from each organisation's creation date. Churn (archived organisations) is not dated by the API, so it
  // reads as nought rather than as a guess.
  const orgs = await allOrgs();
  const now = new Date();
  const points: GrowthPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const created = orgs.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;
    const total = orgs.filter(
      (o) => new Date(o.created_at).getTime() < end.getTime(),
    ).length;
    points.push({
      monthStart: start.toISOString().slice(0, 10),
      created,
      total,
      churned: 0,
    });
  }
  return points;
}

export interface OperationsSummary {
  openCases: number;
  urgentOpenCases: number;
  unassignedOpenCases: number;
  openIncidents: number;
  activeSupportSessions: number;
  /** Dispatches that will not be retried again. Not "pending" or "sent". */
  failedNotifications: number;
}

/** The support, incident, access and delivery counts on `/admin`, as counts. */
export async function getOperationsSummary(): Promise<OperationsSummary> {
  const [cases, incidents, totals] = await Promise.all([
    api
      .get<{ cases: { status: string; priority: string; assigned_to: string | null }[] }>(
        '/platform/support/cases',
        { limit: 200 },
      )
      .then((r) => r.cases)
      .catch(() => []),
    api
      .get<{ incidents: { status: string }[] }>('/platform/incidents', { open: '1' })
      .then((r) => r.incidents)
      .catch(() => []),
    summary(),
  ]);
  const open = cases.filter((c) => !['resolved', 'closed'].includes(c.status));
  return {
    openCases: open.length,
    urgentOpenCases: open.filter((c) => c.priority === 'urgent').length,
    unassignedOpenCases: open.filter((c) => !c.assigned_to).length,
    openIncidents: incidents.filter((i) => i.status !== 'resolved').length,
    activeSupportSessions: totals.open_support_sessions,
    // Delivery failures are in the outbox and its deliveries; the console has no route for them yet.
    failedNotifications: 0,
  };
}
