import { create } from 'zustand';
import { createEmptyData, dataSnapshot, useData } from './store';
import { flushLocalStorage, setRemoteStorage } from './storage';
import { setMutationPolicy } from './mutationPolicy';
import { toast } from './ui';
import { usePresence, type Peer } from './presence';
import { applyShared, diffShared } from '../../server/merge.mjs';
import type { DataState } from './types';
import { translate, type TKey } from './i18n';
import {
  classifyFailure,
  deletePendingEntries,
  holdPendingLock,
  loadRestorable,
  pendingKey,
  replayPending,
  retryableError,
  retryDelay,
  savePendingEntry,
} from './offline';

/** Workspace roles, strongest first. "owner" is shown as super admin. */
export type AccessRole = 'owner' | 'admin' | 'editor' | 'viewer';
/** What someone can do inside one project, weakest first. */
export type AccessLevel = 'viewer' | 'commenter' | 'editor' | 'full';
export type ProjectLevel = Exclude<AccessLevel, 'full'>;
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: AccessRole;
  /** null means every project, including future ones. */
  projectIds: string[] | null;
  /** Per-project level when it differs from what the role gives. */
  projectRoles?: Record<string, ProjectLevel>;
  canCreateProjects?: boolean;
  disabled?: boolean;
  createdAt?: string;
  lastSeen?: number | null;
}
/** "offline" means the server cannot be reached right now; edits wait in this browser. */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';
interface AuthState {
  mode: 'loading' | 'signedOut' | 'local' | 'signedIn';
  user: AuthUser | null;
  setup: boolean;
  error: string;
  sync: SyncStatus;
  syncError: string;
}
export const useAuth = create<AuthState>(() => ({ mode: 'loading', user: null, setup: false, error: '', sync: 'saved', syncError: '' }));
export const isAdmin = (user: AuthUser | null) => !!user && ['owner', 'admin'].includes(user.role);

const LEVELS: AccessLevel[] = ['viewer', 'commenter', 'editor', 'full'];
const rank = (level: AccessLevel | null) => (level ? LEVELS.indexOf(level) : -1);

/** Same rules as the server (server/access.mjs): the level a user has in a project, or null. */
export function levelOf(user: AuthUser, projectId?: string): AccessLevel | null {
  if (isAdmin(user)) return 'full';
  if (user.projectIds !== null && !(projectId && user.projectIds.includes(projectId))) return null;
  const set = projectId ? user.projectRoles?.[projectId] : undefined;
  const base: ProjectLevel = user.role === 'viewer' ? 'viewer' : 'editor';
  const level = set ?? base;
  return user.role === 'viewer' && level === 'editor' ? 'commenter' : level;
}

/** Level of the signed-in person in a project. The local demo has full access everywhere. */
export function projectLevel(projectId?: string, state = useAuth.getState()): AccessLevel | null {
  if (state.mode !== 'signedIn' || !state.user) return 'full';
  return levelOf(state.user, projectId);
}
export const canEditProject = (projectId?: string) => rank(projectLevel(projectId)) >= rank('editor');
export const canCommentProject = (projectId?: string) => rank(projectLevel(projectId)) >= rank('commenter');
export function canCreateProjects(state = useAuth.getState()): boolean {
  if (state.mode !== 'signedIn' || !state.user) return true;
  return isAdmin(state.user) || (state.user.role === 'editor' && state.user.canCreateProjects !== false);
}
export const useProjectLevel = (projectId?: string) => useAuth((s) => projectLevel(projectId, s));
export const useCanCreateProjects = () => useAuth((s) => canCreateProjects(s));
/** Identifies this browser tab so it can ignore live events about its own saves. */
const TAB_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());

/**
 * Calls the Done API. Failed requests throw an Error with `network: true` when no answer came, or
 * with `status` and `json` (false for a non-JSON answer such as a proxy error page); see offline.ts.
 */
export async function api<T = Record<string, unknown>>(path: string, method = 'GET', data?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-done-client': 'web', 'x-done-tab': TAB_ID },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { network: true });
  }
  const result = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  if (!response.ok || !result || typeof result !== 'object') {
    const message = typeof result?.error === 'string' ? result.error : `Request failed (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status, json: !!result && typeof result === 'object' });
  }
  return result as T;
}

/* ------------------------------------------------------------------------------------------------
 * Sync. The browser keeps the last state it received from the server (`base`). Local edits are
 * sent as a change set (before/after per record) that the server merges field by field, so
 * teammates editing the workspace at the same time do not block or overwrite each other.
 * Remote updates arrive over Server-Sent Events; unsaved local edits are replayed on top of them.
 * ---------------------------------------------------------------------------------------------- */

type Shared = Record<string, unknown>;
let stopSync: (() => void) | undefined;
let revision = 0;
let base: Shared | null = null;
let applying = false;
let queue: Promise<unknown> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
/** Edits were made while the server could not be reached: say so once they are saved. */
let unsavedOffline = false;
/** The live event stream ended for good (a proxy error page); it is reopened once the server answers. */
let eventsClosed = false;
let eventsRevivedAt = 0;
const tr = (key: TKey) => translate(useData.getState().prefs.lang, key);

/** Runs sync steps one at a time so a pull never interleaves with a save. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function shared(): Shared {
  const { prefs: _prefs, plane: _plane, ai: _ai, meId: _meId, onboarded: _onboarded, ...data } = dataSnapshot();
  return data;
}
const pendingChanges = () => diffShared(base, shared());
export const hasUnsavedChanges = () => useAuth.getState().mode === 'signedIn' && !!pendingChanges();

function applyRemote(data: Partial<DataState>, user: AuthUser, rev: number, keepLocal = true) {
  const local = keepLocal && base ? pendingChanges() : null;
  applying = true;
  try {
    const merged = local ? applyShared(data, local) : data;
    const { prefs, plane, ai } = useData.getState();
    useData.getState().replaceAll({ ...createEmptyData(prefs.lang), ...merged, meId: user.id, onboarded: true, prefs, plane, ai });
    base = data as Shared;
    revision = rev;
  } finally {
    applying = false;
  }
  useAuth.setState({ user, sync: local ? 'saving' : 'saved', syncError: '' });
  if (local) scheduleFlush();
}

async function pull(keepLocal = true, force = false) {
  const result = await api<{ data: DataState; revision: number; user: AuthUser }>('/api/workspace');
  connected();
  if (force || !keepLocal || result.revision !== revision || !base) applyRemote(result.data, result.user, result.revision, keepLocal);
  else useAuth.setState({ user: result.user });
}

/** Loads the server version. With `discardLocal` unsaved edits are dropped instead of replayed. */
export function refreshWorkspace(discardLocal = false): Promise<void> {
  return exclusive(async () => {
    try {
      await pull(!discardLocal);
      // Discarded edits must not come back on the next visit.
      if (discardLocal) void persistPending();
    } catch (error) {
      handleSyncError(error);
      throw error;
    }
  });
}

function handleSyncError(error: unknown) {
  const e = error as Error & { status?: number };
  const kind = classifyFailure(error);
  // Whatever happens next, unsaved edits stay in this browser.
  if (unpersisted()) void persistPending();
  if (kind === 'signedOut') {
    stopSync?.();
    stopSync = undefined;
    useAuth.setState({ mode: 'signedOut', user: null, sync: 'saved', error: e.message });
    return;
  }
  if (kind === 'offline') {
    goOffline();
    return;
  }
  useAuth.setState({ sync: 'error', syncError: e.message });
  // Server failures heal on their own; permission and validation errors wait for the member.
  if (retryableError(e.status)) scheduleRetry();
}

/** The server cannot be reached: keep working locally and try again in the background. */
function goOffline() {
  if (pendingChanges()) unsavedOffline = true;
  useAuth.setState({ sync: 'offline', syncError: '' });
  scheduleRetry();
}

function stopRetry() {
  clearTimeout(retryTimer);
  retryTimer = undefined;
  retryAttempt = 0;
}

/** One retry loop at most: after 2 s, 5 s, 10 s, then every 30 s until a request gets through. */
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    retryAttempt++;
    void reconnectWorkspace();
  }, retryDelay(retryAttempt));
}

/** A request got through after the connection was lost (or after a failed pull): back to normal. */
function connected() {
  const { sync } = useAuth.getState();
  const local = pendingChanges();
  if (sync !== 'offline' && !(sync === 'error' && !local)) return;
  stopRetry();
  useAuth.setState({ sync: local ? 'saving' : 'saved', syncError: '' });
  if (local) scheduleFlush(0);
}

/** Saves what waited for the network, then catches up with teammates. Safe to call at any time. */
export async function reconnectWorkspace(): Promise<void> {
  if (useAuth.getState().mode !== 'signedIn') return;
  await flushWorkspace();
  const { sync } = useAuth.getState();
  // The save failed again; the retry loop is already scheduled.
  if (pendingChanges() && (sync === 'offline' || sync === 'error')) return;
  await exclusive(() => pull().catch(handleSyncError));
  if (eventsClosed && useAuth.getState().mode === 'signedIn' && useAuth.getState().sync !== 'offline' && Date.now() - eventsRevivedAt > 60000) {
    eventsRevivedAt = Date.now();
    startSync(true);
  }
}

export function flushWorkspace(): Promise<void> {
  return exclusive(async () => {
    const { mode } = useAuth.getState();
    if (mode !== 'signedIn') return;
    const snapshot = shared();
    const changes = diffShared(base, snapshot);
    if (!changes) {
      // Offline or failed states only clear once a request gets through.
      if (useAuth.getState().sync === 'saving') useAuth.setState({ sync: 'saved' });
      return;
    }
    // While offline, retries run quietly under the calm offline notice instead of flickering.
    if (useAuth.getState().sync !== 'offline') useAuth.setState({ sync: 'saving', syncError: '' });
    try {
      const result = await api<{ revision: number }>('/api/workspace', 'PATCH', { baseRevision: revision, changes });
      const expected = revision + 1;
      base = snapshot;
      revision = result.revision;
      stopRetry();
      if (useAuth.getState().sync === 'offline') useAuth.setState({ sync: 'saving' });
      // Someone else saved in between: bring their edits in right away.
      if (result.revision !== expected) await pull();
      const left = pendingChanges();
      useAuth.setState({ sync: left ? 'saving' : 'saved', syncError: '' });
      if (!left) {
        void persistPending();
        if (unsavedOffline) toast({ message: tr('sync.reconnected'), tone: 'success' });
        unsavedOffline = false;
      }
    } catch (error) {
      handleSyncError(error);
    }
  });
}

let flushTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleFlush(delay = 500) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushWorkspace(), delay);
}

let pullTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePull(delay = 150) {
  clearTimeout(pullTimer);
  pullTimer = setTimeout(() => void exclusive(() => pull().catch(handleSyncError)), delay);
}

/* Unsaved changes are also kept in IndexedDB (offline.ts), so a closed tab or a long outage loses nothing. */
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistChain: Promise<unknown> = Promise.resolve();
/** Bumped on every local edit; compared with the version last written to IndexedDB. */
let changeVersion = 0;
let persistedVersion = 0;
/** Key of the entry this tab has in IndexedDB, if any. */
let storedKey: string | null = null;
/** The live stream connected at least once, so a closed stream is worth reopening. */
let streamWorked = false;

function schedulePersist(delay = 1000) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persistPending(), delay);
}

/** Writes this tab's unsaved changes to IndexedDB, or removes its entry once everything is saved. */
function persistPending(): Promise<void> {
  clearTimeout(persistTimer);
  const user = useAuth.getState().user;
  if (!user || !base) return persistChain.then(() => undefined);
  const changes = pendingChanges();
  const version = changeVersion;
  const key = pendingKey(user.id, TAB_ID);
  const entry = changes && { userId: user.id, revision, changes, savedAt: Date.now() };
  const run = persistChain.then(async () => {
    if (entry) {
      await savePendingEntry(key, entry);
      storedKey = key;
    } else if (storedKey === key) {
      await deletePendingEntries([key]);
      storedKey = null;
    }
    persistedVersion = version;
  });
  persistChain = run.catch(() => undefined);
  return run.catch(() => undefined);
}
/** Local edits that are not in IndexedDB yet, or cannot be because it is unavailable. */
const unpersisted = () => persistedVersion !== changeVersion;

/**
 * Brings back changes this person could not save before (the tab was closed offline, the session
 * expired), rebased field by field on fresh server data like live edits, and saves them.
 */
async function restoreUnsaved(userId: string) {
  const ownKey = pendingKey(userId, TAB_ID);
  const stored = await loadRestorable(userId, ownKey).catch(() => []);
  const { mode, user } = useAuth.getState();
  if (!stored.length || mode !== 'signedIn' || user?.id !== userId || !base) return;
  const local = shared();
  const merged = replayPending(local, stored);
  const restored = !!diffShared(local, merged);
  if (restored) {
    const { prefs, plane, ai, meId, onboarded } = useData.getState();
    useData.getState().replaceAll({ ...createEmptyData(prefs.lang), ...(merged as Partial<DataState>), meId, onboarded, prefs, plane, ai });
  }
  // This tab now holds the changes; the old entries go once its own entry is written.
  await persistPending();
  if (unpersisted()) return;
  await deletePendingEntries(stored.map((s) => s.key).filter((key) => key !== ownKey)).catch(() => undefined);
  if (restored && pendingChanges()) toast({ message: tr('sync.restored') });
}

let lastPresencePath = '';
/** Tells teammates which page this member has open. */
export function reportPresence(path = lastPresencePath) {
  lastPresencePath = path;
  if (useAuth.getState().mode !== 'signedIn') return;
  void api('/api/presence', 'POST', { path }).catch(() => undefined);
}

function startSync(resume = false) {
  stopSync?.();
  eventsClosed = false;
  const user = useAuth.getState().user;
  const releaseLock = user ? holdPendingLock(pendingKey(user.id, TAB_ID)) : () => undefined;
  const unsub = useData.subscribe(() => {
    const user = useAuth.getState().user;
    if (user && !applying) {
      try {
        localStorage.setItem(`done:prefs:${user.id}`, JSON.stringify(useData.getState().prefs));
        localStorage.setItem(`done:private:${user.id}`, JSON.stringify({ plane: useData.getState().plane, ai: useData.getState().ai }));
      } catch {
        /* storage unavailable */
      }
    }
    if (applying || !pendingChanges()) return;
    changeVersion++;
    const offline = useAuth.getState().sync === 'offline';
    if (offline) unsavedOffline = true;
    useAuth.setState((s) => (s.sync === 'error' || s.sync === 'offline' ? {} : { sync: 'saving' }));
    schedulePersist();
    // While offline the retry loop and the 'online' event save the edits.
    if (!offline) scheduleFlush();
  });

  let events: EventSource | undefined;
  if (typeof EventSource !== 'undefined') {
    events = new EventSource('/api/events');
    events.addEventListener('revision', (e) => {
      const { revision: rev, tab } = JSON.parse((e as MessageEvent).data) as { revision: number; tab?: string };
      if (tab !== TAB_ID && rev !== revision) schedulePull();
    });
    // An administrator changed this member's role or projects: reload what they can see.
    events.addEventListener('access', () => void exclusive(() => pull(true, true).catch(handleSyncError)));
    events.addEventListener('presence', (e) => {
      usePresence.setState({ peers: (JSON.parse((e as MessageEvent).data) as { peers: Peer[] }).peers });
    });
    let reopened = resume;
    events.onopen = () => {
      usePresence.setState({ live: true });
      reportPresence();
      streamWorked = true;
      // The stream came back after a drop: save what waited and catch up on what was missed.
      if (reopened) void reconnectWorkspace();
      reopened = true;
    };
    events.onerror = () => {
      usePresence.setState({ live: false });
      // An error page (for example from a proxy while the server restarts) ends the stream for good.
      if (events?.readyState === EventSource.CLOSED && streamWorked) eventsClosed = true;
    };
  }
  // Fallback when live events are blocked by a proxy.
  const interval = setInterval(() => {
    if (document.visibilityState !== 'visible' || usePresence.getState().live) return;
    if (eventsClosed) void reconnectWorkspace();
    else schedulePull(0);
  }, 15000);
  const heartbeat = setInterval(() => {
    if (document.visibilityState === 'visible') reportPresence();
  }, 45000);
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (!pendingChanges()) return;
    if (unpersisted()) void persistPending();
    // Changes already kept in this browser come back on the next visit; warn only about the rest.
    if (unpersisted()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (unpersisted()) void persistPending();
      void flushWorkspace();
    } else {
      schedulePull(0);
      reportPresence();
    }
  };
  const onPageHide = () => {
    if (unpersisted()) void persistPending();
  };
  const onOnline = () => {
    stopRetry();
    void reconnectWorkspace();
  };
  const onOffline = () => {
    if (unpersisted()) void persistPending();
    goOffline();
  };
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibility);
  stopSync = () => {
    unsub();
    events?.close();
    clearTimeout(flushTimer);
    clearTimeout(pullTimer);
    clearTimeout(persistTimer);
    stopRetry();
    clearInterval(interval);
    clearInterval(heartbeat);
    releaseLock();
    usePresence.setState({ peers: [], live: false });
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  // Restarted with edits still waiting (the live stream was reopened): keep saving them.
  if (pendingChanges()) {
    schedulePersist();
    if (useAuth.getState().sync !== 'offline') scheduleFlush();
  }
}
export async function enterAccount(user: AuthUser) {
  await flushLocalStorage();
  stopSync?.();
  sessionStorage.removeItem('done:mode');
  setRemoteStorage(true);
  base = null;
  revision = 0;
  unsavedOffline = false;
  streamWorked = false;
  eventsRevivedAt = 0;
  useAuth.setState({ user, mode: 'loading', error: '', sync: 'saved', syncError: '' });
  const empty = createEmptyData(useData.getState().prefs.lang);
  let privateSettings = { plane: empty.plane, ai: empty.ai };
  try {
    privateSettings = { ...privateSettings, ...JSON.parse(localStorage.getItem(`done:private:${user.id}`) || '{}') };
  } catch {
    /* keep defaults */
  }
  useData.setState(privateSettings);
  try {
    const prefs = JSON.parse(localStorage.getItem(`done:prefs:${user.id}`) || 'null');
    if (prefs) useData.getState().setPrefs(prefs);
  } catch {
    /* keep defaults */
  }
  try {
    await exclusive(() => pull(false));
    useAuth.setState({ mode: 'signedIn' });
    startSync();
  } catch (e) {
    useAuth.setState({ mode: 'signedOut', error: (e as Error).message });
    return;
  }
  await restoreUnsaved(user.id);
}
export async function bootstrapAuth() {
  try {
    const result = await api<{ user: AuthUser | null; setup: boolean }>('/api/auth/session');
    useAuth.setState({ setup: result.setup });
    if (result.user) await enterAccount(result.user);
    else if (sessionStorage.getItem('done:mode') === 'local' && !new URLSearchParams(location.search).has('invite')) await enterLocal();
    else useAuth.setState({ mode: 'signedOut' });
  } catch (e) {
    useAuth.setState({ mode: 'signedOut', error: (e as Error).message });
  }
}
export async function enterLocal() {
  sessionStorage.setItem('done:mode', 'local');
  stopSync?.();
  setRemoteStorage(false);
  await useData.persist.rehydrate();
  useAuth.setState({ mode: 'local', user: null, error: '' });
}
export async function logout() {
  await flushLocalStorage();
  sessionStorage.removeItem('done:mode');
  await flushWorkspace();
  if (hasUnsavedChanges()) {
    const offline = useAuth.getState().sync === 'offline';
    toast({ message: tr(offline ? 'sync.logoutOffline' : 'sync.logoutUnsaved'), tone: offline ? 'default' : 'error' });
    return;
  }
  if (useAuth.getState().mode === 'signedIn') {
    try {
      await api('/api/auth/logout', 'POST', {});
    } catch (error) {
      // The session can only be ended on the server; signing out locally would leave it active.
      if (classifyFailure(error) !== 'offline') throw error;
      toast({ message: tr('sync.logoutNoNetwork') });
      return;
    }
  }
  stopSync?.();
  stopSync = undefined;
  unsavedOffline = false;
  setRemoteStorage(true);
  applying = true;
  useData.getState().replaceAll(createEmptyData(useData.getState().prefs.lang));
  applying = false;
  base = null;
  useAuth.setState({ mode: 'signedOut', user: null, sync: 'saved', error: '' });
}

/**
 * Client-side mirror of the server permissions, so a blocked change is refused
 * right away with a clear message instead of failing when it is saved.
 */
function allowedAction(action: string, args: unknown[], user: AuthUser): boolean {
  const s = useData.getState();
  const edit = (...projectIds: (string | undefined)[]) => projectIds.every((id) => canEditProject(id));
  const itemProject = (id: unknown) => s.items[id as string]?.projectId;
  const docProject = (id: unknown) => s.docs[id as string]?.projectId;
  const nodeProject = (id: unknown) => s.files[id as string]?.projectId;
  const sprintProject = (id: unknown) => s.sprints[id as string]?.projectId;
  const ids = (value: unknown) => (Array.isArray(value) ? (value as string[]) : []);
  const patch = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const moveTarget = (value: unknown) => (patch(value).projectId as string | undefined) ?? undefined;
  switch (action) {
    case 'markNotifications':
    case 'archiveNotifications':
    case 'pushTrash':
    case 'restore':
      return true;
    case 'addPerson':
    case 'removePerson':
    case 'updateWorkspace':
    case 'createGroup':
    case 'updateGroup':
    case 'deleteGroup':
    case 'emptyTrash':
    case 'purgeTrash':
    case 'restoreTrash':
      return isAdmin(user);
    case 'updatePerson':
      return args[0] === user.id || isAdmin(user);
    case 'createProject':
    case 'duplicateProject':
      return canCreateProjects();
    case 'deleteProject':
      return isAdmin(user) || s.projects[args[0] as string]?.createdBy === user.id;
    case 'updateProject':
    case 'moveProject':
    case 'setMap':
    case 'createSprint':
    case 'applyPlaneStates':
      return edit(args[0] as string);
    case 'createItem':
      return edit(patch(args[0]).projectId as string);
    case 'updateItem':
    case 'duplicateItem':
      return edit(itemProject(args[0])) && (!moveTarget(args[1]) || edit(moveTarget(args[1])));
    case 'updateItems':
      return edit(...ids(args[0]).map(itemProject)) && (!moveTarget(args[1]) || edit(moveTarget(args[1])));
    case 'deleteItems':
    case 'reorderItems':
      return edit(...ids(args[0]).map(itemProject));
    case 'createDoc': {
      const p = patch(args[0]);
      return edit((p.projectId as string | undefined) ?? (p.parentId ? docProject(p.parentId) : undefined));
    }
    case 'updateDoc':
    case 'duplicateDoc':
    case 'deleteDoc':
      return edit(docProject(args[0]));
    case 'moveDoc':
      return edit(docProject(args[0])) && (!args[1] || edit(docProject(args[1])));
    case 'createFolder':
    case 'createLink':
    case 'addFile':
      return edit(patch(args[0]).projectId as string | undefined);
    case 'updateNode':
      return edit(nodeProject(args[0]));
    case 'deleteNodes':
      return edit(...ids(args[0]).map(nodeProject));
    case 'moveNodes':
      return edit(...ids(args[0]).map(nodeProject)) && edit(args[2] as string | undefined);
    case 'addComment': {
      const target = args[0] === 'item' ? itemProject(args[1]) : docProject(args[1]);
      return canCommentProject(target);
    }
    case 'updateComment':
    case 'deleteComment':
      return s.comments[args[0] as string]?.authorId === user.id || isAdmin(user);
    case 'updateSprint':
    case 'startSprint':
    case 'completeSprint':
    case 'deleteSprint':
      return edit(sprintProject(args[0]));
    default:
      return user.role !== 'viewer';
  }
}

setMutationPolicy((action, args) => {
  const { mode, user } = useAuth.getState();
  if (mode !== 'signedIn' || !user) return true;
  const allowed = allowedAction(action, args, user);
  if (!allowed)
    toast({
      message: useData.getState().prefs.lang === 'ru' ? 'Недостаточно прав для этого действия.' : 'You do not have permission for this action.',
      tone: 'error',
    });
  return allowed;
});
