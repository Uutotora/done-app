import { createStore, delMany, entries, set } from 'idb-keyval';
import { applyShared, type ChangeSet } from '../../server/merge.mjs';

/* ------------------------------------------------------------------------------------------------
 * Offline support for account mode: telling a lost connection from a real save error, the retry
 * schedule, and unsaved change sets kept in IndexedDB so a closed tab does not lose them.
 * ---------------------------------------------------------------------------------------------- */

/** What a failed request means for saving: sign in again, wait for the network, or a real error. */
export type FailureKind = 'signedOut' | 'offline' | 'error';

/** Shape of the errors thrown by api() in auth.ts. */
export interface RequestFailure {
  name?: string;
  message?: string;
  /** HTTP status of the answer. Missing when no answer came at all. */
  status?: number;
  /** False when the answer was not JSON, e.g. a proxy error page. */
  json?: boolean;
  /** True when the request never got an answer: no network, refused connection or timeout. */
  network?: boolean;
}

/** Browser messages for a fetch that got no answer (Chrome, Firefox, Safari). */
const NETWORK_MESSAGE = /failed to fetch|networkerror|network error|load failed|network request failed/i;

export const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * Offline: no answer at all, the browser reports no network, a gateway error (502, 503, 504) or an
 * answer that is not JSON, such as a proxy page while the server restarts. A JSON error from the
 * server proves it is reachable, so 400, 403, 409, 413 or 500 with a JSON body is a real error.
 */
export function classifyFailure(error: unknown, online = browserOnline()): FailureKind {
  const e = (error && typeof error === 'object' ? error : {}) as RequestFailure;
  if (typeof e.status !== 'number') {
    const noAnswer =
      e.network === true || e.name === 'AbortError' || e.name === 'TimeoutError' || (e.name === 'TypeError' && NETWORK_MESSAGE.test(e.message ?? ''));
    return noAnswer || !online ? 'offline' : 'error';
  }
  if (e.json === false || [502, 503, 504].includes(e.status)) return 'offline';
  if (e.status === 401) return 'signedOut';
  return 'error';
}

/** Real errors worth retrying on their own: the server failed, not the request. */
export const retryableError = (status?: number) => status === undefined || status >= 500 || status === 408 || status === 429;

/** Pause before each automatic retry while offline: 2 s, 5 s, 10 s, then every 30 s. */
export const RETRY_DELAYS = [2000, 5000, 10000, 30000] as const;
export const retryDelay = (attempt: number) => RETRY_DELAYS[Math.min(Math.max(0, attempt), RETRY_DELAYS.length - 1)];

/* Unsaved changes kept in this browser --------------------------------------------------------- */

/** Change set a tab could not save yet, relative to the server revision it was based on. */
export interface PendingEntry {
  userId: string;
  revision: number;
  changes: ChangeSet;
  savedAt: number;
}
export interface StoredPending {
  key: string;
  entry: PendingEntry;
}

/** Entries older than this are dropped instead of being replayed over much newer work. */
export const PENDING_TTL = 14 * 86400000;

const pendingStore = typeof indexedDB !== 'undefined' ? createStore('done-pending', 'changes') : undefined;

/** One entry per person and tab, so two open tabs never overwrite each other's changes. */
export const pendingKey = (userId: string, tabId: string) => `${userId}:${tabId}`;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function isPendingEntry(value: unknown): value is PendingEntry {
  return (
    isObject(value) &&
    typeof value.userId === 'string' &&
    typeof value.revision === 'number' &&
    typeof value.savedAt === 'number' &&
    Number.isFinite(value.savedAt) &&
    isObject(value.changes) &&
    isObject(value.changes.records)
  );
}

export async function savePendingEntry(key: string, entry: PendingEntry): Promise<void> {
  if (!pendingStore) throw new Error('IndexedDB is unavailable');
  await set(key, entry, pendingStore);
}

export async function deletePendingEntries(keys: string[]): Promise<void> {
  if (!pendingStore || !keys.length) return;
  await delMany(keys, pendingStore);
}

/**
 * Unsaved change sets this person left in this browser, oldest first. Entries of other people are
 * never returned; expired or damaged entries are removed.
 */
export async function loadPendingEntries(userId: string, now = Date.now()): Promise<StoredPending[]> {
  if (!pendingStore) return [];
  const stale: string[] = [];
  const found: StoredPending[] = [];
  for (const [key, value] of await entries<string, unknown>(pendingStore)) {
    if (!isPendingEntry(value) || now - value.savedAt > PENDING_TTL) stale.push(key);
    else if (value.userId === userId) found.push({ key, entry: value });
  }
  await deletePendingEntries(stale);
  return found.sort((a, b) => a.entry.savedAt - b.entry.savedAt);
}

/** Replays stored change sets on top of fresh server data, field by field, as live edits are rebased. */
export function replayPending<T extends object>(data: T, stored: StoredPending[]): T {
  return stored.reduce((state, { entry }) => applyShared(state, entry.changes), data);
}

/* Tabs that are still open keep their own entry: a Web Lock per entry tells other tabs to leave it alone. */

const LOCK_PREFIX = 'done-pending:';
const lockManager = () => (typeof navigator !== 'undefined' ? navigator.locks : undefined);

/** Holds the lock of this tab's entry until the returned function is called or the tab closes. */
export function holdPendingLock(key: string): () => void {
  const locks = lockManager();
  if (!locks) return () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void locks.request(LOCK_PREFIX + key, () => held).catch(() => undefined);
  return () => release();
}

/** Entry keys that belong to tabs open right now. */
export async function openTabKeys(): Promise<Set<string>> {
  try {
    const { held = [] } = (await lockManager()?.query()) ?? {};
    const names = held.map((lock) => lock.name ?? '').filter((name) => name.startsWith(LOCK_PREFIX));
    return new Set(names.map((name) => name.slice(LOCK_PREFIX.length)));
  } catch {
    return new Set();
  }
}

/**
 * Entries to bring back when this person opens the workspace: their own, not expired, and not held
 * by another open tab, which saves its changes itself. `ownKey` is this tab's entry and always counts.
 */
export async function loadRestorable(userId: string, ownKey: string, now = Date.now()): Promise<StoredPending[]> {
  const [stored, open] = await Promise.all([loadPendingEntries(userId, now), openTabKeys()]);
  return stored.filter(({ key }) => key === ownKey || !open.has(key));
}
