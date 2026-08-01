import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// The replayers are the boundary to Supabase. Mocking them lets these tests
// drive the real IndexedDB code path (via fake-indexeddb) while deciding
// exactly how the server responds — which is the whole subject here.
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
import {
  MAX_ATTEMPTS,
  classifyFailure,
  discardDeadLetteredWrite,
  enqueueWrite,
  flushQueuedWrites,
  listDeadLetteredWrites,
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
  // A fresh database per test — IndexedDB is process-global and would
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

  it('treats an expired JWT as transient — the session refreshes itself', () => {
    // Discarding a clock-in because a token aged out while the phone was in
    // someone's pocket would be exactly the wrong call.
    expect(classifyFailure(postgrestError('PGRST301', 'JWT expired'))).toBe('transient');
  });

  it('treats an RLS denial as permanent', () => {
    // 42501 insufficient_privilege — the membership was revoked. Retrying for
    // the rest of time cannot make this succeed.
    expect(classifyFailure(postgrestError('42501'))).toBe('permanent');
  });

  it('treats constraint violations as permanent', () => {
    expect(classifyFailure(postgrestError('23505'))).toBe('permanent'); // unique
    expect(classifyFailure(postgrestError('23514'))).toBe('permanent'); // check
    expect(classifyFailure(postgrestError('23503'))).toBe('permanent'); // FK — deleted shift
  });

  it('treats a serialization failure as transient', () => {
    // 40001 — two writes collided. This one genuinely does succeed on retry.
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

describe('flushQueuedWrites — the happy path', () => {
  it('replays and removes every queued write', async () => {
    mockedRecordClockEvent.mockResolvedValue({} as never);
    await enqueueWrite('clock', { type: 'in' });
    await enqueueWrite('clock', { type: 'out' });

    const result = await flushQueuedWrites();

    expect(result).toEqual({ synced: 2, failed: 0, deadLettered: 0 });
    expect(await listQueuedWrites()).toHaveLength(0);
  });

  it('replays oldest first', async () => {
    const seen: unknown[] = [];
    mockedRecordClockEvent.mockImplementation((payload) => {
      seen.push(payload);
      return Promise.resolve({} as never);
    });

    await enqueueWrite('clock', { seq: 1 });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 3 });

    await flushQueuedWrites();

    expect(seen).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });

  it('does nothing with an empty queue', async () => {
    expect(await flushQueuedWrites()).toEqual({ synced: 0, failed: 0, deadLettered: 0 });
    expect(mockedRecordClockEvent).not.toHaveBeenCalled();
  });
});

describe('flushQueuedWrites — a permanent rejection must not block the queue', () => {
  it('sets the bad write aside and delivers everything behind it', async () => {
    // THE REGRESSION THIS SUITE EXISTS FOR.
    //
    // Old behaviour: the loop broke on the first failure and left the item in
    // place, so this 42501 blocked items 2 and 3 on this reconnect and on
    // every reconnect after it, forever, in silence. The carer's later
    // clock-ins never reached the database and their timesheet was wrong.
    await enqueueWrite('clock', { seq: 1 });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 3 });

    mockedRecordClockEvent.mockImplementation((payload) => {
      if ((payload as unknown as { seq: number }).seq === 1) {
        return Promise.reject(postgrestError('42501'));
      }
      return Promise.resolve({} as never);
    });

    const result = await flushQueuedWrites();

    expect(result.synced).toBe(2);
    expect(result.deadLettered).toBe(1);
    expect(await listQueuedWrites()).toHaveLength(0);

    const dead = await listDeadLetteredWrites();
    expect(dead).toHaveLength(1);
    expect(first(dead).payload).toEqual({ seq: 1 });
    expect(first(dead).reason).toBe('permanent');
  });

  it('never deletes the rejected write — it is kept for the user', async () => {
    // Losing it silently would be no better than the deadlock it replaced.
    await enqueueWrite('clock', { shiftId: 'deleted-shift' });
    mockedRecordClockEvent.mockRejectedValue(postgrestError('23503'));

    await flushQueuedWrites();

    const dead = await listDeadLetteredWrites();
    expect(dead).toHaveLength(1);
    expect(first(dead).payload).toEqual({ shiftId: 'deleted-shift' });
    expect(first(dead).lastError).toBeTruthy();
    expect(first(dead).failedAt).toBeTruthy();
  });

  it('drains a queue where several writes are individually rejected', async () => {
    for (const seq of [1, 2, 3, 4]) {
      await enqueueWrite('clock', { seq });
      await new Promise((r) => setTimeout(r, 2));
    }
    mockedRecordClockEvent.mockImplementation((payload) => {
      const { seq } = payload as unknown as { seq: number };
      if (seq % 2 === 1) return Promise.reject(postgrestError('23505'));
      return Promise.resolve({} as never);
    });

    const result = await flushQueuedWrites();

    expect(result.synced).toBe(2);
    expect(result.deadLettered).toBe(2);
    expect(await listQueuedWrites()).toHaveLength(0);
  });

  it('leaves the queue empty and stable across repeated flushes', async () => {
    await enqueueWrite('clock', { seq: 1 });
    mockedRecordClockEvent.mockRejectedValue(postgrestError('42501'));

    await flushQueuedWrites();
    const second = await flushQueuedWrites();

    // The old code would have retried the same doomed item here, forever.
    expect(second).toEqual({ synced: 0, failed: 0, deadLettered: 0 });
    expect(await listDeadLetteredWrites()).toHaveLength(1);
  });
});

describe('flushQueuedWrites — a transient failure is retried, then bounded', () => {
  it('keeps the write queued and stops the flush', async () => {
    await enqueueWrite('clock', { seq: 1 });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 });

    mockedRecordClockEvent.mockRejectedValue(networkError());

    const result = await flushQueuedWrites();

    expect(result).toEqual({ synced: 0, failed: 1, deadLettered: 0 });
    // Both still queued: stopping early is correct when the network dropped.
    expect(await listQueuedWrites()).toHaveLength(2);
    // Only one attempt was burned, not one per item.
    expect(mockedRecordClockEvent).toHaveBeenCalledTimes(1);
  });

  it('counts attempts across reconnects', async () => {
    await enqueueWrite('clock', { seq: 1 });
    mockedRecordClockEvent.mockRejectedValue(networkError());

    await flushQueuedWrites();
    expect(first(await listQueuedWrites()).attempts).toBe(1);

    await flushQueuedWrites();
    expect(first(await listQueuedWrites()).attempts).toBe(2);
  });

  it('delivers the write once the network returns', async () => {
    await enqueueWrite('clock', { seq: 1 });

    mockedRecordClockEvent.mockRejectedValueOnce(networkError());
    await flushQueuedWrites();
    expect(await listQueuedWrites()).toHaveLength(1);

    mockedRecordClockEvent.mockResolvedValue({} as never);
    const result = await flushQueuedWrites();

    expect(result.synced).toBe(1);
    expect(await listQueuedWrites()).toHaveLength(0);
    expect(await listDeadLetteredWrites()).toHaveLength(0);
  });

  it('dead-letters after MAX_ATTEMPTS rather than retrying forever', async () => {
    await enqueueWrite('clock', { seq: 1 });
    mockedRecordClockEvent.mockRejectedValue(new Error('unclassifiable'));

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await flushQueuedWrites();
    }

    expect(await listQueuedWrites()).toHaveLength(0);
    const dead = await listDeadLetteredWrites();
    expect(dead).toHaveLength(1);
    expect(first(dead).reason).toBe('exhausted');
    expect(first(dead).attempts).toBe(MAX_ATTEMPTS);
  });

  it('does not let an exhausted item strand the ones behind it', async () => {
    await enqueueWrite('clock', { seq: 1 });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueWrite('clock', { seq: 2 });

    mockedRecordClockEvent.mockImplementation((payload) => {
      if ((payload as unknown as { seq: number }).seq === 1) {
        return Promise.reject(new Error('unclassifiable'));
      }
      return Promise.resolve({} as never);
    });

    // Burn item 1's attempts.
    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushQueuedWrites();

    // Item 2 was blocked while item 1 retried — correct, that is the transient
    // policy — but once item 1 is set aside the next flush must deliver it.
    const result = await flushQueuedWrites();

    expect(result.synced).toBe(1);
    expect(await listQueuedWrites()).toHaveLength(0);
    expect(await listDeadLetteredWrites()).toHaveLength(1);
  });
});

describe('dead letters', () => {
  it('survive until explicitly discarded', async () => {
    await enqueueWrite('clock', { seq: 1 });
    mockedRecordClockEvent.mockRejectedValue(postgrestError('42501'));
    await flushQueuedWrites();

    const dead = first(await listDeadLetteredWrites());
    expect(dead).toBeDefined();

    await flushQueuedWrites();
    expect(await listDeadLetteredWrites()).toHaveLength(1);

    await discardDeadLetteredWrite(dead.id);
    expect(await listDeadLetteredWrites()).toHaveLength(0);
  });

  it('keep enough context to re-enter the write by hand', async () => {
    await enqueueWrite('clock', { type: 'in', event_at: '2026-06-15T09:00:00Z' });
    mockedRecordClockEvent.mockRejectedValue(
      postgrestError('42501', 'permission denied'),
    );
    await flushQueuedWrites();

    const dead = first(await listDeadLetteredWrites());
    expect(dead.kind).toBe('clock');
    expect(dead.payload).toEqual({ type: 'in', event_at: '2026-06-15T09:00:00Z' });
    expect(dead.queuedAt).toBeTruthy();
    expect(dead.lastError).toContain('permission denied');
  });
});

describe('enqueueWrite', () => {
  it('starts a write at zero attempts', async () => {
    await enqueueWrite('leave', { start_date: '2026-06-15' });
    const item = first(await listQueuedWrites());
    expect(item.attempts).toBe(0);
    expect(item.kind).toBe('leave');
  });
});
