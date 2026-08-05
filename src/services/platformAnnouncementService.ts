import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

export type PlatformAnnouncement = Tables<'platform_announcements'>;

export interface AnnouncementRow extends PlatformAnnouncement {
  /** Delivery rows written for this announcement. Zero for a draft. */
  recipients: number;
  /** Recipients whose row carries a `sent_at`. Queued rows are not counted. */
  sent: number;
  read: number;
  failed: number;
}

/**
 * Platform announcements and their delivery record (0025).
 *
 * Sent and read are counted from `platform_announcement_deliveries` rather
 * than stored on the announcement: a counter drifts the first time a fan-out
 * half-fails, and cannot answer "which organisations have not seen it".
 */
export async function listAnnouncements(limit = 50): Promise<AnnouncementRow[]> {
  const [announcements, deliveries] = await Promise.all([
    supabase
      .from('platform_announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('platform_announcement_deliveries')
      .select('announcement_id, sent_at, read_at, failed_at'),
  ]);
  if (announcements.error) throw announcements.error;
  if (deliveries.error) throw deliveries.error;

  const tally = new Map<
    string,
    { recipients: number; sent: number; read: number; failed: number }
  >();
  for (const d of deliveries.data ?? []) {
    const current = tally.get(d.announcement_id) ?? {
      recipients: 0,
      sent: 0,
      read: 0,
      failed: 0,
    };
    current.recipients += 1;
    if (d.sent_at) current.sent += 1;
    if (d.read_at) current.read += 1;
    if (d.failed_at) current.failed += 1;
    tally.set(d.announcement_id, current);
  }

  return (announcements.data ?? []).map((a) => ({
    ...a,
    ...(tally.get(a.id) ?? { recipients: 0, sent: 0, read: 0, failed: 0 }),
  }));
}

/** Organisations that have switched off non-essential platform mail. */
export async function countOptOuts(): Promise<number> {
  const { count, error } = await supabase
    .from('platform_announcement_optouts')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function createAnnouncement(input: {
  title: string;
  body: string;
  kind?: string;
  audience?: string;
  plans?: string[];
  channel?: string;
  scheduledFor?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_platform_announcement', {
    p_title: input.title,
    p_body: input.body,
    p_kind: input.kind ?? 'product',
    p_audience: input.audience ?? 'all',
    p_plans: input.plans ?? [],
    p_channel: input.channel ?? 'in_app',
    p_scheduled_for: input.scheduledFor ?? null,
  });
  if (error) throw error;
  return data;
}

/** Resolves the audience into delivery rows. Returns how many were written. */
export async function publishAnnouncement(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('publish_platform_announcement', {
    p_announcement: id,
  });
  if (error) throw error;
  return data ?? 0;
}
