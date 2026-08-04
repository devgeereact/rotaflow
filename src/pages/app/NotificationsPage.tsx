import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bell, BellOff, Check } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useWebPush } from '@/hooks/useWebPush';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/notificationService';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import type { Notification } from '@/types';

/**
 * `/app/notifications` — read + mark-read against the real `notifications`
 * table. Will be genuinely empty on a fresh deploy: nothing writes into it
 * until send-notification is deployed and its Inngest routing is configured
 * (both manual, out-of-repo steps — see that function's header comment).
 * This screen is correct and ready for whenever that lands.
 */
export function NotificationsPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const webPush = useWebPush();
  const { showError, showSuccess } = useToast();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['notifications'],
    scope: { column: 'user_id', value: user?.id ?? null },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const rows = await listMyNotifications(user.id);
        if (!active) return;
        setNotifications(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'notifications:load' });
        setLoadFailed(true);
        showError('Could not load notifications.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, reloadKey, showError]);

  const handleMarkRead = useCallback(async (id: string): Promise<void> => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
    } catch (err) {
      reportError(err, { area: 'notifications:mark-read' });
    }
  }, []);

  const handleMarkAllRead = useCallback(async (): Promise<void> => {
    if (!user) return;
    try {
      await markAllNotificationsRead(user.id);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
      );
    } catch (err) {
      reportError(err, { area: 'notifications:mark-all-read' });
      showError('Could not mark everything as read.');
    }
  }, [user, showError]);

  const handleTogglePush = useCallback(async (): Promise<void> => {
    if (!user) return;
    if (webPush.status === 'granted') {
      await webPush.unsubscribe();
      showSuccess('Push notifications turned off on this device.');
      return;
    }
    const ok = await webPush.subscribe(user.id);
    if (ok) {
      showSuccess('Push notifications turned on for this device.');
    } else if (webPush.status === 'denied') {
      showError('Notifications are blocked for this site in your browser settings.');
    }
  }, [user, webPush, showError, showSuccess]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load notifications.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
          Notifications
        </h1>
        <div className="flex items-center gap-2">
          {webPush.status !== 'unsupported' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleTogglePush()}
              disabled={webPush.subscribing}
            >
              {webPush.status === 'granted' ? (
                <BellOff size={14} aria-hidden="true" className="mr-1.5" />
              ) : (
                <Bell size={14} aria-hidden="true" className="mr-1.5" />
              )}
              {webPush.status === 'granted' ? 'Turn off push' : 'Turn on push'}
            </Button>
          )}
          {unreadCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void handleMarkAllRead()}>
              <Check size={14} aria-hidden="true" className="mr-1.5" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <Card>
          <LoadingState variant="card" rows={4} label="Loading notifications…" />
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="Updates about shifts, leave and swaps will show up here."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={cn(
                  'flex items-start justify-between gap-3 p-4',
                  !notification.read_at && 'bg-primary/5',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content dark:text-content-dark">
                    {notification.title}
                  </p>
                  {notification.body && (
                    <p className="text-sm text-content-muted dark:text-content-muted-dark">
                      {notification.body}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                    {formatDistanceToNow(new Date(notification.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                {!notification.read_at && (
                  <button
                    type="button"
                    onClick={() => void handleMarkRead(notification.id)}
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
