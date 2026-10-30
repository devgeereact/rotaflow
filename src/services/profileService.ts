import { api } from '@/lib/api';
import type { MePayload } from '@/context/AuthContext';
import type { Profile, ProfileUpdate } from '@/types';

/**
 * The signed-in person's own profile. The email address is Clerk's (it is how they sign in) and is changed in the
 * account screen; the display name is RotaFlow's. Sessions and devices are Clerk's too (Security page).
 */
export async function getProfile(userId: string): Promise<Profile | null> {
  const r = await api.get<MePayload>('/me');
  if (r.user.id !== userId) return null;
  return {
    id: r.user.id,
    email: r.user.email,
    full_name: r.user.full_name,
    avatar_url: r.user.avatar_url,
    is_platform_admin: r.platform_role !== null,
    created_at: '',
    updated_at: '',
  };
}

export async function updateProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<Profile> {
  if ('full_name' in patch)
    await api.post('/me/profile', { full_name: patch.full_name ?? null });
  const profile = await getProfile(userId);
  if (!profile) throw new Error('Profile not found');
  return profile;
}
