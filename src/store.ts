// Local-first storage: the whole assessment lives in this browser's IndexedDB. Evidence files are stored as blobs
// next to it, keyed by evidence id, so they can be downloaded and their fingerprints checked again later.
// Nothing is sent anywhere.
import type { State } from './model.js';

const DB = 'preflight',
  KV = 'kv',
  FILES = 'files';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore(KV);
        r.result.createObjectStore(FILES);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode),
      r = fn(t.objectStore(store));
    t.oncomplete = () => res(r ? r.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const loadState = () => tx<State>(KV, 'readonly', (s) => s.get('state'));
export const saveState = (st: State) => tx(KV, 'readwrite', (s) => s.put(st, 'state'));
export const getFile = (id: string) => tx<Blob>(FILES, 'readonly', (s) => s.get(id));
export const putFile = (id: string, b: Blob) => tx(FILES, 'readwrite', (s) => s.put(b, id));
export const delFile = (id: string) => tx(FILES, 'readwrite', (s) => s.delete(id));
export const clearFiles = () => tx(FILES, 'readwrite', (s) => s.clear());
export async function allFiles(): Promise<Record<string, Blob>> {
  const keys = ((await tx<IDBValidKey[]>(FILES, 'readonly', (s) => s.getAllKeys())) || []) as string[];
  const out: Record<string, Blob> = {};
  for (const k of keys) {
    const b = await getFile(k);
    if (b) out[k] = b;
  }
  return out;
}
