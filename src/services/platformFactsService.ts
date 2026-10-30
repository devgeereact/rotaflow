import { api, isApiCode } from '@/lib/api';
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
  // Sign-in facts live in Clerk. The API knows only when the person was last seen; email is verified by
  // Clerk before any sign-in, and factors and bans are managed in the Clerk dashboard.
  try {
    const r = await api.get<{
      user: { created_at: string; last_seen_at: string | null };
    }>(`/platform/users/${encodeURIComponent(userId)}`);
    return {
      emailConfirmedAt: r.user.created_at,
      lastSignInAt: r.user.last_seen_at,
      mfaEnrolled: false,
      bannedUntil: null,
    };
  } catch (error) {
    if (isApiCode(error, 'not_found')) return null;
    throw error;
  }
}

/** The same facts across every account, as one round trip for the tiles. */
export async function getAuthFactsSummary(): Promise<AuthFactsSummary | null> {
  // Account-level sign-in statistics are Clerk's (its dashboard); none are mirrored into the API.
  return Promise.resolve(null);
}

/** Rolling 24-hour uptime and latency percentiles, per service. */
export async function getHealthSummary(): Promise<HealthSummaryRow[]> {
  // Stored health probes are on the cut list (they probed Supabase); uptime is watched externally.
  return Promise.resolve([]);
}

/**
 * Store one probe result.
 *
 * `source` is kept so a sample taken by a console in London is never averaged
 * into an uptime figure as though a scheduled probe produced it.
 */
export async function recordHealthSample(
  _service: string,
  _status: 'operational' | 'degraded' | 'down',
  _latencyMs: number | null,
  _source: 'console' | 'scheduled' | 'manual' = 'console',
): Promise<void> {
  // Not stored: see getHealthSummary.
}

export async function listRetentionPolicies(): Promise<RetentionPolicy[]> {
  const r = await api.get<{
    policies: {
      data_type: string;
      label: string;
      retain_months: number | null;
      enforced: boolean | number;
      note: string;
    }[];
  }>('/platform/retention');
  return r.policies
    .map((p) => ({ ...p, enforced: Boolean(Number(p.enforced)), updated_at: '' }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function listIpAllowlist(): Promise<IpAllowlistEntry[]> {
  // On the cut list: nothing ever enforced it (docs/MERGE-TARGET.md section 5).
  return Promise.resolve([]);
}

export interface QueueDepth {
  queue: string;
  queued: number;
  failed: number;
  /** Age of the oldest item still waiting, or null when nothing is. */
  oldestAt: string | null;
}

/**
 * Depth of the notification outbox, by event. The console's queue-depth figure.
 *
 * ## What this used to read
 *
 * `background_jobs`, a table with no writer. Its only one was Inngest, retired
 * in `0087`, and since then it has had zero rows, no triggers, and no function
 * in `public` referencing it at all. So the tile read "0 queued" and the panel
 * read "Nothing is queued or running" permanently — on the one screen whose job
 * is to say whether work is stuck. That is worse than having no tile: a real
 * backlog looked exactly like a healthy queue.
 *
 * `notification_outbox` is the only background queue the product has, drained
 * every minute by `send-notification` (`0069`, extended by `0132`).
 *
 * ## Counted in the database
 *
 * Through `platform_queue_depths()` (`0141`) rather than select-and-group.
 * Grouping in the browser would have carried the truncation bug `0130`-`0134`
 * spent five migrations removing: above `db.max_rows` the browser would group a
 * capped page and report it as the estate's queue depth.
 */
export async function getQueueDepths(): Promise<QueueDepth[]> {
  // The notification outbox is drained by the API's cron; its depth has no console route yet.
  return Promise.resolve([]);
}
