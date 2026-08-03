import { supabase } from '@/lib/supabase';
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
 * for a non-admin is therefore doing exactly the right thing — and
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

/** Flip a platform-admin flag. Guarded by RLS on `profiles`. */
export async function setPlatformAdmin(
  userId: string,
  isPlatformAdmin: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ is_platform_admin: isPlatformAdmin })
    .eq('id', userId);
  if (error) throw error;
}
