import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  deadLetterList,
  outboxAdd,
  outboxList,
  outboxMoveToDeadLetter,
  outboxRemove,
  outboxUpdate,
  type OutboxRecord,
} from '@/lib/offlineOutbox';

/**
 * The v1 → v2 upgrade, and the store operations underneath the sync queue.
 *
 * ## Why the migration gets its own file
 *
 * Every test in `syncQueue.test.ts` starts from a fresh `IDBFactory`, so the
 * database is created at v2 directly and `oldVersion` is 0 — the migration
 * branch in `openDb` never executes there. That is a blind spot with unusually
 * bad consequences, because the migration is the path that runs for **every
 * existing user who has writes queued right now**.
 *
 * If it fails to backfill `attempts`, a v1 record arrives with
 * `attempts: undefined`. Then `undefined + 1` is `NaN`, `NaN >= MAX_ATTEMPTS`
 * is `false`, and the item is never dead-lettered — which is exactly the
 * block-the-queue-forever bug the v2 work exists to remove, reintroduced for
 * precisely the people who were already suffering from it.
 *
 * So these tests build a real v1 database by hand and upgrade it.
 */

const DB_NAME = 'rotaflow-outbox';
const STORE = 'queued_writes';

/** A record exactly as v1 wrote it: no `attempts`, no `lastError`. */
interface V1Record {
  id: string;
  kind: string;
  payload: unknown;
  queuedAt: string;
}

/**
 * Create the v1 schema and seed it, using the raw IndexedDB API rather than
 * this module — the point is to reproduce what is on a real device, not what
 * the current code would write.
 */
function seedV1Database(records: V1Record[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const record of records) store.add(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('seed failed'));
    };
    request.onerror = () => reject(request.error ?? new Error('open v1 failed'));
  });
}

beforeEach(() => {
  // eslint-disable-next-line no-global-assign
  indexedDB = new IDBFactory();
});

describe('v1 → v2 migration', () => {
  it('keeps writes that were queued before the upgrade', async () => {
    // A carer went offline on the old build with three clock events queued,
    // then the app updated. Losing these would be worse than the bug v2 fixes.
    await seedV1Database([
      { id: 'a', kind: 'clock', payload: { seq: 1 }, queuedAt: '2026-07-01T09:00:00Z' },
      { id: 'b', kind: 'leave', payload: { seq: 2 }, queuedAt: '2026-07-01T10:00:00Z' },
      { id: 'c', kind: 'swap', payload: { seq: 3 }, queuedAt: '2026-07-01T11:00:00Z' },
    ]);

    const items = await outboxList();

    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(items.map((i) => i.payload)).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });

  it('backfills attempts to 0 on every migrated record', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Without the backfill these arrive as
    // `undefined`; `undefined + 1` is NaN, `NaN >= MAX_ATTEMPTS` is false, and
    // the retry ceiling never trips.
    await seedV1Database([
      { id: 'a', kind: 'clock', payload: {}, queuedAt: '2026-07-01T09:00:00Z' },
      { id: 'b', kind: 'clock', payload: {}, queuedAt: '2026-07-01T10:00:00Z' },
    ]);

    const items = await outboxList();

    for (const item of items) {
      expect(item.attempts).toBe(0);
      expect(typeof item.attempts).toBe('number');
      expect(Number.isNaN(item.attempts)).toBe(false);
    }
  });

  it('produces attempt counts that actually increment', async () => {
    // The failure mode is arithmetic, so assert the arithmetic rather than just
    // the field: a NaN would satisfy "not undefined" and still never reach the
    // ceiling.
    await seedV1Database([
      { id: 'a', kind: 'clock', payload: {}, queuedAt: '2026-07-01T09:00:00Z' },
    ]);

    const [item] = await outboxList();
    if (!item) throw new Error('expected the migrated record');

    const next = item.attempts + 1;
    expect(next).toBe(1);
    expect(Number.isNaN(next)).toBe(false);
    expect(next >= 5).toBe(false);

    await outboxUpdate({ ...item, attempts: 5 });
    const [updated] = await outboxList();
    expect(updated?.attempts).toBe(5);
    expect((updated?.attempts ?? 0) >= 5).toBe(true);
  });

  it('creates the dead-letter store that v1 never had', async () => {
    await seedV1Database([
      { id: 'a', kind: 'clock', payload: {}, queuedAt: '2026-07-01T09:00:00Z' },
    ]);

    // Reading it at all proves the upgrade created it; v1 had one store, so
    // without the `createObjectStore` in `onupgradeneeded` this throws
    // NotFoundError rather than returning an empty list.
    await expect(deadLetterList()).resolves.toEqual([]);
  });

  it('lets a migrated record move to the dead-letter store', async () => {
    // End to end on an upgraded database: the old record must be able to take
    // the new escape route, not just sit in a store with the right shape.
    await seedV1Database([
      { id: 'a', kind: 'clock', payload: { seq: 1 }, queuedAt: '2026-07-01T09:00:00Z' },
    ]);

    const [item] = await outboxList();
    if (!item) throw new Error('expected the migrated record');

    await outboxMoveToDeadLetter({
      ...item,
      attempts: 5,
      lastError: 'permission denied',
      failedAt: '2026-08-01T12:00:00Z',
      reason: 'permanent',
    });

    expect(await outboxList()).toHaveLength(0);
    const dead = await deadLetterList();
    expect(dead).toHaveLength(1);
    expect(dead[0]?.payload).toEqual({ seq: 1 });
  });

  it('is idempotent — a second open does not re-run or corrupt anything', async () => {
    await seedV1Database([
      { id: 'a', kind: 'clock', payload: {}, queuedAt: '2026-07-01T09:00:00Z' },
    ]);

    const [first] = await outboxList();
    await outboxUpdate({ ...first!, attempts: 3 });

    // Any later open is already at v2, so the backfill must not fire again and
    // reset a real attempt count back to 0.
    const [second] = await outboxList();
    expect(second?.attempts).toBe(3);
  });

  it('does not touch records that already have an attempt count', async () => {
    // Defensive: a partially-migrated database (upgrade interrupted) must not
    // have its counts reset on the next open.
    await seedV1Database([
      { id: 'a', kind: 'clock', payload: {}, queuedAt: '2026-07-01T09:00:00Z' },
      {
        id: 'b',
        kind: 'clock',
        payload: {},
        queuedAt: '2026-07-01T10:00:00Z',
        attempts: 4,
      } as V1Record & { attempts: number },
    ]);

    const items = await outboxList();
    const byId = new Map(items.map((i) => [i.id, i]));

    expect(byId.get('a')?.attempts).toBe(0);
    expect(byId.get('b')?.attempts).toBe(4);
  });
});

describe('store operations on a fresh v2 database', () => {
  const record = (id: string, queuedAt: string): OutboxRecord => ({
    id,
    kind: 'clock',
    payload: { id },
    queuedAt,
    attempts: 0,
  });

  it('returns queued writes oldest first regardless of insert order', async () => {
    await outboxAdd(record('c', '2026-07-01T11:00:00Z'));
    await outboxAdd(record('a', '2026-07-01T09:00:00Z'));
    await outboxAdd(record('b', '2026-07-01T10:00:00Z'));

    expect((await outboxList()).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes a single write without disturbing the rest', async () => {
    await outboxAdd(record('a', '2026-07-01T09:00:00Z'));
    await outboxAdd(record('b', '2026-07-01T10:00:00Z'));

    await outboxRemove('a');

    expect((await outboxList()).map((i) => i.id)).toEqual(['b']);
  });

  it('starts with an empty dead-letter store', async () => {
    expect(await deadLetterList()).toEqual([]);
  });
});
