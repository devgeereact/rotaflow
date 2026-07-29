import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  enqueueWrite,
  flushQueuedWrites,
  listQueuedWrites,
  type FlushResult,
} from '@/services/syncQueue';
import { reportError } from '@/lib/sentry';
import type { OutboxKind } from '@/lib/offlineOutbox';

export interface QueuedItem {
  id: string;
  kind: OutboxKind;
  payload: unknown;
  queuedAt: string;
}

export interface UseSyncQueue {
  pending: QueuedItem[];
  enqueue: (kind: QueuedItem['kind'], payload: unknown) => Promise<void>;
  flush: () => Promise<FlushResult>;
  syncing: boolean;
}

/**
 * Consumer of the IndexedDB write outbox — see docs/HOOKS.md §8 for the
 * approved contract this implements, and services/syncQueue.ts for the
 * replay logic. No screen calls `enqueue` yet: clock-in, leave and swap
 * requests are Phase 5/6. This hook exists now so those phases have a tested,
 * working outbox to write against on day one rather than building one
 * alongside the first screen that needs it.
 */
export function useSyncQueue(): UseSyncQueue {
  const online = useOnlineStatus();
  const [pending, setPending] = useState<QueuedItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  // Guards against overlapping flushes — e.g. the reconnect effect firing
  // while a manually-triggered flush from the UI is still in flight.
  const flushing = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setPending(await listQueuedWrites());
    } catch (err) {
      reportError(err, { area: 'syncQueue:list' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flush = useCallback(async (): Promise<FlushResult> => {
    if (flushing.current) return { synced: 0, failed: 0 };
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
    async (kind: QueuedItem['kind'], payload: unknown): Promise<void> => {
      await enqueueWrite(kind, payload);
      await refresh();
    },
    [refresh],
  );

  return { pending, enqueue, flush, syncing };
}
