import { api, isApiCode, orgPath } from '@/lib/api';
import type {
  AuditLog,
  Department,
  Location,
  Organisation,
  OrganisationStatus,
  Subscription,
} from '@/types';

/**
 * One tenant as the platform console sees it (`/platform/orgs/{o}` and its structure). Platform staff read
 * names, sites and counts; never staff records, pay or contact details.
 */

const p = (orgId: string): string => `/platform/orgs/${encodeURIComponent(orgId)}`;

interface ApiOrgDetail {
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
  billing_state: string;
  members: number;
  active_staff: number;
  locations: number;
  departments: number;
  shifts: number;
  invoices: number;
}

interface ApiStructure {
  members: {
    user_id: string;
    role: string;
    status: string;
    created_at: string;
    full_name: string | null;
    email: string | null;
  }[];
  locations: Omit<Location, 'org_id'>[];
  departments: Omit<Department, 'org_id'>[];
  counts: { staff_total: number; published_rotas: number; shifts_month: number };
}

async function detail(orgId: string): Promise<ApiOrgDetail | null> {
  try {
    return (await api.get<{ organisation: ApiOrgDetail }>(p(orgId))).organisation;
  } catch (error) {
    if (isApiCode(error, 'not_found')) return null;
    throw error;
  }
}

async function structure(orgId: string): Promise<ApiStructure> {
  return api.get<ApiStructure>(`${p(orgId)}/structure`);
}

export async function getOrganisation(orgId: string): Promise<Organisation | null> {
  const o = await detail(orgId);
  if (!o) return null;
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

export interface OrgMemberRow {
  userId: string;
  role: string;
  status: string;
  joinedAt: string;
  fullName: string | null;
  email: string | null;
}

export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  return (await structure(orgId)).members.map((m) => ({
    userId: m.user_id,
    role: m.role,
    status: m.status,
    joinedAt: m.created_at,
    fullName: m.full_name,
    email: m.email,
  }));
}

export async function listOrgLocations(orgId: string): Promise<Location[]> {
  return (await structure(orgId)).locations.map((l) => ({ ...l, org_id: orgId }));
}

export async function listOrgDepartments(orgId: string): Promise<Department[]> {
  return (await structure(orgId)).departments.map((d) => ({ ...d, org_id: orgId }));
}

export async function getOrgSubscription(orgId: string): Promise<Subscription | null> {
  const o = await detail(orgId);
  if (!o?.sub_status) return null;
  return {
    id: orgId,
    org_id: orgId,
    plan: o.plan,
    status: o.sub_status,
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
  };
}

export interface OrgAuditPage {
  rows: AuditLog[];
  total: number;
}

export async function listOrgAuditLogs(
  orgId: string,
  limit = 100,
): Promise<OrgAuditPage> {
  const r = await api.get<{
    entries: (AuditLog & { id: string | number })[];
    total: number;
  }>('/platform/audit', { scope: orgId, limit: Math.min(200, limit) });
  return { rows: r.entries.map((e) => ({ ...e, id: String(e.id) })), total: r.total };
}

export interface OrgUsage {
  staff: number;
  activeStaff: number;
  locations: number;
  departments: number;
  publishedRotas: number;
  shiftsThisMonth: number;
}

export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const [o, s] = await Promise.all([detail(orgId), structure(orgId)]);
  return {
    staff: s.counts.staff_total,
    activeStaff: o?.active_staff ?? 0,
    locations: o?.locations ?? s.locations.length,
    departments: o?.departments ?? s.departments.length,
    publishedRotas: s.counts.published_rotas,
    shiftsThisMonth: s.counts.shifts_month,
  };
}

/** Suspend or reinstate (owner, admin, finance). Archiving is the deletion flow, not a status change. */
export async function setOrgStatus(
  orgId: string,
  status: OrganisationStatus,
  reason?: string,
): Promise<void> {
  await api.post(`${p(orgId)}/status`, { status, reason: reason ?? null });
}

/** The organisation's owner allows or refuses platform support access; refusing ends every open session. */
export async function setOrgSupportAccess(
  orgId: string,
  allowed: boolean,
): Promise<void> {
  await api.post(orgPath(orgId, '/support-access'), { allowed });
}
