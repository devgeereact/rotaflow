import { useEffect, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/sentry';

/** Tables published to Realtime by `0012_realtime.sql` and `0013_realtime_overtime.sql`. */
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
  /** True once the channel is subscribed. Screens work fine without it. */
  connected: boolean;
}

/**
 * Bursts of writes are normal here. Publishing a week's rota inserts every
 * shift at once. Collapsing them into one refetch is the difference between
 * one query and fifty.
 */
const DEBOUNCE_MS = 300;

/**
 * Refresh a screen when someone else changes the data behind it.
 *
 * **The payload is deliberately ignored.** An event is treated purely as a
 * "something changed" signal, and the caller re-queries through its normal
 * RLS-protected path. That is a security decision, not laziness: Realtime
 * does apply RLS to `postgres_changes`, but DELETE payloads carry only the
 * primary key and cannot be filtered the way INSERT/UPDATE are. Never
 * rendering the payload means there is no path by which a row the caller
 * could not otherwise read reaches the screen. The data always arrives
 * through a query the database has already authorised.
 *
 * Failure is non-fatal by design. If the socket never connects, every screen
 * still loads and refetches exactly as it did before; live updates are an
 * enhancement layered on top, never a dependency.
 */
export function useRealtimeRefresh({
  tables,
  scope,
  onChange,
  enabled = true,
}: UseRealtimeRefreshOptions): UseRealtimeRefresh {
  const [connected, setConnected] = useState(false);
  const { column: scopeColumn, value: scopeValue } = scope;

  // Callers pass an inline arrow; without a ref, every render would tear the
  // channel down and rebuild it.
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

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = (): void => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChangeRef.current(), DEBOUNCE_MS);
    };

    // Unique per (scope, table set) so two screens listening to different
    // tables never collide on a channel name.
    const channel = supabase.channel(`realtime-refresh:${scopeValue}:${tableKey}`);

    for (const table of tableKey.split(',')) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `${scopeColumn}=eq.${scopeValue}`,
        },
        scheduleRefresh,
      );
    }

    channel.subscribe((status) => {
      setConnected(status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
      if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
        // Worth knowing about, but not worth interrupting anyone over: the
        // screen still works, it just stops updating on its own.
        reportError(new Error(`Realtime channel error for ${tableKey}`), {
          area: 'realtime:subscribe',
          tables: tableKey,
        });
      }
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
      setConnected(false);
    };
  }, [scopeColumn, scopeValue, tableKey, enabled]);

  return { connected };
}
