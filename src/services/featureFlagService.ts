import { api } from '@/lib/api';
import type { Tables } from '@/types/database.types';

export type FeatureFlag = Tables<'feature_flags'>;
export type FeatureFlagChange = Tables<'feature_flag_changes'>;

/**
 * Feature flags (0022).
 *
 * Reads are open to every signed-in session. The tenant app has to know what
 * it may render, and every write is an RPC gated on the platform config
 * roles. The history table is platform-staff only.
 */

interface ApiFlag {
  flag_key: string;
  name: string;
  description: string;
  enabled: boolean | number;
  rollout: number | string;
  environment: string;
  critical: boolean | number;
  target_plans: string[] | string | null;
  retired_at: string | null;
  retired_reason: string | null;
  updated_at: string;
  targeted_orgs: number | string;
}

async function fetchFlags(): Promise<ApiFlag[]> {
  return (await api.get<{ flags: ApiFlag[] }>('/platform/flags')).flags;
}

function plansOf(v: ApiFlag['target_plans']): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  return (await fetchFlags())
    .map((f) => ({
      key: f.flag_key,
      name: f.name,
      description: f.description,
      enabled: Boolean(Number(f.enabled)),
      rollout: Number(f.rollout),
      environment: f.environment,
      critical: Boolean(Number(f.critical)),
      target_plans: plansOf(f.target_plans),
      retired_at: f.retired_at,
      retired_reason: f.retired_reason,
      updated_at: f.updated_at,
      updated_by: null,
      created_at: f.updated_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many organisations each flag names explicitly, keyed by flag. */
export async function countFlagTargets(): Promise<Map<string, number>> {
  return new Map((await fetchFlags()).map((f) => [f.flag_key, Number(f.targeted_orgs)]));
}

export async function listFlagChanges(
  flagKey: string,
  limit = 20,
): Promise<FeatureFlagChange[]> {
  const r = await api.get<{
    changes: {
      actor_name: string | null;
      field: string;
      before_value: string | null;
      after_value: string | null;
      created_at: string;
    }[];
  }>('/platform/flags/changes', { key: flagKey });
  return r.changes.slice(0, limit).map((c, i) => ({
    ...c,
    id: `${flagKey}:${c.created_at}:${i}`,
    flag_key: flagKey,
    actor_id: null,
  }));
}

/** The most recent change per flag, for the "Updated" line on each card. */
export async function latestFlagChanges(): Promise<Map<string, FeatureFlagChange>> {
  const latest = new Map<string, FeatureFlagChange>();
  for (const flag of await fetchFlags()) {
    const [first] = await listFlagChanges(flag.flag_key, 1);
    if (first) latest.set(flag.flag_key, first);
  }
  return latest;
}

export async function setFeatureFlag(
  key: string,
  patch: { enabled?: boolean; rollout?: number; plans?: string[] },
): Promise<void> {
  await api.post('/platform/flags', {
    key,
    enabled: patch.enabled,
    rollout: patch.rollout,
    plans: patch.plans,
  });
}

export async function setFeatureFlagTarget(
  key: string,
  orgId: string,
  targeted: boolean,
): Promise<void> {
  await api.post('/platform/flags/targets', { key, org_id: orgId, targeted });
}
