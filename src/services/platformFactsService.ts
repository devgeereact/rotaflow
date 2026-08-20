import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

export type HealthSummaryRow = Tables<'platform_health_summary'>;
export type RetentionPolicy = Tables<'retention_policies'>;
export type IpAllowlistEntry = Tables<'platform_ip_allowlist'>;

export interface AuthFacts {
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  mfaEnrolled: boolean;
  bannedUntil: string | null;
}

export interface AuthFactsSummary {
  totalAccounts: number;
  unverified: number;
  active30d: number;
  inactive90d: number;
  mfaEnrolled: number;
  banned: number;
}

/**
 * The facts the console could not read before 0027.
 *
 * Email confirmation, last sign-in and MFA enrolment live in `auth.users`,
 * which no client may select from. `platform_user_auth_facts` is the narrow,
 * platform-staff-only window onto exactly those columns, not a view, because
 * a view is one grant away from exposing the whole table.
 */
export async function getAuthFacts(userId: string): Promise<AuthFacts | null> {
  const { data, error } = await supabase.rpc('platform_user_auth_facts', {
    p_user: userId,
  });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    emailConfirmedAt: row.email_confirmed_at,
    lastSignInAt: row.last_sign_in_at,
    mfaEnrolled: row.mfa_enrolled,
    bannedUntil: row.banned_until,
  };
}

/** The same facts across every account, as one round trip for the tiles. */
export async function getAuthFactsSummary(): Promise<AuthFactsSummary | null> {
  const { data, error } = await supabase.rpc('platform_auth_facts_summary');
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    totalAccounts: row.total_accounts,
    unverified: row.unverified,
    active30d: row.active_30d,
    inactive90d: row.inactive_90d,
    mfaEnrolled: row.mfa_enrolled,
    banned: row.banned,
  };
}

/** Rolling 24-hour uptime and latency percentiles, per service. */
export async function getHealthSummary(): Promise<HealthSummaryRow[]> {
  const { data, error } = await supabase
    .from('platform_health_summary')
    .select('*')
    .order('service');
  if (error) throw error;
  return data ?? [];
}

/**
 * Store one probe result.
 *
 * `source` is kept so a sample taken by a console in London is never averaged
 * into an uptime figure as though a scheduled probe produced it.
 */
export async function recordHealthSample(
  service: string,
  status: 'operational' | 'degraded' | 'down',
  latencyMs: number | null,
  source: 'console' | 'scheduled' | 'manual' = 'console',
): Promise<void> {
  const { error } = await supabase.rpc('record_health_sample', {
    p_service: service,
    p_status: status,
    // `platform_health_samples.latency_ms` is `integer`; callers measure with
    // `performance.now()`, which is never a whole number. PostgREST casts a
    // JSON body value straight to the column type with no implicit rounding,
    // so an un-rounded float 400s on every single call — round here, the one
    // place every caller funnels through.
    p_latency_ms: latencyMs === null ? undefined : Math.round(latencyMs),
    p_source: source,
  });
  if (error) throw error;
}

export async function listRetentionPolicies(): Promise<RetentionPolicy[]> {
  const { data, error } = await supabase
    .from('retention_policies')
    .select('*')
    .order('label');
  if (error) throw error;
  return data ?? [];
}

export async function listIpAllowlist(): Promise<IpAllowlistEntry[]> {
  const { data, error } = await supabase
    .from('platform_ip_allowlist')
    .select('*')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

/** Queued background work, by queue. The console's queue-depth figure. */
export async function getQueueDepths(): Promise<
  { queue: string; queued: number; failed: number }[]
> {
  const { data, error } = await supabase
    .from('background_jobs')
    .select('queue, status')
    .in('status', ['queued', 'running', 'failed']);
  if (error) throw error;

  const byQueue = new Map<string, { queued: number; failed: number }>();
  for (const row of data ?? []) {
    const current = byQueue.get(row.queue) ?? { queued: 0, failed: 0 };
    if (row.status === 'failed') current.failed += 1;
    else current.queued += 1;
    byQueue.set(row.queue, current);
  }
  return [...byQueue.entries()]
    .map(([queue, v]) => ({ queue, ...v }))
    .sort((a, b) => b.queued - a.queued);
}
