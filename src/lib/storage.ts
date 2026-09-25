import { createStore, del, get, keys, set } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

const stateStore = typeof indexedDB !== 'undefined' ? createStore('done-state', 'kv') : undefined;
const fileStore = typeof indexedDB !== 'undefined' ? createStore('done-files', 'blobs') : undefined;

const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const entries = [...pending.entries()];
  pending.clear();
  await Promise.all(entries.map(([k, v]) => set(k, v, stateStore)));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

/**
 * Debounced IndexedDB storage for zustand/persist. Serialising the whole
 * workspace on every keystroke would be wasteful, so writes coalesce for
 * a short moment and are flushed when the tab is hidden or closed.
 */
export const idbStateStorage: StateStorage = {
  getItem: async (name) => {
    if (pending.has(name)) return pending.get(name)!;
    const v = await get<string>(name, stateStore);
    if (v != null) return v;
    // Fallback for environments where IndexedDB was unavailable earlier.
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (!stateStore) {
      try {
        localStorage.setItem(name, value);
      } catch {
        /* quota or privacy mode, nothing we can do */
      }
      return;
    }
    pending.set(name, value);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 250);
  },
  removeItem: async (name) => {
    pending.delete(name);
    await del(name, stateStore);
  },
};

export async function putFileBlob(id: string, blob: Blob): Promise<void> {
  if (!fileStore) return;
  await set(id, blob, fileStore);
}

export async function getFileBlob(id: string): Promise<Blob | undefined> {
  if (!fileStore) return undefined;
  return get<Blob>(id, fileStore);
}

export async function deleteFileBlob(id: string): Promise<void> {
  if (!fileStore) return;
  await del(id, fileStore);
}

/** Removes blobs that no longer have metadata (e.g. after a project was deleted and the undo window passed). */
export async function collectGarbageBlobs(liveIds: Set<string>): Promise<void> {
  if (!fileStore) return;
  const all = (await keys(fileStore)) as string[];
  await Promise.all(all.filter((k) => !liveIds.has(k)).map((k) => del(k, fileStore)));
}

const urlCache = new Map<string, string>();
export async function getFileUrl(id: string): Promise<string | undefined> {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getFileBlob(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}
