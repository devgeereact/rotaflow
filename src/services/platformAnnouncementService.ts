import { supabase } from '@/lib/supabase';
import { clampPageSize, offsetFor, serverPage, type ServerPage } from '@/lib/serverPage';
import { escapeLikePattern } from '@/lib/filters';
import type { Tables } from '@/types/database.types';

export type PlatformAnnouncement = Tables<'platform_announcements'>;

/**
 * Delivery counts for one announcement.
 *
 * Four separate facts, and none of them is inferred from another. `queued` is
 * a delivery row nothing has carried yet; `delivered` is one a dispatch was
 * confirmed for; `failed` is one that will not be carried; `read` is a tenant
 * having opened it. `0025` built the table for exactly this distinction and
 * `publish_platform_announcement` then stamped `sent_at` at insert, so every
 * intention counted as a delivery. 0132 fixes the writer and this reads the
 * result.
 */
export interface AnnouncementDeliveryCounts {
  recipients: number;
  queued: number;
  delivered: number;
  failed: number;
  read: number;
}

export interface AnnouncementRow
  extends PlatformAnnouncement, AnnouncementDeliveryCounts {}

const EMPTY_COUNTS: AnnouncementDeliveryCounts = {
  recipients: 0,
  queued: 0,
  delivered: 0,
  failed: 0,
  read: 0,
};

export interface AnnouncementQuery {
  search?: string;
  status?: readonly string[];
  kind?: readonly string[];
  audience?: readonly string[];
  page?: number;
  pageSize?: number;
}

/**
 * One page of announcements, with the delivery counts for that page only.
 *
 * The previous version took `limit = 50` and then read the WHOLE
 * `platform_announcement_deliveries` table into the browser to tally it — one
 * row per recipient organisation per announcement, which is the
 * fastest-growing table in this feature and the one a hundred-tenant
 * deployment fills quickest. `platform_announcement_stats` (0132) aggregates
 * in the database, scoped to the ids on screen.
 */
export async function listAnnouncements(
  query: AnnouncementQuery = {},
): Promise<ServerPage<AnnouncementRow>> {
  const pageSize = clampPageSize(query.pageSize ?? 20);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const from = offsetFor(page, pageSize);

  let request = supabase
    .from('platform_announcements')
    .select('*', { count: 'exact' })
    // `coalesce(sent_at, scheduled_for, created_at)` is the index 0025 built
    // for this order, but PostgREST cannot express it, so the order is on
    // `created_at` with `id` behind it. The tie-break matters: two
    // announcements composed in the same second would otherwise be free to
    // swap between pages.
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + pageSize - 1);

  if (query.status && query.status.length > 0)
    request = request.in('status', [...query.status]);
  if (query.kind && query.kind.length > 0) request = request.in('kind', [...query.kind]);
  if (query.audience && query.audience.length > 0) {
    request = request.in('audience', [...query.audience]);
  }
  const term = query.search?.trim();
  if (term) {
    // Escaped, so a `%` in a search term means a percent sign rather than
    // "everything". `escapeOrValue` handles the comma and bracket problem in
    // the `or=(…)` list itself.
    const pattern = `%${escapeLikePattern(term)}%`;
    request = request.or(`title.ilike.${pattern},body.ilike.${pattern}`);
  }

  const { data, error, count } = await request;
  if (error) throw error;

  const rows = data ?? [];
  const stats = await countDeliveries(rows.map((row) => row.id));

  return serverPage({
    rows: rows.map((row) => ({ ...row, ...(stats.get(row.id) ?? EMPTY_COUNTS) })),
    total: count ?? rows.length,
    page,
    pageSize,
  });
}

/** Delivery counts for the given announcements, aggregated in the database. */
export async function countDeliveries(
  ids: readonly string[],
): Promise<Map<string, AnnouncementDeliveryCounts>> {
  const out = new Map<string, AnnouncementDeliveryCounts>();
  if (ids.length === 0) return out;

  const { data, error } = await supabase.rpc('platform_announcement_stats', {
    p_ids: [...ids],
  });
  if (error) throw error;

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    out.set(String(row.announcement_id), {
      recipients: Number(row.recipients ?? 0),
      queued: Number(row.queued ?? 0),
      delivered: Number(row.delivered ?? 0),
      failed: Number(row.failed ?? 0),
      read: Number(row.read ?? 0),
    });
  }
  return out;
}

/** Organisations that have switched off non-essential platform mail. */
export async function countOptOuts(): Promise<number> {
  const { count, error } = await supabase
    .from('platform_announcement_optouts')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export interface AnnouncementDraft {
  title: string;
  body: string;
  kind: string;
  audience: string;
  plans: string[];
  channel: string;
  /** An ISO instant. Null composes a draft; a value schedules it. */
  scheduledFor: string | null;
}

export async function createAnnouncement(input: AnnouncementDraft): Promise<string> {
  const { data, error } = await supabase.rpc('create_platform_announcement', {
    p_title: input.title,
    p_body: input.body,
    p_kind: input.kind,
    p_audience: input.audience,
    p_plans: input.plans,
    p_channel: input.channel,
    p_scheduled_for: input.scheduledFor ?? undefined,
  });
  if (error) throw error;
  return data;
}

/**
 * Resolve the audience into delivery rows and queue a dispatch for each.
 *
 * Returns how many organisations were addressed, from a count the database
 * made. Note what it does NOT mean: those deliveries are queued, and become
 * delivered when `reconcile_announcement_deliveries()` sees the dispatch
 * confirmed. The caller must not report this number as "delivered to N".
 */
export async function publishAnnouncement(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('publish_platform_announcement', {
    p_announcement: id,
  });
  if (error) throw error;
  return data ?? 0;
}

/** Stop a draft or a scheduled announcement. A sent one cannot be unsent. */
export async function cancelAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_platform_announcement', {
    p_announcement: id,
  });
  if (error) throw error;
}

/**
 * How many organisations an audience would reach, before publishing.
 *
 * The composer's preview. Counted with `head: true`, so no tenant row crosses
 * the wire to answer a question about how many there are. It is deliberately
 * an estimate of the *audience*, not of delivery: an organisation with no
 * active owner or manager is in this number and will still be recorded as a
 * failed delivery, because it is a recipient nobody can reach rather than one
 * nobody chose.
 */
export async function previewAudience(input: {
  audience: string;
  plans: readonly string[];
  kind: string;
}): Promise<number> {
  let request = supabase
    .from('organisations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  if (input.audience === 'plans') {
    if (input.plans.length === 0) return 0;
    request = request.in('plan', [...input.plans]);
  }

  const { count, error } = await request;
  if (error) throw error;
  const total = count ?? 0;

  // Maintenance and incident notices ignore an opt-out; everything else
  // honours it, exactly as the publish function does.
  if (input.kind === 'maintenance' || input.kind === 'incident') return total;

  const { count: optedOut, error: optOutError } = await supabase
    .from('platform_announcement_optouts')
    .select('org_id', { count: 'exact', head: true });
  if (optOutError) throw optOutError;

  return Math.max(0, total - (optedOut ?? 0));
}
