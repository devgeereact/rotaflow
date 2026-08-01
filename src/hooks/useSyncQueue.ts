import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  discardDeadLetteredWrite,
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
   * Writes that will never send themselves — permanently rejected, or out of
   * retries. These need a human: the action did not happen, and the person who
   * took it still believes it did.
   */
  deadLettered: DeadLetterRecord[];
  enqueue: (kind: OutboxKind, payload: unknown) => Promise<void>;
  flush: () => Promise<FlushResult>;
  /** Acknowledge a failed write and remove it from the review list. */
  discard: (id: string) => Promise<void>;
  syncing: boolean;
}

/**
 * Consumer of the IndexedDB write outbox — see docs/HOOKS.md §8 for the
 * approved contract this implements, and services/syncQueue.ts for the replay
 * logic. Used by the clock-in, leave and swap screens.
 *
 * `deadLettered` is not optional decoration. The outbox's failure mode is that
 * a write is accepted into IndexedDB, reported to the user as done, and then
 * never lands. If nothing renders this list the app is back to failing
 * silently, which was the original bug — see `flushQueuedWrites`.
 */
export function useSyncQueue(): UseSyncQueue {
  const online = useOnlineStatus();
  const [pending, setPending] = useState<QueuedItem[]>([]);
  const [deadLettered, setDeadLettered] = useState<DeadLetterRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  // Guards against overlapping flushes — e.g. the reconnect effect firing
  // while a manually-triggered flush from the UI is still in flight.
  const flushing = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [queued, dead] = await Promise.all([
        listQueuedWrites(),
        listDeadLetteredWrites(),
      ]);
      setPending(queued);
      setDeadLettered(dead);
    } catch (err) {
      reportError(err, { area: 'syncQueue:list' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flush = useCallback(async (): Promise<FlushResult> => {
    if (flushing.current) return { synced: 0, failed: 0, deadLettered: 0 };
    flushing.current = true;
    setSyncing(true);
    try {
      const result = await flushQueuedWrites();
      await refresh();
      return result;
    } finally {
      setSyncing(false);
      flushing.current = false;
    }
  }, [refresh]);

  // Auto-flush on reconnect. Not on mount while online: a cold boot with
  // nothing queued would otherwise open an IndexedDB transaction for no
  // reason on every page load.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) {
      void flush();
    }
    wasOnline.current = online;
  }, [online, flush]);

  const enqueue = useCallback(
    async (kind: OutboxKind, payload: unknown): Promise<void> => {
      await enqueueWrite(kind, payload);
      await refresh();
    },
    [refresh],
  );

  const discard = useCallback(
    async (id: string): Promise<void> => {
      await discardDeadLetteredWrite(id);
      await refresh();
    },
    [refresh],
  );

  return { pending, deadLettered, enqueue, flush, discard, syncing };
}
