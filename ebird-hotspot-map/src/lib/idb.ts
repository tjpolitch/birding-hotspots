// Tiny promise-based IndexedDB key-value store. Replaces localStorage for
// large payloads (the eBird CSV export and the eBird taxonomy) which routinely
// blow past localStorage's ~5MB quota.

const DB_NAME = 'ebird-hotspots';
const STORE = 'kv';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>('readonly', (s) => s.get(key));
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return withStore<void>('readwrite', (s) => s.put(value, key));
}

export function idbDel(key: string): Promise<void> {
  return withStore<void>('readwrite', (s) => s.delete(key));
}
