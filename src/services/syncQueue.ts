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
  // Retired (HARDEN-008). Nothing enqueues this: every dispatch moved into
  // the database in 0087, and the Inngest endpoint this used to post to is
  // deleted.
  //
  // It resolves instead of throwing, so a `notify` item queued by an older
  // install DRAINS AWAY on the next reconnect rather than retrying five times
  // against a host that no longer exists and then sitting in the dead-letter
  // list as an error the user can do nothing about. The work is not lost —
  // it is no longer owed, because the event that owed it now enqueues its own
  // notification server-side.
  notify: () => Promise.resolve(),
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

/**
 * The index names 0081 creates, one per table the outbox replays into.
 *
 * A 23505 naming one of these means the row is already there — the write
 * landed and we are replaying it — which is success. A 23505 from any other
 * constraint is a real rejection and must still dead-letter, so this matches
 * on the name rather than on the code alone.
 */
const IDEMPOTENCY_INDEXES = [
  'clock_events_client_event_id_key',
  'leave_requests_client_event_id_key',
  'shift_swaps_client_event_id_key',
];

/** Did this replay collide with its own earlier, successful insert? */
export function isAlreadyApplied(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  if (!e || e.code !== '23505') return false;
  // Only genuine strings. PostgREST sends both as text, and coercing an
  // unexpected object would produce "[object Object]" and match nothing —
  // silently turning a recognisable collision into a dead letter.
  const text = [e.message, e.details]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  return IDEMPOTENCY_INDEXES.some((name) => text.includes(name));
}

/**
 * Attach an idempotency key to a payload that does not already carry one.
 *
 * `notify` is excluded: it posted an event rather than inserting a row, so
 * there was no unique index to collide with and an unexpected column would
 * just have ridden along in the event body. The handler is retired (see
 * above) and drains away; the exclusion stays so an item queued by an older
 * install is still recognised.
 *
 * A caller that mints its own key BEFORE its first online attempt — which
 * `ClockInPage` does — keeps it here, and that is the case that matters: a
 * write whose response was lost is already in Postgres under that key, so the
 * replay collides instead of duplicating. Stamping only at enqueue time would
 * close the smaller hole and leave the larger one open.
 */
function withIdempotencyKey(kind: OutboxKind, payload: unknown): unknown {
  if (kind === 'notify') return payload;
  if (payload === null || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  if (typeof record['client_event_id'] === 'string') return payload;
  return { ...record, client_event_id: crypto.randomUUID() };
}

export async function enqueueWrite(kind: OutboxKind, payload: unknown): Promise<void> {
  await outboxAdd({
    id: crypto.randomUUID(),
    kind,
    payload: withIdempotencyKey(kind, payload),
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

/**
 * Put a dead-lettered write back in the queue and try it again (CAP-016).
 *
 * Until now the only thing a person could do with a failed write was
 * acknowledge it. That is the right FLOOR — a silent loss is the worst
 * outcome — but it leaves the common case unserved: the write failed for a
 * reason that has since gone away. A clock-in refused while a shift had not
 * been published yet, a leave request made against a location that was being
 * renamed, five attempts spent on a ward's wifi during a handover. In every
 * one of those the payload is still correct and the only thing wrong was the
 * moment.
 *
 * Retrying is safe because of the idempotency keys (0081): a write that
 * actually did land the first time is recognised by `isAlreadyApplied` and
 * marked synced rather than inserted twice. Without those this would be an
 * invitation to double-clock somebody, which is why the retry button is
 * arriving after them and not before.
 *
 * The attempt counter resets. The five attempts already spent were against a
 * condition the person has decided has changed, and carrying them over would
 * mean a retry that gets one try — which is not a retry.
 */
export async function retryDeadLetteredWrite(id: string): Promise<FlushResult> {
  const items = await deadLetterList();
  const item = items.find((record) => record.id === id);
  if (!item) return { synced: 0, failed: 0, deadLettered: 0 };

  // Requeue FIRST, then remove. The other order can lose the write entirely if
  // the tab closes between the two — and losing it is the one outcome this
  // whole subsystem exists to prevent.
  await outboxAdd({
    id: crypto.randomUUID(),
    kind: item.kind,
    // The payload keeps its existing idempotency key: that is what makes a
    // retry of something that secretly succeeded a no-op rather than a
    // duplicate.
    payload: item.payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  await deadLetterRemove(id);

  return flushQueuedWrites();
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
      // The row is already there under this item's key, so the write landed —
      // on an earlier replay whose `outboxRemove` never ran, or on an online
      // attempt whose response was lost. Either way the work is done and the
      // item should leave the queue. Without this it would dead-letter, since
      // 23505 classifies as permanent, and the person would be told a clock-in
      // failed that is sitting in their timesheet.
      if (isAlreadyApplied(err)) {
        await outboxRemove(item.id);
        synced++;
        continue;
      }

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
