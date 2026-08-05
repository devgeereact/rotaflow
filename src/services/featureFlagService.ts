import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

export type FeatureFlag = Tables<'feature_flags'>;
export type FeatureFlagChange = Tables<'feature_flag_changes'>;

/**
 * Feature flags (0022).
 *
 * Reads are open to every signed-in session — the tenant app has to know what
 * it may render — and every write is an RPC gated on the platform config
 * roles. The history table is platform-staff only.
 */

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase.from('feature_flags').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

/** How many organisations each flag names explicitly, keyed by flag. */
export async function countFlagTargets(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('feature_flag_targets').select('flag_key');
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.flag_key, (counts.get(row.flag_key) ?? 0) + 1);
  }
  return counts;
}

export async function listFlagChanges(
  flagKey: string,
  limit = 20,
): Promise<FeatureFlagChange[]> {
  const { data, error } = await supabase
    .from('feature_flag_changes')
    .select('*')
    .eq('flag_key', flagKey)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** The most recent change per flag, for the "Updated" line on each card. */
export async function latestFlagChanges(): Promise<Map<string, FeatureFlagChange>> {
  const { data, error } = await supabase
    .from('feature_flag_changes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const latest = new Map<string, FeatureFlagChange>();
  for (const row of data ?? []) {
    // Rows arrive newest first, so the first one seen for a key is the latest.
    if (!latest.has(row.flag_key)) latest.set(row.flag_key, row);
  }
  return latest;
}

export async function setFeatureFlag(
  key: string,
  patch: { enabled?: boolean; rollout?: number; plans?: string[] },
): Promise<void> {
  const { error } = await supabase.rpc('set_feature_flag', {
    p_key: key,
    p_enabled: patch.enabled ?? null,
    p_rollout: patch.rollout ?? null,
    p_plans: patch.plans ?? null,
  });
  if (error) throw error;
}

export async function setFeatureFlagTarget(
  key: string,
  orgId: string,
  targeted: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_feature_flag_target', {
    p_key: key,
    p_org: orgId,
    p_targeted: targeted,
  });
  if (error) throw error;
}
