import { supabase } from '@/lib/supabase';
import type { PlatformSettings, PlatformSettingsUpdate } from '@/types';

/**
 * Deployment-wide configuration (0018_platform_settings.sql).
 *
 * A single seeded row, so this is a `.single()` and never "which row won?".
 * Readable by every signed-in user. The maintenance banner and support address
 * are things the tenant app shows, and writable only by a platform owner or
 * administrator, enforced by the table's UPDATE policy.
 *
 * ## What is deliberately not here
 *
 * Authentication settings. Password policy, magic links, OAuth providers,
 * session duration. Belong to Supabase Auth, which this table cannot override.
 * A "require email verification" switch here would be a switch that changes
 * nothing, so the console reports the real, build-time configuration from
 * `lib/env.ts` instead and says where each setting actually lives.
 */

/** The singleton row. Seeded by the migration, so this should never be null. */
export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Patch the settings row.
 *
 * Raises rather than returning empty when the caller lacks the role: the UPDATE
 * policy filters the row out, PostgREST reports zero rows changed, and
 * `.single()` turns that into an error, which is the behaviour we want, since
 * a settings save that silently did nothing is the defect this codebase already
 * shipped once on `/admin/users`.
 */
export async function updatePlatformSettings(
  patch: PlatformSettingsUpdate,
  updatedBy: string,
): Promise<PlatformSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .update({ ...patch, updated_by: updatedBy })
    .eq('id', true)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
