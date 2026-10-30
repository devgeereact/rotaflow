import { api, ApiError } from '@/lib/api';
import type { MePayload } from '@/context/AuthContext';
import type { PlatformAdmin, PlatformRole } from '@/types';

/**
 * The Super Admin roster (`platform_admins`). Granting and revoking are the platform owner's; the API refuses
 * removing the last owner. Two-step verification for platform staff is enforced by Clerk, not here.
 */

export async function getMyPlatformRole(): Promise<PlatformRole | null> {
  const r = await api.get<MePayload>('/me');
  return (r.platform_role as PlatformRole | null) ?? null;
}

/** May act at platform level at all. With Clerk owning the second factor this is "holds a live grant". */
export async function getPlatformAccess(): Promise<boolean> {
  return (await getMyPlatformRole()) !== null;
}

interface ApiAdmin {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  granted_at: string;
  granted_by: string | null;
  revoked_at: string | null;
  note: string | null;
}

export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  const r = await api.get<{ admins: ApiAdmin[] }>('/platform/admins');
  return r.admins
    .map((a) => ({
      user_id: a.user_id,
      role: a.role,
      granted_at: a.granted_at,
      granted_by: a.granted_by,
      revoked_at: a.revoked_at,
      revoked_by: null,
      note: a.note,
      created_at: a.granted_at,
      updated_at: a.revoked_at ?? a.granted_at,
    }))
    .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}

/** The API grants by email address (the person must have signed in once). */
async function emailFor(userId: string): Promise<string> {
  const admins = await api.get<{ admins: ApiAdmin[] }>('/platform/admins');
  const known = admins.admins.find((a) => a.user_id === userId);
  if (known) return known.email;
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await api.get<{ users: { id: string; email: string }[] }>(
      '/platform/users',
      {
        limit: 200,
        offset,
      },
    );
    const hit = page.users.find((u) => u.id === userId);
    if (hit) return hit.email;
    if (page.users.length < 200) break;
  }
  throw new ApiError(404, 'not_found', 'That person was not found.');
}

export async function grantPlatformRole(
  userId: string,
  role: PlatformRole,
): Promise<void> {
  await api.post('/platform/admins', { email: await emailFor(userId), role });
}

export async function revokePlatformRole(userId: string): Promise<void> {
  await api.post(`/platform/admins/${encodeURIComponent(userId)}/revoke`);
}
