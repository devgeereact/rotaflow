import { supabase } from '@/lib/supabase';
import type { AuditLog, Profile } from '@/types';

/**
 * Per-account reads for `/admin/users/:userId`.
 *
 * These work because 0015 widened `profiles_select_own` to admit platform
 * administrators. Before that migration this whole file would return one row
 * or none — which is exactly the defect `/admin/users` shipped with.
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

/**
 * What this account has done, across every tenant.
 *
 * Cross-tenant by design — the question a platform administrator brings to
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
