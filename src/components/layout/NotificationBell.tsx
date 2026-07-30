import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { listMyNotifications } from '@/services/notificationService';
import { reportError } from '@/lib/sentry';

const POLL_MS = 60_000;

/**
 * Unread-count badge in the app header. Polls rather than subscribing to
 * Supabase Realtime: a 60s-stale count is a fine trade-off against holding a
 * websocket open on every authenticated tab, and Realtime wiring for one
 * badge is more infrastructure than this warrants right now.
 */
export function NotificationBell(): JSX.Element {
  const { user } = useSupabaseAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;

    const refresh = (): void => {
      void listMyNotifications(user.id)
        .then((rows) => {
          if (active) setUnreadCount(rows.filter((n) => !n.read_at).length);
        })
        .catch((err: unknown) => reportError(err, { area: 'notificationBell:poll' }));
    };

    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user]);

  return (
    <Link
      to="/app/notifications"
      aria-label={
        unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
      }
      className="relative rounded-lg p-2 text-content-muted hover:bg-surface-subtle hover:text-content dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark"
    >
      <Bell size={18} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.65rem] font-semibold text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
