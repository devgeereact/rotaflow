import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { countMyUnreadNotifications } from '@/services/notificationService';
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
      void countMyUnreadNotifications(user.id)
        .then((count) => {
          if (active) setUnreadCount(count);
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
      className="relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-surface-border bg-surface text-content-muted hover:bg-surface-subtle hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark dark:hover:text-content-dark"
    >
      <Bell size={17} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className="absolute right-[5px] top-[5px] h-[7px] w-[7px] rounded-full border-[1.5px] border-surface bg-danger dark:border-surface-dark" />
      )}
    </Link>
  );
}
