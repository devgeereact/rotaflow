import { supabase } from '@/lib/supabase';
import type { Announcement, AnnouncementInsert, AnnouncementRead } from '@/types';

/** Every announcement in the org, newest first. RLS (org-shared) scopes this to members. */
export async function listAnnouncements(orgId: string): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Publishes immediately, `published_at` is set here, not left null for a later
 * "publish" step.
 *
 * Notifying the audience is NOT done here. `announcements_enqueue_published`
 * (0087) writes the notification in the same transaction as the insert, so it
 * cannot be lost by a tab that closes on the success toast — which is what
 * happened while this page dispatched it itself (GAP-026).
 */
export async function createAnnouncement(
  input: AnnouncementInsert,
): Promise<Announcement> {
  const { data, error } = await supabase
    .from('announcements')
    .insert({ ...input, published_at: new Date().toISOString() })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) throw error;
}

/** Every read receipt in the org, one query, for the read-progress bar (0046). */
export async function listAnnouncementReads(orgId: string): Promise<AnnouncementRead[]> {
  const { data, error } = await supabase
    .from('announcement_reads')
    .select('*')
    .eq('org_id', orgId);
  if (error) throw error;
  return data ?? [];
}

/** A no-op if already read: `announcement_reads` is unique per (announcement, staff). */
export async function markAnnouncementRead(
  orgId: string,
  announcementId: string,
  staffProfileId: string,
): Promise<void> {
  const { error } = await supabase.from('announcement_reads').insert({
    org_id: orgId,
    announcement_id: announcementId,
    staff_profile_id: staffProfileId,
  });
  // A duplicate insert (already marked read) is expected, not a failure.
  if (error && error.code !== '23505') throw error;
}

/**
 * Re-notify everyone in an announcement's audience who has not read it.
 *
 * The one dispatch no trigger can carry: pressing "Remind unread" changes no
 * row, so there is no transition to hang it on. It goes through an RPC instead
 * — which still commits the outbox row before returning, so the reminder
 * survives the tab closing immediately afterwards.
 *
 * The audience and the read set are both computed server-side. The page used
 * to derive them from whatever staff list it had loaded, so who got reminded
 * depended on a client-side cache.
 *
 * Returns how many people it will actually reach.
 */
export async function remindAnnouncementUnread(announcementId: string): Promise<number> {
  const { data, error } = await supabase.rpc('remind_announcement_unread', {
    p_announcement_id: announcementId,
  });
  if (error) throw error;
  return data ?? 0;
}
