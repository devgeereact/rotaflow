import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// The replayers are the boundary to Supabase. Mocking them lets these tests
// drive the real IndexedDB code path (via fake-indexeddb) while deciding
// exactly how the server responds, which is the whole subject here.
vi.mock('@/services/clockService', () => ({
  recordClockEvent: vi.fn(),
  getLatestClockEvent: vi.fn(),
  listClockEventsForStaff: vi.fn(),
  listClockEventsForOrg: vi.fn(),
}));
vi.mock('@/services/leaveService', () => ({ createLeaveRequest: vi.fn() }));
vi.mock('@/services/swapService', () => ({ requestShiftSwap: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));

import { recordClockEvent } from '@/services/clockService';
import { outboxAdd } from '@/lib/offlineOutbox';
import {
  MAX_ATTEMPTS,
  classifyFailure,
  discardDeadLetteredWrite,
  enqueueWrite,
  flushQueuedWrites,
  listDeadLetteredWrites,
  retryDeadLetteredWrite,
  listQueuedWrites,
} from '@/services/syncQueue';

const mockedRecordClockEvent = vi.mocked(recordClockEvent);

/**
 * First element, or a clear failure. `noUncheckedIndexedAccess` makes `[0]`
 * possibly-undefined, and a non-null assertion here would turn "the queue was
 * unexpectedly empty" into a confusing property-access error three lines later.
 */
function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('expected at least one item, got none');
  return item;
}

/** A Supabase PostgrestError as it actually arrives at the catch block. */
function postgrestError(code: string, message = 'rejected'): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** What fetch throws with no connection. */
function networkError(): TypeError {
  return new TypeError('Failed to fetch');
}

beforeEach(() => {
  // A fresh database per test. IndexedDB is process-global and would
  // otherwise leak queued items between cases.
  // fake-indexeddb/auto installs a global; swapping it per test is the
  // documented way to get a clean database. eslint sees a read-only global.
  // eslint-disable-next-line no-global-assign
  indexedDB = new IDBFactory();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The outbox is per-origin, not per-account, so every operation is scoped to
 * the signed-in user. One constant stands in for that session throughout;
 * the ownership tests at the end use a second one.
 */
const USER = 'user-a';
const OTHER_USER = 'user-b';

describe('classifyFailure', () => {
  it('treats a dropped connection as transient', () => {
    expect(classifyFailure(networkError())).toBe('transient');
  });

  it('treats server errors and rate limits as transient', () => {
    expect(classifyFailure(httpError(500))).toBe('transient');
    expect(classifyFailure(httpError(503))).toBe('transient');
    expect(classifyFailure(httpError(429))).toBe('transient');
    expect(classifyFailure(httpError(408))).toBe('transient');
  });

  it('treats an expired JWT as transient. The session refreshes itself', () => {
    // Discarding a clock-in because a token aged out while the phone was in
    // someone's pocket would be exactly the wrong call.
    expect(classifyFailure(postgrestError('PGRST301', 'JWT expired'))).toBe('transient');
  });

  it('treats an RLS denial as permanent', () => {
    // 42501 insufficient_privilege. The membership was revoked. Retrying for
    // the rest of time cannot make this succeed.
    expect(classifyFailure(postgrestError('42501'))).toBe('permanent');
  });

  it('treats constraint violations as permanent', () => {
    expect(classifyFailure(postgrestError('23505'))).toBe('permanent'); // unique
    expect(classifyFailure(postgrestError('23514'))).toBe('permanent'); // check
    expect(classifyFailure(postgrestError('23503'))).toBe('permanent'); // FK. Deleted shift
  });

  it('treats a serialization failure as transient', () => {
    // 40001, two writes collided. This one genuinely does succeed on retry.
    expect(classifyFailure(postgrestError('40001'))).toBe('transient');
  });

  it('treats a connection exception as transient', () => {
    expect(classifyFailure(postgrestError('08006'))).toBe('transient');
  });

  it('treats other 4xx as permanent', () => {
    expect(classifyFailure(httpError(400))).toBe('permanent');
    expect(classifyFailure(httpError(403))).toBe('permanent');
  });

  it('defaults to transient for anything unrecognised', () => {
    // The safe default: a transient item is still bounded by MAX_ATTEMPTS, so
    // it is never lost. Defaulting to permanent would throw away writes a
    // retry would have delivered.
    expect(classifyFailure(new Error('something odd'))).toBe('transient');
    expect(classifyFailure(null)).toBe('transient');
    expect(classifyFailure(undefined)).toBe('transient');
    expect(classifyFailure('a string')).toBe('transient');
    expect(classifyFailure({})).toBe('transient');
  });
});

describe('flushQueuedWrites. The happy path', () => {
  it('replays and removes every queued write', async () => {
    mockedRecordClockEvent.mockResolvedValue({} as never);
    await enqueueWrite('clock', { type: 'in' }, USER);
    await enqueueWrite('clock', { type: 'out' }, USER);

    const result = await flushQueuedWrites(USER);

    expect(result).toEqual({ synced: 2, failed: 0, deadLettered: 0 });
    expect(await listQueuedWrites(USER)).toHaveLength(0);
  });

  it('replays oldest first', async () => {
    const seen: unknown[] = [];
    mockedRecordClockEvent.mockImplementation((payload) => {
      seen.push(payload);
      return Promise.resolve({} as never);
    });

    await enqueueWrite('clock', { seq: 1 }, USER);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 }, USER);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 3 }, USER);

    await flushQueuedWrites(USER);

    // `objectContaining`, because `enqueueWrite` now stamps an idempotency key
    // onto every DB-bound payload (BUG-046). Order is what this test is about.
    expect(seen).toEqual([
      expect.objectContaining({ seq: 1 }),
      expect.objectContaining({ seq: 2 }),
      expect.objectContaining({ seq: 3 }),
    ]);
    expect(
      seen.every(
        (p) => typeof (p as { client_event_id?: unknown }).client_event_id === 'string',
      ),
    ).toBe(true);
  });

  it('does nothing with an empty queue', async () => {
    expect(await flushQueuedWrites(USER)).toEqual({
      synced: 0,
      failed: 0,
      deadLettered: 0,
    });
    expect(mockedRecordClockEvent).not.toHaveBeenCalled();
  });
});

describe('flushQueuedWrites, a permanent rejection must not block the queue', () => {
  it('sets the bad write aside and delivers everything behind it', async () => {
    // THE REGRESSION THIS SUITE EXISTS FOR.
    //
    // Old behaviour: the loop broke on the first failure and left the item in
    // place, so this 42501 blocked items 2 and 3 on this reconnect and on
    // every reconnect after it, forever, in silence. The carer's later
    // clock-ins never reached the database and their timesheet was wrong.
    await enqueueWrite('clock', { seq: 1 }, USER);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 }, USER);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 3 }, USER);

    mockedRecordClockEvent.mockImplementation((payload) => {
      if ((payload as unknown as { seq: number }).seq === 1) {
        return Promise.reject(postgrestError('42501'));
      }
      return Promise.resolve({} as never);
    });

    const result = await flushQueuedWrites(USER);

    expect(result.synced).toBe(2);
    expect(result.deadLettered).toBe(1);
    expect(await listQueuedWrites(USER)).toHaveLength(0);

    const dead = await listDeadLetteredWrites(USER);
    expect(dead).toHaveLength(1);
    expect(first(dead).payload).toEqual(expect.objectContaining({ seq: 1 }));
    expect(first(dead).reason).toBe('permanent');
  });

  it('never deletes the rejected write. It is kept for the user', async () => {
    // Losing it silently would be no better than the deadlock it replaced.
    await enqueueWrite('clock', { shiftId: 'deleted-shift' }, USER);
    mockedRecordClockEvent.mockRejectedValue(postgrestError('23503'));

    await flushQueuedWrites(USER);

    const dead = await listDeadLetteredWrites(USER);
    expect(dead).toHaveLength(1);
    expect(first(dead).payload).toEqual(
      expect.objectContaining({ shiftId: 'deleted-shift' }),
    );
    expect(first(dead).lastError).toBeTruthy();
    expect(first(dead).failedAt).toBeTruthy();
  });

  it('drains a queue where several writes are individually rejected', async () => {
    for (const seq of [1, 2, 3, 4]) {
      await enqueueWrite('clock', { seq }, USER);
      await new Promise((r) => setTimeout(r, 2));
    }
    mockedRecordClockEvent.mockImplementation((payload) => {
      const { seq } = payload as unknown as { seq: number };
      if (seq % 2 === 1) return Promise.reject(postgrestError('23505'));
      return Promise.resolve({} as never);
    });

    const result = await flushQueuedWrites(USER);

    expect(result.synced).toBe(2);
    expect(result.deadLettered).toBe(2);
    expect(await listQueuedWrites(USER)).toHaveLength(0);
  });

  it('leaves the queue empty and stable across repeated flushes', async () => {
    await enqueueWrite('clock', { seq: 1 }, USER);
    mockedRecordClockEvent.mockRejectedValue(postgrestError('42501'));

    await flushQueuedWrites(USER);
    const second = await flushQueuedWrites(USER);

    // The old code would have retried the same doomed item here, forever.
    expect(second).toEqual({ synced: 0, failed: 0, deadLettered: 0 });
    expect(await listDeadLetteredWrites(USER)).toHaveLength(1);
  });
});

describe('flushQueuedWrites, a transient failure is retried, then bounded', () => {
  it('keeps the write queued and stops the flush', async () => {
    await enqueueWrite('clock', { seq: 1 }, USER);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 }, USER);

    mockedRecordClockEvent.mockRejectedValue(networkError());

    const result = await flushQueuedWrites(USER);

    expect(result).toEqual({ synced: 0, failed: 1, deadLettered: 0 });
    // Both still queued: stopping early is correct when the network dropped.
    expect(await listQueuedWrites(USER)).toHaveLength(2);
    // Only one attempt was burned, not one per item.
    expect(mockedRecordClockEvent).toHaveBeenCalledTimes(1);
  });

  it('counts attempts across reconnects', async () => {
    await enqueueWrite('clock', { seq: 1 }, USER);
    mockedRecordClockEvent.mockRejectedValue(networkError());

    await flushQueuedWrites(USER);
    expect(first(await listQueuedWrites(USER)).attempts).toBe(1);

    await flushQueuedWrites(USER);
    expect(first(await listQueuedWrites(USER)).attempts).toBe(2);
  });

  it('delivers the write once the network returns', async () => {
    await enqueueWrite('clock', { seq: 1 }, USER);

    mockedRecordClockEvent.mockRejectedValueOnce(networkError());
    await flushQueuedWrites(USER);
    expect(await listQueuedWrites(USER)).toHaveLength(1);

    mockedRecordClockEvent.mockResolvedValue({} as never);
    const result = await flushQueuedWrites(USER);

    expect(result.synced).toBe(1);
    expect(await listQueuedWrites(USER)).toHaveLength(0);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(0);
  });

  it('dead-letters after MAX_ATTEMPTS rather than retrying forever', async () => {
    await enqueueWrite('clock', { seq: 1 }, USER);
    mockedRecordClockEvent.mockRejectedValue(new Error('unclassifiable'));

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await flushQueuedWrites(USER);
    }

    expect(await listQueuedWrites(USER)).toHaveLength(0);
    const dead = await listDeadLetteredWrites(USER);
    expect(dead).toHaveLength(1);
    expect(first(dead).reason).toBe('exhausted');
    expect(first(dead).attempts).toBe(MAX_ATTEMPTS);
  });

  it('does not let an exhausted item strand the ones behind it', async () => {
    await enqueueWrite('clock', { seq: 1 }, USER);
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 }, USER);

    mockedRecordClockEvent.mockImplementation((payload) => {
      if ((payload as unknown as { seq: number }).seq === 1) {
        return Promise.reject(new Error('unclassifiable'));
      }
      return Promise.resolve({} as never);
    });

    // Burn item 1's attempts.
    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushQueuedWrites(USER);

    // Item 2 was blocked while item 1 retried. Correct, that is the transient
    // policy, but once item 1 is set aside the next flush must deliver it.
    const result = await flushQueuedWrites(USER);

    expect(result.synced).toBe(1);
    expect(await listQueuedWrites(USER)).toHaveLength(0);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(1);
  });
});

describe('dead letters', () => {
  it('survive until explicitly discarded', async () => {
    await enqueueWrite('clock', { seq: 1 }, USER);
    mockedRecordClockEvent.mockRejectedValue(postgrestError('42501'));
    await flushQueuedWrites(USER);

    const dead = first(await listDeadLetteredWrites(USER));
    expect(dead).toBeDefined();

    await flushQueuedWrites(USER);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(1);

    await discardDeadLetteredWrite(dead.id);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(0);
  });

  it('keep enough context to re-enter the write by hand', async () => {
    await enqueueWrite('clock', { type: 'in', event_at: '2026-06-15T09:00:00Z' }, USER);
    mockedRecordClockEvent.mockRejectedValue(
      postgrestError('42501', 'permission denied'),
    );
    await flushQueuedWrites(USER);

    const dead = first(await listDeadLetteredWrites(USER));
    expect(dead.kind).toBe('clock');
    expect(dead.payload).toEqual(
      expect.objectContaining({ type: 'in', event_at: '2026-06-15T09:00:00Z' }),
    );
    expect(dead.queuedAt).toBeTruthy();
    expect(dead.lastError).toContain('permission denied');
  });
});

describe('idempotency (BUG-046)', () => {
  it('stamps a key on a DB-bound payload so a replay can collide instead of duplicating', async () => {
    await enqueueWrite('leave', { start_date: '2026-06-15' }, USER);
    const [item] = await listQueuedWrites(USER);
    const payload = item?.payload as { client_event_id?: unknown };
    expect(typeof payload.client_event_id).toBe('string');
  });

  it('keeps a key the caller minted before its own online attempt', async () => {
    // The case that matters: ClockInPage generates the key BEFORE trying the
    // network, so a write whose response was lost is already in Postgres under
    // it. Overwriting here would reopen exactly the hole this closes.
    await enqueueWrite(
      'clock',
      { type: 'in', client_event_id: 'minted-by-caller' },
      USER,
    );
    const [item] = await listQueuedWrites(USER);
    expect((item?.payload as { client_event_id?: unknown }).client_event_id).toBe(
      'minted-by-caller',
    );
  });

  it('leaves a notify payload alone — it is not a table write', async () => {
    // `notify` is retired (HARDEN-008) and nothing enqueues it any more, but an
    // older install may still hold one, so the shape must keep round-tripping.
    await enqueueWrite('notify', { name: 'leave/reviewed', data: {} }, USER);
    const [item] = await listQueuedWrites(USER);
    expect(item?.payload).toEqual({ name: 'leave/reviewed', data: {} });
  });

  it('treats "already applied" as synced, not as a dead letter', async () => {
    // 23505 classifies as permanent, so without this the person would be told a
    // clock-in failed that is sitting in their timesheet.
    await enqueueWrite('clock', { type: 'in' }, USER);
    mockedRecordClockEvent.mockRejectedValue(
      postgrestError(
        '23505',
        'duplicate key value violates unique constraint "clock_events_client_event_id_key"',
      ),
    );

    const result = await flushQueuedWrites(USER);

    expect(result.synced).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(await listQueuedWrites(USER)).toHaveLength(0);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(0);
  });

  it('still dead-letters a unique violation from a different constraint', async () => {
    await enqueueWrite('clock', { type: 'in' }, USER);
    mockedRecordClockEvent.mockRejectedValue(
      postgrestError(
        '23505',
        'duplicate key value violates unique constraint "memberships_org_id_user_id_key"',
      ),
    );

    const result = await flushQueuedWrites(USER);

    expect(result.synced).toBe(0);
    expect(result.deadLettered).toBe(1);
  });
});

describe('enqueueWrite', () => {
  it('starts a write at zero attempts', async () => {
    await enqueueWrite('leave', { start_date: '2026-06-15' }, USER);
    const item = first(await listQueuedWrites(USER));
    expect(item.attempts).toBe(0);
    expect(item.kind).toBe('leave');
  });
});

describe('classifyFailure, on an HTTP status', () => {
  // `classifyFailure` duck-types on `.status` rather than on any error class,
  // which is why deleting `InngestDispatchError` with the Inngest path
  // (HARDEN-008) costs these tests nothing: the rule under test is "which
  // status codes deserve another attempt", and it still applies to every
  // Supabase and fetch failure the outbox sees.
  const httpError = (message: string, status: number): Error & { status: number } =>
    Object.assign(new Error(message), { status });

  it('retries a 5xx — the far end being down is not our payload being wrong', () => {
    expect(classifyFailure(httpError('down', 503))).toBe('transient');
  });

  it('retries a dropped or blocked request', () => {
    // A content blocker rejects as a TypeError with no status, which is
    // indistinguishable from a dropped connection — both deserve another go.
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('transient');
  });

  it('does not retry a rejected payload', () => {
    expect(classifyFailure(httpError('bad request', 400))).toBe('permanent');
  });
});

describe('retryDeadLetteredWrite (CAP-016)', () => {
  it('delivers a write whose reason for failing has gone away', async () => {
    // The common case, and the one the dismiss-only notice could not serve:
    // the payload was always correct and only the moment was wrong — a ward's
    // wifi during handover, a shift published a minute later.
    await enqueueWrite('clock', { seq: 1 }, USER);
    mockedRecordClockEvent.mockRejectedValue(postgrestError('42501'));
    await flushQueuedWrites(USER);

    const [dead] = await listDeadLetteredWrites(USER);
    expect(dead).toBeDefined();

    mockedRecordClockEvent.mockResolvedValue({} as never);
    const result = await retryDeadLetteredWrite(dead!.id, USER);

    expect(result.synced).toBe(1);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(0);
    expect(await listQueuedWrites(USER)).toHaveLength(0);
  });

  it('keeps the idempotency key, so a retry of something that did land is not a double', async () => {
    // This is why the button arrives AFTER 0081 and not before. Without the
    // key surviving the requeue, "try again" on a clock-in that secretly
    // succeeded would be a way to clock somebody in twice.
    await enqueueWrite('clock', { type: 'in' }, USER);
    mockedRecordClockEvent.mockRejectedValue(postgrestError('42501'));
    await flushQueuedWrites(USER);

    const [dead] = await listDeadLetteredWrites(USER);
    const keyBefore = (dead!.payload as { client_event_id?: string }).client_event_id;
    expect(keyBefore).toBeTruthy();

    mockedRecordClockEvent.mockResolvedValue({} as never);
    await retryDeadLetteredWrite(dead!.id, USER);

    // Indexed rather than `.at(-1)`: the tsconfig target is ES2021, where
    // `Array.prototype.at` does not exist. Raising the target for one test
    // would be the tail wagging the dog.
    const calls = mockedRecordClockEvent.mock.calls;
    const sent = calls[calls.length - 1]?.[0] as { client_event_id?: string };
    expect(sent.client_event_id).toBe(keyBefore);
  });

  it('puts it back in the dead-letter list if it fails again', async () => {
    // A retry is not a promise. What it must not do is lose the write on the
    // way through — requeue happens before the removal for exactly that
    // reason.
    await enqueueWrite('clock', { seq: 9 }, USER);
    mockedRecordClockEvent.mockRejectedValue(postgrestError('42501'));
    await flushQueuedWrites(USER);

    const [dead] = await listDeadLetteredWrites(USER);
    const result = await retryDeadLetteredWrite(dead!.id, USER);

    expect(result.deadLettered).toBe(1);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(1);
  });

  it('does nothing for an id that is not there', async () => {
    expect(await retryDeadLetteredWrite('no-such-id', USER)).toEqual({
      synced: 0,
      failed: 0,
      deadLettered: 0,
    });
  });
});

/**
 * The outbox is stored per ORIGIN, not per account, so it outlives a
 * sign-out. On a shared device — a ward tablet, a warehouse terminal, the
 * site office PC, which is most of RotaFlow's market — that is the difference
 * between a queue and a hazard.
 *
 * The asymmetry is what makes it serious. RLS lets a manager insert a clock
 * event for anybody in their organisation (0037), so a manager signing in on
 * that tablet would successfully land a colleague's queued clock-in on their
 * behalf, hours late. A staff member signing in on the same tablet would fail
 * that check, the failure classifies as permanent, and the colleague's
 * clock-in would be DESTROYED — with a notice on the new person's screen
 * saying "1 action didn't save" about an action they never took.
 */
describe('ownership (GAP-042)', () => {
  it("does not replay another user's queued write", async () => {
    mockedRecordClockEvent.mockResolvedValue({} as never);
    await enqueueWrite('clock', { type: 'in' }, OTHER_USER);

    const result = await flushQueuedWrites(USER);

    expect(result).toEqual({ synced: 0, failed: 0, deadLettered: 0 });
    expect(recordClockEvent).not.toHaveBeenCalled();
    // Still there, untouched, for its owner to flush when they sign back in.
    expect(await listQueuedWrites(OTHER_USER)).toHaveLength(1);
  });

  it("does not show another user's queued write or dead letter", async () => {
    mockedRecordClockEvent.mockResolvedValue({} as never);
    await enqueueWrite('clock', { type: 'in' }, OTHER_USER);
    mockedRecordClockEvent.mockRejectedValueOnce({ code: '42501' });
    await enqueueWrite('clock', { type: 'out' }, OTHER_USER);
    await flushQueuedWrites(OTHER_USER);

    expect(await listQueuedWrites(USER)).toHaveLength(0);
    expect(await listDeadLetteredWrites(USER)).toHaveLength(0);
    expect(await listDeadLetteredWrites(OTHER_USER)).not.toHaveLength(0);
  });

  it("will not retry another user's dead letter", async () => {
    mockedRecordClockEvent.mockRejectedValue({ code: '42501' });
    await enqueueWrite('clock', { type: 'in' }, OTHER_USER);
    await flushQueuedWrites(OTHER_USER);
    const [dead] = await listDeadLetteredWrites(OTHER_USER);

    expect(await retryDeadLetteredWrite(dead!.id, USER)).toEqual({
      synced: 0,
      failed: 0,
      deadLettered: 0,
    });
    expect(await listDeadLetteredWrites(OTHER_USER)).toHaveLength(1);
  });

  // A row queued before this field existed. Stranding a clock-in forever is
  // worse than replaying one, and there is no second copy of it anywhere.
  it('claims a legacy record with no owner rather than stranding it', async () => {
    mockedRecordClockEvent.mockResolvedValue({} as never);
    await outboxAdd({
      id: 'legacy-1',
      kind: 'clock',
      payload: { type: 'in' },
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });

    const result = await flushQueuedWrites(USER);

    expect(result.synced).toBe(1);
    expect(recordClockEvent).toHaveBeenCalledOnce();
  });
});
