import { useEffect, useRef, useState } from 'react';

/** The tables a screen can ask to be refreshed for. */
export type RealtimeTable =
  | 'shifts'
  | 'rotas'
  | 'leave_requests'
  | 'overtime_requests'
  | 'shift_swaps'
  | 'notifications'
  | 'announcements'
  | 'clock_events'
  | 'availability'
  | 'staff_profiles'
  | 'invites'
  | 'locations'
  | 'departments'
  | 'shift_types';

/**
 * Which column narrows the subscription. Almost everything is tenant-scoped
 * on `org_id`, but `notifications` is a personal inbox, a manager must not
 * receive an event for every notification in the organisation, so that
 * screen scopes on `user_id` instead.
 */
export interface RealtimeScope {
  column: 'org_id' | 'user_id';
  value: string | null;
}

export interface UseRealtimeRefreshOptions {
  /** Tables whose changes should refresh this screen. */
  tables: RealtimeTable[];
  /** Narrows the subscription. A null value disables it. */
  scope: RealtimeScope;
  /** Called (debounced) when something changed. Re-query here. See below. */
  onChange: () => void;
  /** Escape hatch for screens that should only listen conditionally. */
  enabled?: boolean;
}

export interface UseRealtimeRefresh {
  /** True while the screen is being refreshed on a timer. Screens work fine without it. */
  connected: boolean;
}

/**
 * How often each table is worth re-reading while the screen is open. The people looking at a rota, a clock-in board or an
 * inbox want it soon; a list of locations or shift types hardly moves. A screen that listens to several tables polls at the
 * fastest of them.
 */
const POLL_MS: Record<RealtimeTable, number> = {
  clock_events: 15_000,
  shifts: 20_000,
  rotas: 20_000,
  notifications: 30_000,
  shift_swaps: 30_000,
  leave_requests: 45_000,
  overtime_requests: 45_000,
  availability: 60_000,
  announcements: 60_000,
  staff_profiles: 60_000,
  invites: 60_000,
  locations: 120_000,
  departments: 120_000,
  shift_types: 120_000,
};

/** A refresh requested by the tab becoming visible or the network returning is delayed this long, so the two events collapse into one. */
const WAKE_DEBOUNCE_MS = 300;

export function pollIntervalFor(tables: readonly RealtimeTable[]): number {
  return tables.length === 0 ? 60_000 : Math.min(...tables.map((t) => POLL_MS[t]));
}

/**
 * Refresh a screen on a timer, so it catches changes other people made.
 *
 * This replaced Supabase Realtime when the back end moved to PHP on shared hosting, where a long-lived socket does not
 * exist. The contract callers rely on is unchanged: `onChange` means "re-query now", and the screen re-queries through its
 * normal authorised path. Nothing from the poll is ever rendered, so there is no route by which data the caller may not
 * read reaches the screen.
 *
 * It only polls while the tab is visible and the browser is online, and it refreshes once when the tab comes back or the
 * network returns, because a backgrounded tab is the commonest way for a rota to be stale. It does not fire on mount: the
 * screen has just loaded its own data.
 */
export function useRealtimeRefresh({
  tables,
  scope,
  onChange,
  enabled = true,
}: UseRealtimeRefreshOptions): UseRealtimeRefresh {
  const [connected, setConnected] = useState(false);
  const { value: scopeValue } = scope;

  // Callers pass an inline arrow; without a ref, every render would restart the timer.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Same problem for the array literal. Depend on its contents, not identity.
  const tableKey = [...tables].sort().join(',');

  useEffect(() => {
    if (!enabled || !scopeValue || tableKey.length === 0) {
      setConnected(false);
      return;
    }
    const interval = pollIntervalFor(tableKey.split(',') as RealtimeTable[]);
    const canRefresh = (): boolean =>
      document.visibilityState === 'visible' && navigator.onLine;

    const timer = setInterval(() => {
      if (canRefresh()) onChangeRef.current();
    }, interval);

    let wakeTimer: ReturnType<typeof setTimeout> | null = null;
    const wake = (): void => {
      if (!canRefresh()) return;
      if (wakeTimer) clearTimeout(wakeTimer);
      wakeTimer = setTimeout(() => onChangeRef.current(), WAKE_DEBOUNCE_MS);
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    setConnected(true);

    return () => {
      clearInterval(timer);
      if (wakeTimer) clearTimeout(wakeTimer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      setConnected(false);
    };
  }, [scopeValue, tableKey, enabled]);

  return { connected };
}
