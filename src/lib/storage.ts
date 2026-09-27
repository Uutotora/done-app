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

const MB = 1024 * 1024;
/** Largest shared file the interface uploads; the server default for DONE_MAX_UPLOAD_MB is the same. */
export const MAX_UPLOAD_MB = 100;
/** Images and files inserted into pages, tasks and project briefs (EDITOR_UPLOAD_MB on the server). */
export const MAX_EDITOR_UPLOAD_MB = 20;
/** Pages in the local demo keep their images inline, so they stay small. */
export const MAX_INLINE_UPLOAD_MB = 3;

export type UploadProblem = 'too_large' | 'unsaved' | 'failed';
/** Why an upload did not go through, with the size limit when the file was too large. */
export class UploadError extends Error {
  readonly problem: UploadProblem;
  readonly maxMb?: number;
  constructor(problem: UploadProblem, maxMb?: number, message?: string) {
    super(message ?? (problem === 'too_large' ? `The file is larger than ${maxMb} MB` : 'Upload failed'));
    this.name = 'UploadError';
    this.problem = problem;
    this.maxMb = maxMb;
  }
}

async function uploadFailure(response: Response, maxMb: number): Promise<Error> {
  const result = (await response.json().catch(() => ({}))) as { error?: string; maxMb?: number };
  if (response.status === 413) return new UploadError('too_large', Number(result.maxMb) > 0 ? Number(result.maxMb) : maxMb);
  return Object.assign(new UploadError('failed', undefined, result.error || 'Upload failed'), { status: response.status });
}

/** Headers for uploads whose body is the file itself; x-done-client is the server's CSRF check. */
const uploadHeaders = (type: string) => ({ 'content-type': type, 'x-done-client': 'web' });

const storedListeners = new Set<(id: string) => void>();
/** Calls `listener` with the id of each shared file whose bytes this tab has just sent, e.g. to show its thumbnail. */
export function onFileStored(listener: (id: string) => void): () => void {
  storedListeners.add(listener);
  return () => void storedListeners.delete(listener);
}

/** Sends the bytes of a shared file after its record was saved, streamed as they are. */
export async function syncFileBlob(id: string, blob: Blob): Promise<void> {
  if (!remoteStorage) return;
  if (blob.size > MAX_UPLOAD_MB * MB) throw new UploadError('too_large', MAX_UPLOAD_MB);
  const { flushWorkspace, useAuth } = await import('./auth');
  // The server accepts bytes only for a file record it already has.
  await flushWorkspace();
  if (useAuth.getState().sync !== 'saved') throw new UploadError('unsaved');
  const response = await fetch(`/api/blobs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: uploadHeaders('application/octet-stream'),
    body: blob,
  });
  if (!response.ok) throw await uploadFailure(response, MAX_UPLOAD_MB);
  for (const listener of storedListeners) listener(id);
}

/**
 * Uploads an image or file inserted into a page, task or project brief and returns its address.
 * `projectId` is where the text lives; pages outside projects belong to the workspace.
 */
export async function uploadEditorFile(file: File, projectId?: string): Promise<string> {
  if (file.size > MAX_EDITOR_UPLOAD_MB * MB) throw new UploadError('too_large', MAX_EDITOR_UPLOAD_MB);
  // A project created a moment ago has to reach the server first.
  const { flushWorkspace } = await import('./auth');
  await flushWorkspace();
  const response = await fetch(`/api/uploads?scope=${encodeURIComponent(projectId || 'workspace')}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...uploadHeaders(file.type || 'application/octet-stream'),
      ...(file.name ? { 'x-done-file-name': encodeURIComponent(file.name) } : {}),
    },
    body: file,
  });
  if (!response.ok) throw await uploadFailure(response, MAX_EDITOR_UPLOAD_MB);
  const { url } = (await response.json()) as { url?: unknown };
  if (typeof url !== 'string' || !url.startsWith('/api/uploads/')) throw new UploadError('failed');
  return url;
}
