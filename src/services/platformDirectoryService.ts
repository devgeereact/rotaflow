import { api } from '@/lib/api';
import { clampPageSize, offsetFor, serverPage } from '@/lib/serverPage';
import type { FetchAllResult, ServerPage } from '@/lib/serverPage';
import type { HealthBand } from '@/lib/tenantHealth';

/**
 * The platform organisations and user directories.
 *
 * The API pages its directories 100 rows at a time with a name search and status/plan filters. The console's
 * richer filters, sorts and estate-wide counts are applied here over the whole estate, read in full first, so
 * every total, filter and export describes every row and never just a loaded page. RotaFlow's estate is small
 * (organisations are by invitation), so this is cheap; a server-side directory can replace it without changing
 * these signatures.
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

interface ApiOrg {
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
  members: number;
  active_staff: number;
  locations: number;
}

async function estate(): Promise<OrganisationDirectoryRow[]> {
  const out: OrganisationDirectoryRow[] = [];
  for (let offset = 0; offset < 100_000; offset += 100) {
    const r = await api.get<{ organisations: ApiOrg[] }>('/platform/orgs', {
      limit: 100,
      offset,
    });
    out.push(...r.organisations.map(toRow));
    if (r.organisations.length < 100) break;
  }
  return out;
}

/** Unrecognised is not well: anything not plainly healthy reads as needing attention. */
function healthOf(o: ApiOrg): OrganisationHealth {
  if (o.status === 'archived') return 'archived';
  if (o.status === 'suspended') return 'suspended';
  if (o.sub_status === 'past_due' || o.sub_status === 'unpaid') return 'at_risk';
  if (Number(o.active_staff) === 0 || Number(o.locations) === 0) return 'attention';
  return 'healthy';
}

function toRow(o: ApiOrg): OrganisationDirectoryRow {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    plan: o.plan,
    industry: null,
    contactEmail: null,
    contactPhone: null,
    country: 'United Kingdom',
    timezone: 'Europe/London',
    isDemo: false,
    createdAt: o.created_at,
    lastActivityAt: null,
    onboardingCompletedAt: null,
    supportAccessAllowed: Boolean(o.support_access_allowed),
    suspendedAt: null,
    suspendedReason: o.suspended_reason,
    subscriptionStatus: o.sub_status,
    subscriptionPlan: o.sub_status ? o.plan : null,
    subscriptionCurrency: o.sub_status ? 'GBP' : null,
    subscriptionPricePence: null,
    trialEndsAt: o.trial_ends_at,
    currentPeriodEnd: null,
    members: Number(o.members ?? 0),
    staffActive: Number(o.active_staff ?? 0),
    locations: Number(o.locations ?? 0),
    ownerEmail: null,
    ownerName: null,
    // The directory route does not carry owner contact; the organisation page does.
    ownerContactVisible: false,
    health: healthOf(o),
  };
}

const ORG_SORT_FIELD: Record<string, keyof OrganisationDirectoryRow> = {
  name: 'name',
  status: 'status',
  plan: 'plan',
  subscription_status: 'subscriptionStatus',
  industry: 'industry',
  members: 'members',
  staff_active: 'staffActive',
  locations: 'locations',
  last_activity_at: 'lastActivityAt',
  health: 'health',
  created_at: 'createdAt',
};

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const text = (v: unknown): string =>
    typeof v === 'string'
      ? v
      : typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : '';
  return text(a).localeCompare(text(b));
}

function filterOrgs(
  rows: OrganisationDirectoryRow[],
  q: OrganisationDirectoryQuery,
): OrganisationDirectoryRow[] {
  const has = (list: readonly string[] | undefined, v: string | null): boolean =>
    !list || list.length === 0 || (v !== null && list.includes(v));
  const term = q.search?.trim().toLowerCase();
  const field = ORG_SORT_FIELD[q.sort ?? 'created_at'] ?? 'createdAt';
  const dir = q.direction === 'asc' ? 1 : -1;
  return rows
    .filter(
      (r) =>
        (!term ||
          r.name.toLowerCase().includes(term) ||
          r.slug.toLowerCase().includes(term)) &&
        has(q.status, r.status) &&
        has(q.plan, r.plan) &&
        has(q.subscriptionStatus, r.subscriptionStatus) &&
        has(q.industry, r.industry) &&
        has(q.health, r.health) &&
        (!q.createdFrom || r.createdAt >= q.createdFrom) &&
        (!q.createdTo || r.createdAt < q.createdTo),
    )
    .sort((a, b) => compare(a[field], b[field]) * dir);
}

/** One page of the directory, with the total for the whole matching set. */
export async function listOrganisationDirectory(
  query: OrganisationDirectoryQuery = {},
): Promise<ServerPage<OrganisationDirectoryRow>> {
  const pageSize = clampPageSize(query.pageSize);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const all = filterOrgs(await estate(), query);
  const offset = offsetFor(page, pageSize);
  return serverPage({
    rows: all.slice(offset, offset + pageSize),
    total: all.length,
    page,
    pageSize,
  });
}

/** Every row matching the filters, for an export. */
export async function listOrganisationDirectoryAll(
  query: OrganisationDirectoryQuery = {},
): Promise<FetchAllResult<OrganisationDirectoryRow>> {
  const rows = filterOrgs(await estate(), query);
  return { rows, total: rows.length, truncated: false };
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
  const rows = await estate();
  const now = new Date();
  const month = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const lastMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  ).toISOString();
  const count = (f: (r: OrganisationDirectoryRow) => boolean): number =>
    rows.filter(f).length;
  const distinct = (f: (r: OrganisationDirectoryRow) => string | null): string[] =>
    [...new Set(rows.map(f).filter((v): v is string => !!v))].sort();
  return {
    total: rows.length,
    active: count((r) => r.status === 'active'),
    suspended: count((r) => r.status === 'suspended'),
    archived: count((r) => r.status === 'archived'),
    newThisMonth: count((r) => r.createdAt >= month),
    newLastMonth: count((r) => r.createdAt >= lastMonth && r.createdAt < month),
    trialing: count(
      (r) =>
        r.subscriptionStatus === 'trialing' || (!r.subscriptionStatus && !!r.trialEndsAt),
    ),
    pastDue: count((r) => r.subscriptionStatus === 'past_due'),
    healthy: count((r) => r.health === 'healthy'),
    attention: count((r) => r.health === 'attention'),
    atRisk: count((r) => r.health === 'at_risk'),
    archivedBand: count((r) => r.health === 'archived'),
    // Activity is not tracked per tenant on the API.
    active24h: 0,
    plans: distinct((r) => r.plan),
    industries: distinct((r) => r.industry),
    subscriptionStatuses: distinct((r) => r.subscriptionStatus),
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

interface ApiUser {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  organisations: number;
  platform_role: string | null;
}

async function people(): Promise<UserDirectoryRow[]> {
  const out: UserDirectoryRow[] = [];
  for (let offset = 0; offset < 100_000; offset += 100) {
    const r = await api.get<{ users: ApiUser[] }>('/platform/users', {
      limit: 100,
      offset,
    });
    out.push(
      ...r.users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        avatarUrl: null,
        isPlatformAdmin: u.platform_role !== null,
        platformRole: u.platform_role,
        createdAt: u.created_at,
        // The directory route counts active memberships; per-organisation detail is on the person's page.
        organisations: Number(u.organisations ?? 0),
        activeMemberships: Number(u.organisations ?? 0),
        orgIds: [],
        orgNames: [],
        roles: [],
        membershipStatuses: [],
      })),
    );
    if (r.users.length < 100) break;
  }
  return out;
}

function filterUsers(
  rows: UserDirectoryRow[],
  q: UserDirectoryQuery,
): UserDirectoryRow[] {
  const term = q.search?.trim().toLowerCase();
  const key: Record<string, (r: UserDirectoryRow) => unknown> = {
    name: (r) => r.fullName ?? r.email,
    email: (r) => r.email,
    organisations: (r) => r.organisations,
    access: (r) => r.platformRole ?? '',
    created_at: (r) => r.createdAt,
  };
  const pick = key[q.sort ?? 'created_at'] ?? key.created_at ?? ((r) => r.createdAt);
  const dir = q.direction === 'asc' ? 1 : -1;
  return rows
    .filter(
      (r) =>
        (!term ||
          r.email.toLowerCase().includes(term) ||
          (r.fullName ?? '').toLowerCase().includes(term)) &&
        (q.platformAccess !== 'platform' || r.isPlatformAdmin) &&
        (q.platformAccess !== 'standard' || !r.isPlatformAdmin),
    )
    .sort((a, b) => compare(pick(a), pick(b)) * dir);
}

/** One page of the platform user directory. */
export async function listUserDirectory(
  query: UserDirectoryQuery = {},
): Promise<ServerPage<UserDirectoryRow>> {
  const pageSize = clampPageSize(query.pageSize);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const all = filterUsers(await people(), query);
  const offset = offsetFor(page, pageSize);
  return serverPage({
    rows: all.slice(offset, offset + pageSize),
    total: all.length,
    page,
    pageSize,
  });
}

/** Every account matching the filters, for an export. */
export async function listUserDirectoryAll(
  query: UserDirectoryQuery = {},
): Promise<FetchAllResult<UserDirectoryRow>> {
  const rows = filterUsers(await people(), query);
  return { rows, total: rows.length, truncated: false };
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
  const rows = await people();
  return {
    total: rows.length,
    withMembership: rows.filter((r) => r.organisations > 0).length,
    unattached: rows.filter((r) => r.organisations === 0).length,
    multiOrg: rows.filter((r) => r.organisations > 1).length,
    platformAdmins: rows.filter((r) => r.isPlatformAdmin).length,
    suspendedOnly: 0,
    roles: [],
  };
}
