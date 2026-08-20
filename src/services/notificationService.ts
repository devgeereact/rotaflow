import { supabase } from '@/lib/supabase';
import type { Notification } from '@/types';

/**
 * Read and mark-read only. There is no create/send function here on purpose:
 * `notifications` has no client insert policy (0002_rotaflow.sql). Creating
 * one is supabase/functions/send-notification's job, invoked via
 * useInngestDispatch, never a direct table write from this app.
 */
export async function listMyNotifications(userId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

/**
 * True unread count, not `listMyNotifications(...).filter(n => !n.read_at).length`
 * — that list is capped at 50 rows, so a person with more unread than that
 * had the header badge silently undercount. `head: true` asks Postgres for
 * the count without returning (or capping) any rows.
 */
export async function countMyUnreadNotifications(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}
