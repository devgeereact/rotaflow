import { supabase } from '@/lib/supabase';
import { grantPlatformRole, revokePlatformRole } from '@/services/platformRoleService';
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
 * Reads one column and tallies client-side, exactly as `countMembershipsByOrg`
 * does, because PostgREST has no GROUP BY. That is affordable here, a location
 * is a building, so the row count is small even across a large deployment, and
 * it is not affordable for shifts, which is why there is no equivalent for
 * those.
 *
 * Visible cross-tenant because `locations_select` uses `is_org_member(org_id)`,
 * and `is_org_member` ends in `or public.is_platform_admin()`. Nothing extra is
 * granted here; a non-administrator calling this gets only their own.
 */
export async function countLocationsByOrg(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('locations').select('org_id');
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.org_id, (counts.get(row.org_id) ?? 0) + 1);
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
