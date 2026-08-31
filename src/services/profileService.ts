import { supabase } from '@/lib/supabase';
import type { Profile, ProfileUpdate } from '@/types';

/** Fetch the current user's profile (RLS restricts this to their own row). */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Patch the current user's profile. */
export async function updateProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export interface AccountSession {
  sessionId: string;
  createdAt: string;
  refreshedAt: string | null;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;
}

/**
 * Where this account is signed in (CAP-050, `0100`).
 *
 * The register said there was "no server-side registry". There always was —
 * `auth.sessions` is GoTrue's own and carries the user agent, IP and last
 * refresh. Nothing surfaced it, which is a different problem with a much
 * smaller fix.
 *
 * Takes no argument on purpose: there is no session id to pass, so there is
 * no way to ask about somebody else's.
 */
export async function listMySessions(): Promise<AccountSession[]> {
  const { data, error } = await supabase.rpc('my_sessions');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    sessionId: row.session_id,
    createdAt: row.created_at,
    refreshedAt: row.refreshed_at,
    userAgent: row.user_agent,
    ip: row.ip,
    isCurrent: row.is_current,
  }));
}

/**
 * Sign out every device except this one, returning how many were ended.
 *
 * Deliberately "all the others" rather than one at a time: picking a session
 * from a list means matching a row to a physical device by user agent, and
 * somebody who cannot tell which "Mobile Safari on iOS" is the lost phone
 * will either pick wrong or not act at all.
 *
 * Not instant. An access token already issued stays valid until it expires
 * (an hour on this project), so the honest phrasing is "within the hour",
 * which is what the screen says.
 */
export async function revokeMyOtherSessions(): Promise<number> {
  const { data, error } = await supabase.rpc('revoke_my_other_sessions');
  if (error) throw error;
  return data ?? 0;
}
