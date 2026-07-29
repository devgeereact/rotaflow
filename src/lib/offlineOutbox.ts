/**
 * Raw IndexedDB wrapper for the offline write outbox (ARCHITECTURE.md §4,
 * "Offline write queue"). No dependency added for this — one object store,
 * four operations, doesn't justify idb/dexie.
 *
 * Every browser that runs this PWA supports IndexedDB (it's required for a
 * installable, offline-capable app); no fallback path is provided.
 */

const DB_NAME = 'rotaflow-outbox';
const DB_VERSION = 1;
const STORE = 'queued_writes';

export type OutboxKind = 'clock' | 'leave' | 'swap';

export interface OutboxRecord {
  id: string;
  kind: OutboxKind;
  payload: unknown;
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open outbox database'));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('Outbox transaction failed'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function outboxAdd(record: OutboxRecord): Promise<void> {
  await runTransaction('readwrite', (store) => store.add(record));
}

export async function outboxList(): Promise<OutboxRecord[]> {
  // lib.dom types IDBObjectStore.getAll() as IDBRequest<any[]>, so the cast
  // here is the one place that trusts the store only ever holds OutboxRecord.
  const records = await runTransaction<OutboxRecord[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<OutboxRecord[]>,
  );
  // Oldest first — writes should replay in the order the user made them.
  return records.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function outboxRemove(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id));
}
