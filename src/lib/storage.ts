import { createStore, del, get, keys, set } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

const stateStore = typeof indexedDB !== 'undefined' ? createStore('done-state', 'kv') : undefined;
const fileStore = typeof indexedDB !== 'undefined' ? createStore('done-files', 'blobs') : undefined;

let remoteStorage = false;
export const isRemoteStorage = () => remoteStorage;
export function setRemoteStorage(value: boolean) {
  remoteStorage = value;
  clearFileUrls();
  if (value) {
    pending.clear();
    if (timer) clearTimeout(timer);
  }
}
const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export async function flushLocalStorage(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const entries = [...pending.entries()];
  pending.clear();
  await Promise.all(entries.map(([k, v]) => set(k, v, stateStore)));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => void flushLocalStorage());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushLocalStorage();
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
    if (remoteStorage) return;
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
    timer = setTimeout(() => void flushLocalStorage(), 250);
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
  if (remoteStorage) {
    const response = await fetch(`/api/blobs/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (!response.ok) return undefined;
    return response.blob();
  }
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
function clearFileUrls() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}
export async function getFileUrl(id: string): Promise<string | undefined> {
  if (!remoteStorage && urlCache.has(id)) return urlCache.get(id);
  const blob = await getFileBlob(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  const previous = urlCache.get(id);
  if (previous) URL.revokeObjectURL(previous);
  urlCache.set(id, url);
  return url;
}

export async function syncFileBlob(id: string, blob: Blob): Promise<void> {
  if (!remoteStorage) return;
  if (blob.size > 20 * 1024 * 1024) throw new Error('Maximum shared file size is 20 MB');
  const { api, flushWorkspace, useAuth } = await import('./auth');
  await flushWorkspace();
  if (useAuth.getState().sync !== 'saved') throw new Error('Save the workspace before uploading files');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Cannot read file'));
    reader.readAsDataURL(blob);
  });
  await api(`/api/blobs/${encodeURIComponent(id)}`, 'PUT', { base64 });
}
