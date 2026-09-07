import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  AlarmClock,
  Bell,
  BellOff,
  Calendar,
  Check,
  Info,
  Megaphone,
  Repeat2,
  Umbrella,
  type LucideIcon,
} from 'lucide-react';
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
import type { Notification } from '@/types';

/**
 * `notifications.type` is free text (no check constraint, docs/SCHEMA.md §3),
 * written by whichever database trigger enqueued the row, so this can never
 * be exhaustive. It covers the values `send-notification`'s callers use today,
 * keyed to the same icons the sidebar already uses
 * for the equivalent screen (Umbrella=Leave, Repeat2=Swaps, etc.), and falls
 * back to a plain bell for anything else rather than guessing.
 */
const TYPE_META: Record<string, { icon: LucideIcon; tone: string }> = {
  rota_published: {
    icon: Calendar,
    tone: 'bg-primary/10 text-primary dark:text-primary-ink-dark',
  },
  leave_approved: { icon: Umbrella, tone: 'bg-success/10 text-success' },
  leave_declined: { icon: Umbrella, tone: 'bg-danger/10 text-danger' },
  swap_request: { icon: Repeat2, tone: 'bg-info/10 text-info' },
  swap_approved: { icon: Repeat2, tone: 'bg-success/10 text-success' },
  announcement: { icon: Megaphone, tone: 'bg-warning/10 text-warning' },
  shift_reminder: { icon: AlarmClock, tone: 'bg-info/10 text-info' },
};
const DEFAULT_TYPE_META = {
  icon: Bell,
  tone: 'bg-surface-subtle text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark',
};

/**
 * `/app/notifications`. Read + mark-read against the real `notifications`
 * table. Genuinely empty until something happens that owes a notification:
 * rows are written by `send-notification`, which the `pg_cron` outbox drain
 * calls (`0069`, `0087`, `0091`). No manual routing step stands between a
 * published rota and this screen any more — the Inngest configuration this
 * comment used to name was deleted by `0087`.
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
      <div className="mb-1 flex flex-wrap items-center justify-between gap-4">
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
      <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
        Reached from the bell. There is no sidebar entry, by design. Manage what you get
        notified about in{' '}
        <Link
          to="/app/account/preferences"
          className="font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
        >
          Notification preferences
        </Link>
        .
      </p>

      {loading ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">
            No notifications yet.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {notifications.map((notification) => {
              const { icon: TypeIcon, tone } =
                TYPE_META[notification.type] ?? DEFAULT_TYPE_META;
              return (
                <li
                  key={notification.id}
                  className={cn(
                    'flex items-start justify-between gap-3 p-4',
                    !notification.read_at && 'bg-primary/5',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                      tone,
                    )}
                  >
                    <TypeIcon size={16} aria-hidden="true" />
                  </span>
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
                      className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium text-primary-ink dark:text-primary-ink-dark hover:bg-primary/10"
                    >
                      Mark read
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {webPush.status !== 'granted' && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-info/30 bg-info/5 p-3.5 text-sm text-content-muted dark:text-content-muted-dark">
          <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden="true" />
          <p>
            Push notifications need permission from the browser. Without it, notifications
            still arrive in this list and by email — nothing is lost, it just is not
            instant.
          </p>
        </div>
      )}
    </div>
  );
}
