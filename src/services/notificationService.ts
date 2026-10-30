import { api, currentOrgId, orgPath } from '@/lib/api';
import type { Notification } from '@/types';

/**
 * The signed-in person's in-app notifications in the active organisation. The API answers only the caller's own,
 * so `userId` is kept for the callers' shape and never sent.
 */

interface NotificationPage {
  notifications: Omit<Notification, 'org_id' | 'user_id' | 'updated_at'>[];
  unread_count: number;
}

export async function listMyNotifications(userId: string): Promise<Notification[]> {
  const orgId = currentOrgId();
  const r = await api.get<NotificationPage>(orgPath(orgId, '/notifications'), {
    limit: 50,
  });
  return r.notifications.map((n) => ({
    ...n,
    org_id: orgId,
    user_id: userId,
    updated_at: n.created_at,
  }));
}

export async function countMyUnreadNotifications(_userId: string): Promise<number> {
  const r = await api.get<NotificationPage>(orgPath(currentOrgId(), '/notifications'), {
    limit: 1,
    unread: '1',
  });
  return r.unread_count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(orgPath(currentOrgId(), '/notifications/read'), { ids: [id] });
}

export async function markAllNotificationsRead(_userId: string): Promise<void> {
  await api.post(orgPath(currentOrgId(), '/notifications/read'), { all: true });
}
