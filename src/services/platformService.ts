import { supabase } from '@/lib/supabase';
import { buildAcceptUrl } from '@/services/inviteService';
import { grantPlatformRole, revokePlatformRole } from '@/services/platformRoleService';
import { escapeLikePattern, escapeOrValue } from '@/lib/filters';
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
export async function listAllOrganisations(): Promise<Organisation[]> {
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Every account with a RotaFlow profile. */
export async function listAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAllSubscriptions(): Promise<Subscription[]> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Platform-wide audit trail.
 *
 * Capped rather than paginated: `audit_logs` grows without bound and this
 * screen is a recent-activity view, not an archive. The limit is passed in so
 * the caller owns the trade-off, and the screen says what it is showing.
 */
export async function listPlatformAuditLogs(limit = 200): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
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
  const { data, error } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('status', 'active');
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.org_id, (counts.get(row.org_id) ?? 0) + 1);
  }
  return counts;
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
  const { data, error } = await supabase.rpc('platform_location_counts');
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.org_id, Number(row.locations));
  }
  return counts;
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
  const { data, error } = await supabase.rpc('platform_staff_counts');
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.org_id, Number(row.staff_active));
  }
  return counts;
}

/** Published rotas across every tenant. The platform-wide total. */
export async function countPublishedRotas(): Promise<number> {
  // Through the definer function, not a head count on `rotas`. Since 0028 a
  // platform administrator cannot select tenant rows without a support access
  // session, so counting directly would report zero published rotas across the
  // entire estate whenever nobody happens to be in a support session.
  const { data, error } = await supabase.rpc('platform_totals');
  if (error) throw error;
  return Number((data ?? [])[0]?.published_rotas ?? 0);
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
  const { data, error } = await supabase.rpc('platform_totals');
  if (error) throw error;
  const row = (data ?? [])[0];
  return {
    organisations: Number(row?.organisations ?? 0),
    activeOrgs: Number(row?.active_orgs ?? 0),
    profiles: Number(row?.profiles ?? 0),
    staffProfiles: Number(row?.staff_profiles ?? 0),
    publishedRotas: Number(row?.published_rotas ?? 0),
    shiftsThisMonth: Number(row?.shifts_month ?? 0),
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
  const { data, error } = await supabase.rpc('admin_create_organisation_with_invite', {
    p_name: input.name,
    p_slug: input.slug,
    p_plan: input.plan,
    p_owner_email: input.ownerEmail,
    p_price_pence: input.pricePence ?? undefined,
  });
  if (error) throw error;

  const row = data?.[0];
  if (!row) throw new Error('The organisation could not be created.');

  return {
    orgId: row.org_id,
    inviteId: row.invite_id,
    inviteToken: row.invite_token,
    inviteExpiresAt: row.invite_expires_at,
    acceptUrl: buildAcceptUrl(row.invite_token),
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
  const from = (page - 1) * pageSize;

  let request = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    // The tie-break. `created_at` is not unique — a transaction writing two
    // rows stamps both identically — so without a second key the two are free
    // to swap between pages and one gets read twice.
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1);

  if (query.scope === 'platform') request = request.eq('scope', 'platform');
  else if (query.scope && query.scope !== 'all')
    request = request.eq('org_id', query.scope);

  if (query.severity && query.severity.length > 0) {
    request = request.in('severity', [...query.severity]);
  }
  if (query.action && query.action.length > 0) {
    request = request.in('action', [...query.action]);
  }
  if (query.from) request = request.gte('created_at', query.from);
  if (query.to) request = request.lt('created_at', query.to);

  const term = query.search?.trim();
  if (term) {
    // `escapeLikePattern` first, so a `%` in the term is a percent sign
    // rather than "everything"; `escapeOrValue` second, because the `or=(…)`
    // list is comma-separated and parenthesised, and an unquoted comma in a
    // search term changes the shape of the filter rather than its content.
    const pattern = escapeOrValue(`%${escapeLikePattern(term)}%`);
    request = request.or(
      [
        `action.ilike.${pattern}`,
        `entity_type.ilike.${pattern}`,
        `actor_name.ilike.${pattern}`,
        `actor_email.ilike.${pattern}`,
      ].join(','),
    );
  }

  const { data, error, count } = await request;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? data?.length ?? 0 };
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
  const unique = [...new Set(slugs.filter((s) => s !== ''))];
  const found: string[] = [];

  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data, error } = await supabase
      .from('organisations')
      .select('slug')
      .in('slug', chunk);
    if (error) throw error;
    found.push(...(data ?? []).map((row) => row.slug));
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
  const { data, error } = await supabase.rpc('platform_growth', { p_months: months });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    monthStart: String(row.month_start),
    created: Number(row.created ?? 0),
    total: Number(row.total ?? 0),
    churned: Number(row.churned ?? 0),
  }));
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
  const { data, error } = await supabase.rpc('platform_operations_summary');
  if (error) throw error;
  const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
  const num = (key: string): number => Number(row?.[key] ?? 0);
  return {
    openCases: num('open_cases'),
    urgentOpenCases: num('urgent_open_cases'),
    unassignedOpenCases: num('unassigned_open_cases'),
    openIncidents: num('open_incidents'),
    activeSupportSessions: num('active_support_sessions'),
    failedNotifications: num('failed_notifications'),
  };
}
