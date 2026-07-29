import {
  outboxAdd,
  outboxList,
  outboxRemove,
  type OutboxKind,
  type OutboxRecord,
} from '@/lib/offlineOutbox';
import { recordClockEvent } from '@/services/clockService';
import { createLeaveRequest } from '@/services/leaveService';
import { requestShiftSwap } from '@/services/swapService';
import { reportError } from '@/lib/sentry';
import type { ClockEventInsert, LeaveRequestInsert, ShiftSwapInsert } from '@/types';

/**
 * The offline write outbox (ARCHITECTURE.md §4/§6, docs/HOOKS.md §8).
 *
 * A write made with no connection is appended here instead of failing. On
 * reconnect (`useSyncQueue`, driven by `useOnlineStatus`), every queued item
 * replays against Supabase in the order it was made and is removed once it
 * lands. Nothing here is a full offline-first data layer — it is a durable
 * queue for a small, fixed set of write shapes.
 */

/** Maps a queued kind to the real insert it replays as. Extend this, and the
 * `OutboxKind` union in offlineOutbox.ts, together when a new offline write
 * is added — never let them drift apart. */
const REPLAYERS: {
  [K in OutboxKind]: (payload: unknown) => Promise<void>;
} = {
  clock: (payload) => recordClockEvent(payload as ClockEventInsert),
  leave: (payload) => createLeaveRequest(payload as LeaveRequestInsert),
  swap: (payload) => requestShiftSwap(payload as ShiftSwapInsert),
};

export async function enqueueWrite(kind: OutboxKind, payload: unknown): Promise<void> {
  await outboxAdd({
    id: crypto.randomUUID(),
    kind,
    payload,
    queuedAt: new Date().toISOString(),
  });
}

export async function listQueuedWrites(): Promise<OutboxRecord[]> {
  return outboxList();
}

export interface FlushResult {
  synced: number;
  failed: number;
}

/**
 * Replay every queued write, oldest first, stopping at the first item that is
 * still un-syncable (still offline, or a real server rejection) rather than
 * racing every item in parallel. Parallel replay could land writes out of
 * order — e.g. a leave request cancelled offline then re-requested must apply
 * in that order, not whichever request's round trip finishes first.
 *
 * A failed item is left in the outbox (not silently dropped) so the next
 * reconnect retries it; the caller decides whether/how to surface `failed` to
 * the user.
 */
export async function flushQueuedWrites(): Promise<FlushResult> {
  const items = await outboxList();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await REPLAYERS[item.kind](item.payload);
      await outboxRemove(item.id);
      synced++;
    } catch (err) {
      reportError(err, { area: 'syncQueue:flush', kind: item.kind });
      failed++;
      // Stop at the first failure. If it failed because connectivity dropped
      // again mid-flush, every item after it would fail too — better to leave
      // them queued for the next reconnect than burn a failed attempt on each.
      break;
    }
  }

  return { synced, failed };
}
