import { supabase } from '@/lib/supabase';
import type {
  AuditLog,
  Department,
  Location,
  Organisation,
  OrganisationStatus,
  Subscription,
} from '@/types';

/**
 * Per-tenant reads for `/admin/organisations/:organisationId`.
 *
 * Same posture as `platformService`: plain client queries, because
 * `is_platform_admin()` is folded into `is_org_member`/`has_org_role` in 0002
 * and already grants cross-tenant read. For anyone who is not a platform
 * administrator every read here returns empty rather than raising. RLS filters
 * rows, it does not error.
 *
 * The writes are the opposite and go through RPCs that raise, because a refused
 * write must never look like a successful one.
 */

/** One tenant, or null when the id does not resolve. */
export async function getOrganisation(orgId: string): Promise<Organisation | null> {
  const { data, error } = await supabase
    .from('organisations')
    .select('*')
    .eq('id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface OrgMemberRow {
  userId: string;
  role: string;
  status: string;
  joinedAt: string;
  fullName: string | null;
  email: string | null;
}

/**
 * Everyone with a membership in this organisation.
 *
 * The profile join resolves for a platform administrator because 0015 widened
 * `profiles_select_own` to admit them. For anyone else it returns nulls, which
 * is correct, and why this is a platform-console service rather than something
 * the tenant app shares.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, role, status, created_at, profile:profiles(full_name, email)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const profile = row.profile as { full_name: string | null; email: string } | null;
    return {
      userId: row.user_id,
      role: row.role,
      status: row.status,
      joinedAt: row.created_at,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
    };
  });
}

export async function listOrgLocations(orgId: string): Promise<Location[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listOrgDepartments(orgId: string): Promise<Department[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getOrgSubscription(orgId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** This tenant's audit trail, newest first. Capped for the same reason as the platform view. */
export async function listOrgAuditLogs(orgId: string, limit = 100): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export interface OrgUsage {
  staff: number;
  activeStaff: number;
  locations: number;
  departments: number;
  publishedRotas: number;
  shiftsThisMonth: number;
}

/**
 * Counts for the usage tab.
 *
 * Uses PostgREST's `head`+`count: 'exact'` so no rows cross the wire. This is
 * a page of numbers, and pulling every shift in a tenant to call `.length` on
 * it would be the same figure at a hundred times the cost.
 *
 * There are no limits to compare these against: no plan carries a seat or
 * location cap anywhere in the schema, so the tab reports usage and says
 * plainly that nothing enforces a ceiling, rather than inventing one.
 */
export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  // One SECURITY DEFINER call rather than six head-count queries.
  //
  // Since 0028 a platform administrator reads tenant rows only through an
  // active support access session, so counting by selecting from
  // `staff_profiles` would return zero for every organisation nobody currently
  // has a session on. `platform_tenant_counts` counts past RLS and returns
  // numbers rather than rows: how large a tenant is, without who is in it.
  const { data, error } = await supabase.rpc('platform_tenant_counts', {
    p_org: orgId,
  });
  if (error) throw error;

  const row = (data ?? [])[0];
  return {
    staff: Number(row?.staff_total ?? 0),
    activeStaff: Number(row?.staff_active ?? 0),
    locations: Number(row?.locations ?? 0),
    departments: Number(row?.departments ?? 0),
    publishedRotas: Number(row?.published_rotas ?? 0),
    shiftsThisMonth: Number(row?.shifts_month ?? 0),
  };
}

/**
 * Suspend, archive or reactivate a tenant.
 *
 * **This is a billing and account state, not a lockout.** No RLS policy reads
 * `organisations.status`, so a suspended organisation's staff keep signing in
 * and clocking in. Enforcing it means a check inside `is_org_member()`, which
 * every policy in 0002 depends on. See the header of 0017. Any screen calling
 * this must say what it does and does not do.
 *
 * The reason is required by the database for anything other than reactivation,
 * and lands in the audit trail where the customer's own owner can read it.
 */
export async function setOrgStatus(
  orgId: string,
  status: OrganisationStatus,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_org_status', {
    p_org: orgId,
    p_status: status,
    p_reason: reason ?? undefined,
  });
  if (error) throw error;
}

/** Record whether this customer permits platform support to open their data. */
export async function setOrgSupportAccess(
  orgId: string,
  allowed: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_org_support_access', {
    p_org: orgId,
    p_allowed: allowed,
  });
  if (error) throw error;
}
