import { api } from '@/lib/api';
import type { NotificationRow } from '@/lib/platformNotifications';

/** The notifications console: recent activity (no titles or bodies) and the push subscription count. */

interface Activity {
  notifications: NotificationRow[];
  push_subscriptions: number;
}

export async function listRecentNotifications(limit = 1000): Promise<NotificationRow[]> {
  const r = await api.get<Activity>('/platform/notifications/activity', {
    limit: Math.min(1000, limit),
  });
  return r.notifications;
}

export async function countPushSubscriptions(): Promise<number> {
  const r = await api.get<Activity>('/platform/notifications/activity', { limit: 1 });
  return r.push_subscriptions;
}
