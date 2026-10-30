import { api, isApiCode } from '@/lib/api';
import type { AuditLog, Profile } from '@/types';

/** One person in the platform console (owner, admin and support). */

interface UserDetail {
  user: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
    created_at: string;
    last_seen_at: string | null;
  };
  memberships: {
    org_id: string;
    org_name: string;
    org_status: string;
    role: string;
    status: string;
    created_at: string;
  }[];
  platform_role: string | null;
}

async function detail(userId: string): Promise<UserDetail | null> {
  try {
    return await api.get<UserDetail>(`/platform/users/${encodeURIComponent(userId)}`);
  } catch (error) {
    if (isApiCode(error, 'not_found')) return null;
    throw error;
  }
}

export async function getProfileById(userId: string): Promise<Profile | null> {
  const d = await detail(userId);
  if (!d) return null;
  return {
    id: d.user.id,
    email: d.user.email,
    full_name: d.user.full_name,
    avatar_url: d.user.avatar_url,
    is_platform_admin: d.platform_role !== null,
    created_at: d.user.created_at,
    updated_at: d.user.last_seen_at ?? d.user.created_at,
  };
}

export interface UserMembershipRow {
  orgId: string;
  orgName: string;
  orgStatus: string;
  role: string;
  status: string;
  joinedAt: string;
}

export async function listUserMemberships(userId: string): Promise<UserMembershipRow[]> {
  const d = await detail(userId);
  return (d?.memberships ?? []).map((row) => ({
    orgId: row.org_id,
    orgName: row.org_name,
    orgStatus: row.org_status,
    role: row.role,
    status: row.status,
    joinedAt: row.created_at,
  }));
}

export async function listUserAuditLogs(
  userId: string,
  limit = 100,
): Promise<AuditLog[]> {
  const r = await api.get<{ entries: (AuditLog & { id: string | number })[] }>(
    '/platform/audit',
    {
      actor: userId,
      limit: Math.min(200, limit),
    },
  );
  return r.entries.map((e) => ({ ...e, id: String(e.id) }));
}
