/**
 * Raw IndexedDB wrapper for the offline write outbox (ARCHITECTURE.md §4,
 * "Offline write queue"). No dependency added for this — two object stores,
 * a handful of operations, doesn't justify idb/dexie.
 *
 * Every browser that runs this PWA supports IndexedDB (it's required for an
 * installable, offline-capable app); no fallback path is provided.
 *
 * ## Why there are two stores
 *
 * `queued_writes` is the live queue. `dead_letters` holds writes the server has
 * permanently rejected.
 *
 * Version 1 had only the queue, and `flushQueuedWrites` stopped at the first
 * failure and left the item in place. For a dropped connection that is correct.
 * For a permanent rejection — a revoked membership, a deleted shift, a CHECK
 * violation — it meant the item failed forever and blocked every write queued
 * behind it, on every reconnect, silently. A carer's clock-ins stopped reaching
 * the database while the UI kept reporting success, and the timesheet that
 * drives their pay went quietly wrong.
 *
 * A dead-letter store is what makes that impossible: a poisonous item is moved
 * aside so the queue drains, and it is kept (never dropped) so a human can see
 * what was lost and re-enter it.
 */

const DB_NAME = 'rotaflow-outbox';

/**
 * v1 → v2 adds `attempts`/`lastError` to queued records and the `dead_letters`
 * store. Existing v1 rows are migrated in place — a staff member who was
 * offline across the upgrade must not lose queued clock-ins.
 */
const DB_VERSION = 2;

const STORE = 'queued_writes';
const DEAD_LETTER_STORE = 'dead_letters';

export type OutboxKind = 'clock' | 'leave' | 'swap';

export interface OutboxRecord {
  id: string;
  kind: OutboxKind;
  payload: unknown;
  queuedAt: string;
  /** Replay attempts so far. Bounds an item that fails for an unknown reason. */
  attempts: number;
  /** Message from the most recent failure, for the review UI. */
  lastError?: string;
}

export interface DeadLetterRecord extends OutboxRecord {
  /** When it was given up on. */
  failedAt: string;
  /** 'permanent' = server refused it; 'exhausted' = too many transient failures. */
  reason: 'permanent' | 'exhausted';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (upgrade) => {
      const db = request.result;
      const tx = request.transaction;

      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DEAD_LETTER_STORE)) {
        db.createObjectStore(DEAD_LETTER_STORE, { keyPath: 'id' });
      }

      // Backfill `attempts` on rows written by v1. Without this they arrive as
      // `undefined`, `attempts + 1` is NaN, NaN >= MAX is false, and the retry
      // ceiling never trips — reintroducing the exact stuck-forever behaviour
      // v2 exists to remove, for precisely the users who were mid-queue.
      if (upgrade.oldVersion > 0 && upgrade.oldVersion < 2 && tx) {
        const store = tx.objectStore(STORE);
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const record = cursor.value as Partial<OutboxRecord>;
          if (typeof record.attempts !== 'number') {
            cursor.update({ ...record, attempts: 0 });
          }
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open outbox database'));
  });
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('Outbox transaction failed'));
        tx.oncomplete = () => db.close();
      }),
  );
}

/** Oldest first — writes replay in the order the user made them. */
function byQueuedAt(a: OutboxRecord, b: OutboxRecord): number {
  return a.queuedAt.localeCompare(b.queuedAt);
}

export async function outboxAdd(record: OutboxRecord): Promise<void> {
  await runTransaction(STORE, 'readwrite', (store) => store.add(record));
}

export async function outboxList(): Promise<OutboxRecord[]> {
  // lib.dom types IDBObjectStore.getAll() as IDBRequest<any[]>, so the cast
  // here is the one place that trusts the store only ever holds OutboxRecord.
  const records = await runTransaction<OutboxRecord[]>(
    STORE,
    'readonly',
    (store) => store.getAll() as IDBRequest<OutboxRecord[]>,
  );
  return records.sort(byQueuedAt);
}

export async function outboxRemove(id: string): Promise<void> {
  await runTransaction(STORE, 'readwrite', (store) => store.delete(id));
}

/** Records a failed attempt against an item that is staying in the queue. */
export async function outboxUpdate(record: OutboxRecord): Promise<void> {
  await runTransaction(STORE, 'readwrite', (store) => store.put(record));
}

/**
 * Move an item out of the queue and into the dead-letter store, atomically —
 * both stores in one transaction, so a crash between the two can neither lose
 * the write nor leave it behind still blocking the queue.
 */
export async function outboxMoveToDeadLetter(record: DeadLetterRecord): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, DEAD_LETTER_STORE], 'readwrite');
    tx.objectStore(DEAD_LETTER_STORE).put(record);
    tx.objectStore(STORE).delete(record.id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error('Dead-letter transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Dead-letter transaction aborted'));
  });
}

export async function deadLetterList(): Promise<DeadLetterRecord[]> {
  const records = await runTransaction<DeadLetterRecord[]>(
    DEAD_LETTER_STORE,
    'readonly',
    (store) => store.getAll() as IDBRequest<DeadLetterRecord[]>,
  );
  return records.sort(byQueuedAt);
}

/** Discard a dead-lettered write — only ever from an explicit user action. */
export async function deadLetterRemove(id: string): Promise<void> {
  await runTransaction(DEAD_LETTER_STORE, 'readwrite', (store) => store.delete(id));
}
