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

/** Publishes immediately, `published_at` is set here, not left null for a later "publish" step. */
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
