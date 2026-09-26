import { create } from 'zustand';
import { createEmptyData, dataSnapshot, useData } from './store';
import { flushLocalStorage, setRemoteStorage } from './storage';
import { setMutationPolicy } from './mutationPolicy';
import { toast } from './ui';
import type { DataState } from './types';

export type AccessRole = 'owner' | 'admin' | 'member' | 'viewer';
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: AccessRole;
  projectIds: string[] | null;
  disabled?: boolean;
}
type SyncStatus = 'saved' | 'saving' | 'error' | 'conflict';
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
export function canEditProject(projectId?: string) {
  const { mode, user } = useAuth.getState();
  return mode === 'local' || !user
    ? mode === 'local'
    : user.role !== 'viewer' && (isAdmin(user) || user.projectIds === null || (!!projectId && user.projectIds.includes(projectId)));
}
export async function api<T = Record<string, unknown>>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-done-client': 'web' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed'), { status: response.status });
  return result as T;
}
let stopSync: (() => void) | undefined;
let revision = 0;
let lastSaved = '';
let applying = false;
let inFlight: Promise<void> | undefined;
const serialize = () => {
  const { prefs, plane, ai, meId, ...data } = dataSnapshot();
  return JSON.stringify(data);
};
function applyRemote(data: Partial<DataState>, user: AuthUser, rev: number) {
  applying = true;
  const { prefs, plane, ai } = useData.getState();
  useData.getState().replaceAll({ ...createEmptyData(prefs.lang), ...data, meId: user.id, onboarded: true, prefs, plane, ai });
  revision = rev;
  lastSaved = serialize();
  applying = false;
  useAuth.setState({ user, sync: 'saved', syncError: '' });
}
export async function refreshWorkspace() {
  const result = await api<{ data: DataState; revision: number; user: AuthUser }>('/api/workspace');
  applyRemote(result.data, result.user, result.revision);
}
export async function flushWorkspace(): Promise<void> {
  if (inFlight) {
    await inFlight;
    if (serialize() !== lastSaved && useAuth.getState().sync === 'saved') return flushWorkspace();
    return;
  }
  if (useAuth.getState().mode !== 'signedIn' || serialize() === lastSaved || useAuth.getState().sync === 'conflict') return;
  const snapshot = serialize();
  useAuth.setState({ sync: 'saving', syncError: '' });
  inFlight = (async () => {
    try {
      const result = await api<{ revision: number }>('/api/workspace', 'PUT', { data: JSON.parse(snapshot), revision });
      revision = result.revision;
      lastSaved = snapshot;
      useAuth.setState({ sync: 'saved' });
    } catch (error) {
      const e = error as Error & { status?: number };
      useAuth.setState({ sync: e.status === 409 ? 'conflict' : 'error', syncError: e.message });
    } finally {
      inFlight = undefined;
    }
  })();
  await inFlight;
}
function startSync() {
  stopSync?.();
  let timer: ReturnType<typeof setTimeout>;
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
    if (applying || serialize() === lastSaved) return;
    useAuth.setState((s) => (s.sync === 'conflict' ? {} : { sync: 'saving' }));
    clearTimeout(timer);
    timer = setTimeout(() => void flushWorkspace(), 500);
  });
  const interval = setInterval(async () => {
    if (document.visibilityState !== 'visible' || inFlight || serialize() !== lastSaved) return;
    try {
      const result = await api<{ data: DataState; revision: number; user: AuthUser }>('/api/workspace');
      if (serialize() === lastSaved && !inFlight && result.revision !== revision) applyRemote(result.data, result.user, result.revision);
    } catch (error) {
      useAuth.setState({ sync: 'error', syncError: (error as Error).message });
    }
  }, 10000);
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (serialize() !== lastSaved) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flushWorkspace();
  };
  window.addEventListener('beforeunload', beforeUnload);
  document.addEventListener('visibilitychange', onHidden);
  stopSync = () => {
    unsub();
    clearTimeout(timer);
    clearInterval(interval);
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('visibilitychange', onHidden);
  };
}
export async function enterAccount(user: AuthUser) {
  await flushLocalStorage();
  stopSync?.();
  sessionStorage.removeItem('done:mode');
  setRemoteStorage(true);
  useAuth.setState({ user, mode: 'loading', error: '' });
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
    await refreshWorkspace();
    useAuth.setState({ mode: 'signedIn' });
    startSync();
  } catch (e) {
    useAuth.setState({ mode: 'signedOut', error: (e as Error).message });
  }
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
  if (useAuth.getState().mode === 'signedIn' && serialize() !== lastSaved) {
    toast({ message: 'Сначала сохраните изменения или разрешите конфликт.', tone: 'error' });
    return;
  }
  if (useAuth.getState().mode === 'signedIn') await api('/api/auth/logout', 'POST', {});
  stopSync?.();
  stopSync = undefined;
  setRemoteStorage(true);
  applying = true;
  useData.getState().replaceAll(createEmptyData(useData.getState().prefs.lang));
  applying = false;
  useAuth.setState({ mode: 'signedOut', user: null, sync: 'saved', error: '' });
}

setMutationPolicy((action, args) => {
  const { mode, user } = useAuth.getState();
  if (mode !== 'signedIn' || !user) return true;
  const adminActions = ['addPerson', 'removePerson', 'updateWorkspace', 'createGroup', 'updateGroup', 'deleteGroup', 'emptyTrash', 'purgeTrash'];
  let allowed = user.role !== 'viewer' && (!adminActions.includes(action) || isAdmin(user));
  if (action === 'updatePerson' && args[0] !== user.id && !isAdmin(user)) allowed = false;
  if (action === 'createProject' && user.projectIds !== null && !isAdmin(user)) allowed = false;
  if (!allowed)
    toast({
      message: useData.getState().prefs.lang === 'ru' ? 'Недостаточно прав для этого действия.' : 'You do not have permission for this action.',
      tone: 'error',
    });
  return allowed;
});
