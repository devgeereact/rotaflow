import { supabase } from '@/lib/supabase';
import type { NotificationRow } from '@/lib/platformNotifications';

/**
 * Notification delivery across every tenant, for `/admin/notifications`.
 *
 * Readable cross-tenant because `notifications_select` is
 * `user_id = auth.uid() or public.is_platform_admin()` — one of the few
 * policies that names the platform flag directly rather than inheriting it
 * through `is_org_member`.
 *
 * ## Why this reads rows rather than counts
 *
 * PostgREST has no GROUP BY, and the console wants the split by channel, by
 * type and by read state — three aggregates over the same set. Fetching counts
 * would be three `head` requests per dimension; fetching a bounded window of
 * rows once and tallying in `lib` is fewer round trips and keeps the tallying
 * testable. The bound is the point: this is a sample of recent delivery, and
 * the screen says so rather than implying a lifetime total.
 */
export async function listRecentNotifications(limit = 1000): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('org_id, channel, type, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * How many devices are registered for web push, across every tenant.
 *
 * `head` + exact count so no endpoint or key crosses the wire — these rows hold
 * push credentials and the console has no reason to hold them in memory.
 */
export async function countPushSubscriptions(): Promise<number> {
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}
