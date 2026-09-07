import { supabase } from '@/lib/supabase';
import { clampPageSize, fetchAllPages, offsetFor, serverPage } from '@/lib/serverPage';
import type { FetchAllResult, ServerPage } from '@/lib/serverPage';
import type { HealthBand } from '@/lib/tenantHealth';

/**
 * The platform organisations directory, paged and counted by the database.
 *
 * ## Why this replaces four reads with one
 *
 * `platformService.listAllOrganisations()` and friends select whole tables and
 * let the browser filter, sort, count and export the array that came back.
 * PostgREST truncates that array at `db.max_rows` without saying so, and every
 * number on the screen is derived from it — so past the cap the total is the
 * cap, a search for an older tenant reports "no matches", and Export CSV
 * writes the loaded page under the name of the whole set.
 *
 * `platform_organisation_directory` (0130) applies the same predicates to the
 * count and to the page, so `total` here is the number of rows that matched,
 * not the number that arrived. Those older functions are still used by screens
 * that genuinely want the estate in memory (the Overview's growth chart), and
 * are left alone; this is the contract for anything that lists.
 */

export type OrganisationHealth = HealthBand;

export interface OrganisationDirectoryRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** The billed plan where a subscription exists, else the organisation's own. */
  plan: string;
  industry: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  country: string;
  timezone: string;
  isDemo: boolean;
  createdAt: string;
  lastActivityAt: string | null;
  onboardingCompletedAt: string | null;
  supportAccessAllowed: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  /** `null` when the tenant has never had a subscription row. Not "none". */
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  subscriptionCurrency: string | null;
  subscriptionPricePence: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** Active login accounts. A different population from `staffActive`. */
  members: number;
  /** Active staff profiles — the population `plans.seat_limit` is enforced on. */
  staffActive: number;
  locations: number;
  ownerEmail: string | null;
  ownerName: string | null;
  /**
   * False for a role that may not read owner contact (finance, per 0122).
   *
   * The screen must render that differently from a null owner. "No owner
   * recorded" and "your role cannot see the owner" are different facts and
   * only one of them is a problem with the tenant.
   */
  ownerContactVisible: boolean;
  health: OrganisationHealth;
}

export interface OrganisationDirectoryQuery {
  search?: string;
  status?: readonly string[];
  plan?: readonly string[];
  subscriptionStatus?: readonly string[];
  industry?: readonly string[];
  health?: readonly string[];
  /** ISO instants. `createdTo` is exclusive, so a whole day is [day, day+1). */
  createdFrom?: string | null;
  createdTo?: string | null;
  sort?: string;
  direction?: 'asc' | 'desc';
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

/** The sort keys 0130 recognises. Anything else falls back to `created_at`. */
export const ORGANISATION_SORT_KEYS = [
  'name',
  'status',
  'plan',
  'subscription_status',
  'industry',
  'members',
  'staff_active',
  'locations',
  'last_activity_at',
  'health',
  'created_at',
] as const;

export type OrganisationSortKey = (typeof ORGANISATION_SORT_KEYS)[number];

interface DirectoryRpcRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  industry: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country: string;
  timezone: string;
  is_demo: boolean;
  created_at: string;
  last_activity_at: string | null;
  onboarding_completed_at: string | null;
  support_access_allowed: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_currency: string | null;
  subscription_price_pence: number | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  members: number;
  staff_active: number;
  locations: number;
  owner_email: string | null;
  owner_name: string | null;
  owner_contact_visible: boolean;
  health: string;
  total_count: number;
}

const HEALTH_BANDS: readonly OrganisationHealth[] = [
  'healthy',
  'attention',
  'at_risk',
  'suspended',
  'archived',
];

/**
 * Map one row, defending against a band the client does not know.
 *
 * A future migration could add one. Falling back to `at_risk` rather than
 * `healthy` keeps the module's own rule: unrecognised is not well.
 */
function toRow(row: DirectoryRpcRow): OrganisationDirectoryRow {
  const health = HEALTH_BANDS.includes(row.health as OrganisationHealth)
    ? (row.health as OrganisationHealth)
    : 'at_risk';
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    plan: row.plan,
    industry: row.industry,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    country: row.country,
    timezone: row.timezone,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    onboardingCompletedAt: row.onboarding_completed_at,
    supportAccessAllowed: row.support_access_allowed,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
    subscriptionStatus: row.subscription_status,
    subscriptionPlan: row.subscription_plan,
    subscriptionCurrency: row.subscription_currency,
    subscriptionPricePence: row.subscription_price_pence,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    members: Number(row.members ?? 0),
    staffActive: Number(row.staff_active ?? 0),
    locations: Number(row.locations ?? 0),
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    ownerContactVisible: row.owner_contact_visible,
    health,
  };
}

/**
 * An empty array is not zero matches.
 *
 * The RPC returns `total_count` on every row, so a page with no rows carries
 * no total at all. That is only ever true when the offset is past the end or
 * nothing matched, and both are `0` — but it is worth saying out loud, because
 * reading a total off row zero of an empty array is how a count becomes
 * `undefined` and then, after a `?? 0`, a confident lie.
 */
function totalFrom(rows: readonly DirectoryRpcRow[]): number {
  return rows.length === 0 ? 0 : Number(rows[0]?.total_count ?? 0);
}

interface DirectoryRpcArgs {
  p_search?: string;
  p_status?: string[];
  p_plan?: string[];
  p_subscription_status?: string[];
  p_industry?: string[];
  p_health?: string[];
  p_created_from?: string;
  p_created_to?: string;
  p_sort: string;
  p_direction: string;
  p_limit: number;
  p_offset: number;
}

function args(
  query: OrganisationDirectoryQuery,
  limit: number,
  offset: number,
): DirectoryRpcArgs {
  const list = (values: readonly string[] | undefined): string[] | undefined =>
    values && values.length > 0 ? [...values] : undefined;
  return {
    p_search: query.search?.trim() ? query.search.trim() : undefined,
    p_status: list(query.status),
    p_plan: list(query.plan),
    p_subscription_status: list(query.subscriptionStatus),
    p_industry: list(query.industry),
    p_health: list(query.health),
    p_created_from: query.createdFrom ?? undefined,
    p_created_to: query.createdTo ?? undefined,
    p_sort: query.sort ?? 'created_at',
    p_direction: query.direction ?? 'desc',
    p_limit: limit,
    p_offset: offset,
  };
}

/** One page of the directory, with the total for the whole matching set. */
export async function listOrganisationDirectory(
  query: OrganisationDirectoryQuery = {},
): Promise<ServerPage<OrganisationDirectoryRow>> {
  const pageSize = clampPageSize(query.pageSize);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const { data, error } = await supabase.rpc(
    'platform_organisation_directory',
    args(query, pageSize, offsetFor(page, pageSize)),
  );
  if (error) throw error;

  const rpcRows = (data ?? []) as unknown as DirectoryRpcRow[];
  return serverPage({
    rows: rpcRows.map(toRow),
    total: totalFrom(rpcRows),
    page,
    pageSize,
  });
}

/**
 * Every row matching the filters, for an export.
 *
 * Same predicates as the page above, walked to exhaustion. `truncated` is the
 * caller's responsibility to surface: a file named "all matching
 * organisations" that holds the first 10,000 of 12,000 has to say so on the
 * screen that produced it.
 */
export async function listOrganisationDirectoryAll(
  query: OrganisationDirectoryQuery = {},
): Promise<FetchAllResult<OrganisationDirectoryRow>> {
  return fetchAllPages<OrganisationDirectoryRow>(async (offset, limit) => {
    const { data, error } = await supabase.rpc(
      'platform_organisation_directory',
      args(query, limit, offset),
    );
    if (error) throw error;
    const rpcRows = (data ?? []) as unknown as DirectoryRpcRow[];
    return { rows: rpcRows.map(toRow), total: totalFrom(rpcRows) };
  });
}

export interface OrganisationFacets {
  total: number;
  active: number;
  suspended: number;
  archived: number;
  newThisMonth: number;
  newLastMonth: number;
  trialing: number;
  pastDue: number;
  healthy: number;
  attention: number;
  atRisk: number;
  archivedBand: number;
  /** Tenants that did something in the last 24 hours. Tenants, not people. */
  active24h: number;
  /** Distinct values across the estate, for the filter selects. */
  plans: string[];
  industries: string[];
  subscriptionStatuses: string[];
}

/**
 * Estate-wide counts and the values the filters offer.
 *
 * Deliberately not scoped to the current filter: these tiles describe the
 * deployment. Building the option lists here rather than from the loaded page
 * is the other half of the same fix — a plan only older tenants hold was never
 * offered when the list came from the first page of rows.
 */
export async function getOrganisationFacets(): Promise<OrganisationFacets> {
  const { data, error } = await supabase.rpc('platform_organisation_facets');
  if (error) throw error;
  const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
  const num = (key: string): number => Number(row?.[key] ?? 0);
  const arr = (key: string): string[] =>
    Array.isArray(row?.[key]) ? (row[key] as string[]).filter(Boolean).sort() : [];
  return {
    total: num('total'),
    active: num('active'),
    suspended: num('suspended'),
    archived: num('archived'),
    newThisMonth: num('new_this_month'),
    newLastMonth: num('new_last_month'),
    trialing: num('trialing'),
    pastDue: num('past_due'),
    healthy: num('healthy'),
    attention: num('attention'),
    atRisk: num('at_risk'),
    archivedBand: num('archived_band'),
    active24h: num('active_24h'),
    plans: arr('plans'),
    industries: arr('industries'),
    subscriptionStatuses: arr('subscription_statuses'),
  };
}

/* ------------------------------------------------------------------ */
/* The user directory                                                  */
/* ------------------------------------------------------------------ */

export interface UserDirectoryRow {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  /** The live grant only; a revoked row is not reported as a role. */
  platformRole: string | null;
  createdAt: string;
  /** Memberships of any status. */
  organisations: number;
  /** Of those, the ones that are active. A different and smaller number. */
  activeMemberships: number;
  orgIds: string[];
  orgNames: string[];
  roles: string[];
  membershipStatuses: string[];
}

export interface UserDirectoryQuery {
  search?: string;
  orgIds?: readonly string[];
  roles?: readonly string[];
  membershipStatus?: readonly string[];
  /** `'platform'` or `'standard'`. Anything else is treated as no filter. */
  platformAccess?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const USER_SORT_KEYS = [
  'name',
  'email',
  'organisations',
  'access',
  'created_at',
] as const;

interface UserRpcRow {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_platform_admin: boolean;
  platform_role: string | null;
  created_at: string;
  organisations: number;
  active_memberships: number;
  org_ids: string[];
  org_names: string[];
  roles: string[];
  membership_statuses: string[];
  total_count: number;
}

function toUserRow(row: UserRpcRow): UserDirectoryRow {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    isPlatformAdmin: row.is_platform_admin,
    platformRole: row.platform_role,
    createdAt: row.created_at,
    organisations: Number(row.organisations ?? 0),
    activeMemberships: Number(row.active_memberships ?? 0),
    orgIds: row.org_ids ?? [],
    orgNames: row.org_names ?? [],
    roles: row.roles ?? [],
    membershipStatuses: row.membership_statuses ?? [],
  };
}

interface UserRpcArgs {
  p_search?: string;
  p_org?: string[];
  p_role?: string[];
  p_membership_status?: string[];
  p_platform_access?: string;
  p_sort: string;
  p_direction: string;
  p_limit: number;
  p_offset: number;
}

function userArgs(query: UserDirectoryQuery, limit: number, offset: number): UserRpcArgs {
  const list = (values: readonly string[] | undefined): string[] | undefined =>
    values && values.length > 0 ? [...values] : undefined;
  return {
    p_search: query.search?.trim() ? query.search.trim() : undefined,
    p_org: list(query.orgIds),
    p_role: list(query.roles),
    p_membership_status: list(query.membershipStatus),
    p_platform_access:
      query.platformAccess === 'platform' || query.platformAccess === 'standard'
        ? query.platformAccess
        : undefined,
    p_sort: query.sort ?? 'created_at',
    p_direction: query.direction ?? 'desc',
    p_limit: limit,
    p_offset: offset,
  };
}

/**
 * One page of the platform user directory.
 *
 * Search covers every organisation an account belongs to (0131). The screen
 * used to search `soleOrgName`, which the summary set only for accounts in
 * exactly one organisation — so searching by organisation could not find a
 * multi-organisation account, which is the kind a support case is most often
 * about.
 */
export async function listUserDirectory(
  query: UserDirectoryQuery = {},
): Promise<ServerPage<UserDirectoryRow>> {
  const pageSize = clampPageSize(query.pageSize);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const { data, error } = await supabase.rpc(
    'platform_user_directory',
    userArgs(query, pageSize, offsetFor(page, pageSize)),
  );
  if (error) throw error;

  const rpcRows = (data ?? []) as unknown as UserRpcRow[];
  return serverPage({
    rows: rpcRows.map(toUserRow),
    total: rpcRows.length === 0 ? 0 : Number(rpcRows[0]?.total_count ?? 0),
    page,
    pageSize,
  });
}

/** Every account matching the filters, for an export. Same predicates. */
export async function listUserDirectoryAll(
  query: UserDirectoryQuery = {},
): Promise<FetchAllResult<UserDirectoryRow>> {
  return fetchAllPages<UserDirectoryRow>(async (offset, limit) => {
    const { data, error } = await supabase.rpc(
      'platform_user_directory',
      userArgs(query, limit, offset),
    );
    if (error) throw error;
    const rpcRows = (data ?? []) as unknown as UserRpcRow[];
    return {
      rows: rpcRows.map(toUserRow),
      total: rpcRows.length === 0 ? 0 : Number(rpcRows[0]?.total_count ?? 0),
    };
  });
}

export interface UserFacets {
  total: number;
  withMembership: number;
  unattached: number;
  multiOrg: number;
  platformAdmins: number;
  /** Belongs to an organisation but is active in none. */
  suspendedOnly: number;
  roles: string[];
}

export async function getUserFacets(): Promise<UserFacets> {
  const { data, error } = await supabase.rpc('platform_user_facets');
  if (error) throw error;
  const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
  const num = (key: string): number => Number(row?.[key] ?? 0);
  return {
    total: num('total'),
    withMembership: num('with_membership'),
    unattached: num('unattached'),
    multiOrg: num('multi_org'),
    platformAdmins: num('platform_admins'),
    suspendedOnly: num('suspended_only'),
    roles: Array.isArray(row?.roles) ? (row.roles as string[]).filter(Boolean) : [],
  };
}
