import {
  deadLetterList,
  deadLetterRemove,
  outboxAdd,
  outboxList,
  outboxMoveToDeadLetter,
  outboxRemove,
  outboxUpdate,
  type DeadLetterRecord,
  type OutboxKind,
  type OutboxRecord,
} from '@/lib/offlineOutbox';
import { recordClockEvent } from '@/services/clockService';
import { createLeaveRequest } from '@/services/leaveService';
import { requestShiftSwap } from '@/services/swapService';
import {
  postInngestEvent,
  type InngestEventPayload,
} from '@/services/notificationDispatchService';
import { reportError } from '@/lib/sentry';
import type { ClockEventInsert, LeaveRequestInsert, ShiftSwapInsert } from '@/types';

/**
 * The offline write outbox (ARCHITECTURE.md §4/§6, docs/HOOKS.md §8).
 *
 * A write made with no connection is appended here instead of failing. On
 * reconnect (`useSyncQueue`, driven by `useOnlineStatus`), every queued item
 * replays against Supabase in the order it was made and is removed once it
 * lands. Nothing here is a full offline-first data layer. It is a durable
 * queue for a small, fixed set of write shapes.
 */

/** Maps a queued kind to the real insert it replays as. Extend this, and the
 * `OutboxKind` union in offlineOutbox.ts, together when a new offline write
 * is added, never let them drift apart. */
const REPLAYERS: {
  [K in OutboxKind]: (payload: unknown) => Promise<void>;
} = {
  // Each insert function returns the created row (the screens read it back to
  // update UI state on the online path); the replay path only needs to know
  // the write landed, so the row is discarded here.
  clock: (payload) => recordClockEvent(payload as ClockEventInsert).then(() => undefined),
  leave: (payload) =>
    createLeaveRequest(payload as LeaveRequestInsert).then(() => undefined),
  swap: (payload) => requestShiftSwap(payload as ShiftSwapInsert).then(() => undefined),
  // Not a Supabase write. A notification dispatch that failed after its rota,
  // leave or swap write had already landed — see BUG-047 and
  // notificationDispatchService's header. It is queued for the same reason the
  // others are: the work is owed, and dropping it silently is the failure.
  notify: (payload) => postInngestEvent(payload as InngestEventPayload),
};

/**
 * How many times a *transient* failure is retried before the write is set
 * aside. Deliberately generous: each attempt is one reconnect, so five spans
 * days of intermittent ward wifi. It exists to bound an item failing for a
 * reason we could not classify, not to give up on a bad signal.
 */
export const MAX_ATTEMPTS = 5;

export type FailureKind = 'permanent' | 'transient';

/**
 * SQLSTATE classes that mean "try again later" rather than "this write is
 * invalid": connection exceptions (08), transaction rollback. Serialization
 * failures and deadlocks (40), insufficient resources (53), operator
 * intervention (57), system error (58).
 *
 * Everything else with a SQLSTATE. Unique violation, check violation, FK
 * violation, insufficient privilege, is the server refusing this payload, and
 * refusing it a thousand more times cannot help.
 */
const TRANSIENT_SQLSTATE_CLASSES = new Set(['08', '40', '53', '57', '58']);

/** Request timeout, too-early, and rate limited: all worth retrying. */
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Unknown error';
}

/**
 * Decide whether a failed replay is worth retrying.
 *
 * The default for anything unrecognised is **transient**, on purpose. A
 * transient item is retried and then dead-lettered after `MAX_ATTEMPTS`, so it
 * is never lost and never blocks the queue forever. The worst case is a delay.
 * Defaulting to permanent would set aside a write that a retry would have
 * delivered, and that is the outcome that actually costs someone their pay.
 */
export function classifyFailure(error: unknown): FailureKind {
  // A dropped connection: fetch rejects with a TypeError and no status.
  if (error instanceof TypeError) return 'transient';

  const candidate: { status?: unknown; code?: unknown } | null =
    error && typeof error === 'object' ? error : null;

  if (candidate && typeof candidate.status === 'number') {
    const { status } = candidate;
    if (status >= 500 || TRANSIENT_HTTP_STATUSES.has(status)) return 'transient';
    // Any other 4xx is the server rejecting this specific payload.
    if (status >= 400) return 'permanent';
  }

  if (candidate && typeof candidate.code === 'string') {
    const { code } = candidate;

    // PostgREST's own codes. PGRST301 is an expired/invalid JWT. Recoverable
    // once supabase-js refreshes the session, so retry rather than discard a
    // clock-in because a token aged out while the device was in a pocket.
    if (code === 'PGRST301') return 'transient';
    if (code.startsWith('PGRST')) return 'permanent';

    // Postgres SQLSTATE: 5 characters, first two are the class.
    if (/^[0-9A-Z]{5}$/.test(code)) {
      return TRANSIENT_SQLSTATE_CLASSES.has(code.slice(0, 2)) ? 'transient' : 'permanent';
    }

    // Node/undici network codes seen through supabase-js.
    if (/^(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED)$/.test(code)) {
      return 'transient';
    }
  }

  return 'transient';
}

export async function enqueueWrite(kind: OutboxKind, payload: unknown): Promise<void> {
  await outboxAdd({
    id: crypto.randomUUID(),
    kind,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
}

export async function listQueuedWrites(): Promise<OutboxRecord[]> {
  return outboxList();
}

export async function listDeadLetteredWrites(): Promise<DeadLetterRecord[]> {
  return deadLetterList();
}

/** Discard a write the user has acknowledged. Only ever from an explicit action. */
export async function discardDeadLetteredWrite(id: string): Promise<void> {
  await deadLetterRemove(id);
}

export interface FlushResult {
  synced: number;
  /** Still queued, will be retried on the next reconnect. */
  failed: number;
  /** Set aside permanently. Needs a human. */
  deadLettered: number;
}

/**
 * Replay every queued write, oldest first.
 *
 * Ordering matters and is why this is a sequential loop rather than a
 * `Promise.all`: a leave request cancelled offline and then re-requested must
 * apply in that order, not whichever round trip finishes first.
 *
 * ## What happens to a failure
 *
 * - **Transient** (offline again, 5xx, rate limited, expired JWT). The item
 *   stays queued, its attempt count goes up, and the flush **stops**. If the
 *   network just dropped, every item after it would fail too; better to leave
 *   them for the next reconnect than burn an attempt on each. After
 *   `MAX_ATTEMPTS` it is dead-lettered rather than retried forever.
 * - **Permanent** (RLS denial, constraint violation, deleted shift). The item
 *   is moved to the dead-letter store and the loop **continues**.
 *
 * That distinction is the whole point of this function. Before it existed,
 * every failure was treated as transient and left in place, so a single
 * permanently-rejected write blocked everything queued behind it forever, on
 * every reconnect, in silence. The UI had reported those writes as accepted,
 * because they were, into IndexedDB. Someone's clock-ins stopped reaching the
 * database and the first anyone knew about it was a wrong payslip.
 *
 * Nothing is ever deleted on failure. A dead-lettered write is kept so the user
 * can see what did not go through and re-enter it.
 */
export async function flushQueuedWrites(): Promise<FlushResult> {
  const items = await outboxList();
  let synced = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const item of items) {
    try {
      await REPLAYERS[item.kind](item.payload);
      await outboxRemove(item.id);
      synced++;
      continue;
    } catch (err) {
      const failureKind = classifyFailure(err);
      const attempts = item.attempts + 1;
      const lastError = messageOf(err);

      reportError(err, {
        area: 'syncQueue:flush',
        kind: item.kind,
        failureKind,
        attempts,
      });

      const giveUp = failureKind === 'permanent' || attempts >= MAX_ATTEMPTS;

      if (giveUp) {
        await outboxMoveToDeadLetter({
          ...item,
          attempts,
          lastError,
          failedAt: new Date().toISOString(),
          reason: failureKind === 'permanent' ? 'permanent' : 'exhausted',
        });
        deadLettered++;

        // A permanent rejection says nothing about the next item, so keep
        // draining. An exhausted one almost certainly ran out of attempts
        // because the network is still down, so stop for the same reason a
        // transient failure stops.
        if (failureKind === 'permanent') continue;
        break;
      }

      await outboxUpdate({ ...item, attempts, lastError });
      failed++;
      break;
    }
  }

  return { synced, failed, deadLettered };
}
