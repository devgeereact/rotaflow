import { supabase } from '@/lib/supabase';
import type { AuditLog, Profile } from '@/types';

/**
 * Per-account reads for `/admin/users/:userId`.
 *
 * These work because 0015 widened `profiles_select_own` to admit platform
 * administrators. Before that migration this whole file would return one row
 * or none, which is exactly the defect `/admin/users` shipped with.
 */

export async function getProfileById(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface UserMembershipRow {
  orgId: string;
  orgName: string;
  orgStatus: string;
  role: string;
  status: string;
  joinedAt: string;
}

/** Every organisation this account belongs to, and as what. */
export async function listUserMemberships(userId: string): Promise<UserMembershipRow[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('org_id, role, status, created_at, organisation:organisations(name, status)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const org = row.organisation as { name: string; status: string } | null;
    return {
      orgId: row.org_id,
      orgName: org?.name ?? 'Unknown organisation',
      orgStatus: org?.status ?? 'active',
      role: row.role,
      status: row.status,
      joinedAt: row.created_at,
    };
  });
}

export interface UserMembershipSummary {
  /** Organisations this account belongs to, active or otherwise. */
  organisations: number;
  /** One organisation's name when there is exactly one, for the list column. */
  soleOrgName: string | null;
  /** Distinct organisation roles held, e.g. `['owner', 'staff']`. */
  roles: string[];
  /** True when at least one membership is active. */
  active: boolean;
}

/**
 * Membership summaries for every account, keyed by user.
 *
 * One query for the whole table rather than one per row: the users list shows
 * an organisation column for every account on the deployment, and doing that
 * per row is the N+1 that makes a forty-account page take forty round trips.
 *
 * Readable cross-tenant for the same reason the rest of the console is,
 * `memberships` select policy admits `is_platform_admin()`. A non-administrator
 * calling this gets their own rows, which is harmless rather than misleading:
 * the screen it feeds is behind the platform route guard.
 */
export async function summariseMembershipsByUser(): Promise<
  Map<string, UserMembershipSummary>
> {
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, role, status, organisation:organisations(name)');
  if (error) throw error;

  const byUser = new Map<string, UserMembershipSummary & { names: Set<string> }>();
  for (const row of data ?? []) {
    const org = row.organisation as { name: string } | null;
    const entry = byUser.get(row.user_id) ?? {
      organisations: 0,
      soleOrgName: null,
      roles: [],
      active: false,
      names: new Set<string>(),
    };
    entry.organisations += 1;
    if (org?.name) entry.names.add(org.name);
    if (!entry.roles.includes(row.role)) entry.roles.push(row.role);
    if (row.status === 'active') entry.active = true;
    byUser.set(row.user_id, entry);
  }

  const out = new Map<string, UserMembershipSummary>();
  for (const [userId, entry] of byUser) {
    const [only] = [...entry.names];
    out.set(userId, {
      organisations: entry.organisations,
      soleOrgName: entry.names.size === 1 ? (only ?? null) : null,
      roles: entry.roles.sort(),
      active: entry.active,
    });
  }
  return out;
}

/**
 * What this account has done, across every tenant.
 *
 * Cross-tenant by design. The question a platform administrator brings to
 * this screen is "what has this person been doing", and scoping it to one
 * organisation would answer a different one. Only a platform administrator can
 * run it: the read policy admits other readers to their *own* actions only.
 */
export async function listUserAuditLogs(
  userId: string,
  limit = 100,
): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('actor_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
