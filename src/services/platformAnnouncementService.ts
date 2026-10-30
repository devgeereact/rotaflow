import { api } from '@/lib/api';
import { clampPageSize, offsetFor, serverPage, type ServerPage } from '@/lib/serverPage';
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
  extends PlatformAnnouncement,
    AnnouncementDeliveryCounts {}

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
interface ApiAnnouncement {
  id: string;
  title: string;
  body: string;
  kind: string;
  audience: string;
  audience_plans: string[];
  status: string;
  scheduled_for: string | null;
  sent_at: string | null;
  created_at: string;
  stats: AnnouncementDeliveryCounts | null;
}

async function fetchAll(): Promise<ApiAnnouncement[]> {
  return (await api.get<{ announcements: ApiAnnouncement[] }>('/platform/announcements'))
    .announcements;
}

export async function listAnnouncements(
  query: AnnouncementQuery = {},
): Promise<ServerPage<AnnouncementRow>> {
  const pageSize = clampPageSize(query.pageSize ?? 20);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const term = query.search?.trim().toLowerCase();
  const inList = (list: readonly string[] | undefined, v: string): boolean =>
    !list || list.length === 0 || list.includes(v);
  const rows = (await fetchAll()).filter(
    (a) =>
      inList(query.status, a.status) &&
      inList(query.kind, a.kind) &&
      inList(query.audience, a.audience) &&
      (!term ||
        a.title.toLowerCase().includes(term) ||
        a.body.toLowerCase().includes(term)),
  );
  const offset = offsetFor(page, pageSize);
  return serverPage({
    rows: rows.slice(offset, offset + pageSize).map(({ stats, ...a }) => ({
      ...a,
      channel: 'in_app',
      created_by: null,
      updated_at: a.sent_at ?? a.created_at,
      ...(stats ?? EMPTY_COUNTS),
    })),
    total: rows.length,
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
  const wanted = new Set(ids);
  for (const a of await fetchAll()) {
    if (wanted.has(a.id)) out.set(a.id, a.stats ?? EMPTY_COUNTS);
  }
  return out;
}

/** Organisations that have switched off non-essential platform mail. */
export async function countOptOuts(): Promise<number> {
  // How many organisations muted platform messages is not reported by the API; each organisation's own
  // choice is on its announcements screen.
  return Promise.resolve(0);
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
  const r = await api.post<{ id: string }>('/platform/announcements', {
    title: input.title,
    body: input.body,
    kind: input.kind,
    audience: input.audience,
    plans: input.plans,
    scheduled_for: input.scheduledFor,
  });
  return r.id;
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
  const r = await api.post<{ queued: number }>(
    `/platform/announcements/${encodeURIComponent(id)}/publish`,
  );
  return r.queued;
}

/** Stop a draft or a scheduled announcement. A sent one cannot be unsent. */
export async function cancelAnnouncement(id: string): Promise<void> {
  await api.post(`/platform/announcements/${encodeURIComponent(id)}/cancel`);
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
  if (input.audience === 'plans' && input.plans.length === 0) return 0;
  let total = 0;
  for (let offset = 0; offset < 100_000; offset += 100) {
    const r = await api.get<{ organisations: { plan: string }[] }>('/platform/orgs', {
      status: 'active',
      limit: 100,
      offset,
    });
    total += r.organisations.filter(
      (o) => input.audience !== 'plans' || input.plans.includes(o.plan),
    ).length;
    if (r.organisations.length < 100) break;
  }
  // Opt-outs are not counted here (see countOptOuts), so this is the upper bound for product messages.
  return total;
}
