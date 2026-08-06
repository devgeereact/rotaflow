import { supabase } from '@/lib/supabase';
import type { Announcement, AnnouncementInsert } from '@/types';

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
