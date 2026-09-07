import { supabase } from '@/lib/supabase';
import type { PlatformAdmin, PlatformRole } from '@/types';

/**
 * Platform administration roles (0015_platform_roles.sql).
 *
 * ## Why grants go through RPCs rather than a table write
 *
 * `platform_admins` has a SELECT policy and no write policy at all. The same
 * posture as `invites` (0006) and `audit_logs` (0002). Writes go through
 * `grant_platform_role` / `revoke_platform_role`, which are SECURITY DEFINER
 * and enforce two rules a client-side check cannot: only a platform owner may
 * change roles, and the last platform owner cannot be revoked. `AdminUsersPage`
 * already refused the second one in the browser, and a guard that lives only in
 * the browser is not a guard.
 *
 * These functions raise rather than returning empty. That is the opposite of
 * `platformService`'s reads, where RLS filters rows and a non-admin correctly
 * sees an empty list, because a refused *write* must never look like a
 * successful one. Callers surface the message.
 */

/**
 * The signed-in user's platform role, or `null` if they hold none.
 *
 * Distinct from `profiles.is_platform_admin`: the boolean answers "may act at
 * platform level" (and is what every RLS helper in 0002 folds in), while this
 * answers "as what". `OrgContext` reads both.
 */
export async function getMyPlatformRole(): Promise<PlatformRole | null> {
  const { data, error } = await supabase.rpc('my_platform_role');
  if (error) throw error;
  return (data as PlatformRole | null) ?? null;
}

/**
 * The database's own verdict on whether this session may act at platform level.
 *
 * Not the same question as `profiles.is_platform_admin`, which is what
 * `OrgContext` used to gate the whole `/admin` area on. `is_platform_admin()`
 * is that flag AND `0102`'s condition: when `platform_settings.require_mfa` is
 * on, the session must be `aal2`.
 *
 * The two diverge exactly when it matters. With `require_mfa` on and a session
 * at `aal1` — the only level the sign-in form can currently produce, since it
 * has no MFA challenge — the flag is true and the function is false. The gate
 * let the administrator in and every policy behind it then filtered to nothing:
 * the users directory empty, a profile reading "No RotaFlow profile has that
 * identifier", and the administrators roster collapsing to the single row the
 * viewer can see of themselves, which reads as "everybody else has been
 * removed" rather than as a permissions boundary. Worse, `ownerCount` was
 * computed from that one row, so the last-owner guard fired on false data.
 *
 * Asking the database the same question it will ask itself removes the
 * divergence by construction.
 */
export async function getPlatformAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) throw error;
  return data === true;
}

/** The roster, live grants first. Platform-admin only via RLS. */
export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  const { data, error } = await supabase
    .from('platform_admins')
    .select('*')
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Grant or change a platform role. Platform owner only; enforced in the RPC. */
export async function grantPlatformRole(
  userId: string,
  role: PlatformRole,
): Promise<void> {
  const { error } = await supabase.rpc('grant_platform_role', {
    p_user: userId,
    p_role: role,
  });
  if (error) throw error;
}

/**
 * Revoke a platform role.
 *
 * Raises `23514` when the target is the last remaining platform owner. The
 * database's own refusal, not a duplicate of the client-side guard.
 */
export async function revokePlatformRole(userId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_platform_role', {
    p_user: userId,
  });
  if (error) throw error;
}
