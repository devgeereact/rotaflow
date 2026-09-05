import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import {
  discardDeadLetteredWrite,
  retryDeadLetteredWrite,
  enqueueWrite,
  flushQueuedWrites,
  listDeadLetteredWrites,
  listQueuedWrites,
  type FlushResult,
} from '@/services/syncQueue';
import { reportError } from '@/lib/sentry';
import type { DeadLetterRecord, OutboxKind, OutboxRecord } from '@/lib/offlineOutbox';

export type QueuedItem = OutboxRecord;

export interface UseSyncQueue {
  /** Writes still waiting to reach Supabase. */
  pending: QueuedItem[];
  /**
   * Writes that will never send themselves. Permanently rejected, or out of
   * retries. These need a human: the action did not happen, and the person who
   * took it still believes it did.
   */
  deadLettered: DeadLetterRecord[];
  enqueue: (kind: OutboxKind, payload: unknown) => Promise<void>;
  flush: () => Promise<FlushResult>;
  /** Acknowledge a failed write and remove it from the review list. */
  discard: (id: string) => Promise<void>;
  /** Put a dead-lettered write back in the queue and try it again (CAP-016). */
  retry: (id: string) => Promise<void>;
  syncing: boolean;
}

/**
 * Consumer of the IndexedDB write outbox. See docs/HOOKS.md §8 for the
 * approved contract this implements, and services/syncQueue.ts for the replay
 * logic. Used by the clock-in, leave and swap screens.
 *
 * `deadLettered` is not optional decoration. The outbox's failure mode is that
 * a write is accepted into IndexedDB, reported to the user as done, and then
 * never lands. If nothing renders this list the app is back to failing
 * silently, which was the original bug. See `flushQueuedWrites`.
 */
export function useSyncQueue(): UseSyncQueue {
  const online = useOnlineStatus();
  // The outbox is per-origin, not per-account, and survives a sign-out. Every
  // operation below is scoped to the signed-in user so a shared device never
  // replays, or shows, somebody else's writes. See `belongsTo` in
  // services/syncQueue.ts for what that prevents.
  const { user } = useSupabaseAuth();
  const userId = user?.id ?? null;
  const [pending, setPending] = useState<QueuedItem[]>([]);
  const [deadLettered, setDeadLettered] = useState<DeadLetterRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  // Guards against overlapping flushes. E.g. the reconnect effect firing
  // while a manually-triggered flush from the UI is still in flight.
  const flushing = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!userId) {
      setPending([]);
      setDeadLettered([]);
      return;
    }
    try {
      const [queued, dead] = await Promise.all([
        listQueuedWrites(userId),
        listDeadLetteredWrites(userId),
      ]);
      setPending(queued);
      setDeadLettered(dead);
    } catch (err) {
      reportError(err, { area: 'syncQueue:list' });
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flush = useCallback(async (): Promise<FlushResult> => {
    if (!userId || flushing.current) return { synced: 0, failed: 0, deadLettered: 0 };
    flushing.current = true;
    setSyncing(true);
    try {
      const result = await flushQueuedWrites(userId);
      await refresh();
      return result;
    } finally {
      setSyncing(false);
      flushing.current = false;
    }
  }, [refresh, userId]);

  // Auto-flush on reconnect, on an online start with work already queued, and
  // when the app comes back to the foreground.
  //
  // Reconnect alone was not enough, and this was RF-06. The offline-to-online
  // transition only fires while the hook is mounted, so the ordinary case —
  // clock in on a ward with no signal, close the app, walk somewhere with
  // signal, open it again — never triggered a flush at all. The event that
  // would have fired happened while the app was closed. The pending list was
  // loaded and rendered, so the person could see their clock-in sitting there,
  // and nothing sent it. On a phone that had been closed overnight that is a
  // shift recorded nowhere but one device.
  //
  // The original comment here worried about opening an IndexedDB transaction
  // on every cold boot. `refresh` has already opened one by this point and
  // `pending` is its result, so the mount flush costs nothing when the queue
  // is empty — which is the common case it was protecting.
  const wasOnline = useRef(online);
  const startupFlushed = useRef(false);
  useEffect(() => {
    const reconnected = online && !wasOnline.current;
    wasOnline.current = online;

    if (reconnected) {
      startupFlushed.current = true;
      void flush();
      return;
    }

    // Started (or signed in) already online with work waiting.
    if (online && !startupFlushed.current && pending.length > 0) {
      startupFlushed.current = true;
      void flush();
    }
  }, [online, flush, pending.length]);

  // Foreground recovery. A phone that was backgrounded mid-flush, or woken in
  // a different place with signal, fires neither an `online` event nor a
  // remount — iOS in particular freezes a backgrounded tab rather than
  // unloading it, so `visibilitychange` is the only signal that the app is
  // being used again.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void flush();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [flush]);

  const enqueue = useCallback(
    async (kind: OutboxKind, payload: unknown): Promise<void> => {
      // No session, nothing to attribute the write to. Every caller is inside
      // ProtectedRoute, so this is unreachable in practice; queueing an
      // unowned write would be worse than refusing one.
      if (!userId) throw new Error('Cannot queue a write without a signed-in user');
      await enqueueWrite(kind, payload, userId);
      await refresh();
    },
    [refresh, userId],
  );

  const discard = useCallback(
    async (id: string): Promise<void> => {
      await discardDeadLetteredWrite(id);
      await refresh();
    },
    [refresh],
  );

  // Safe to repeat because of the idempotency keys (0081): a write that did
  // land the first time is recognised and marked synced rather than inserted
  // twice. Without those, a retry button would be a way to double-clock
  // somebody.
  const retry = useCallback(
    async (id: string): Promise<void> => {
      if (!userId) return;
      await retryDeadLetteredWrite(id, userId);
      await refresh();
    },
    [refresh, userId],
  );

  return { pending, deadLettered, enqueue, flush, discard, retry, syncing };
}
