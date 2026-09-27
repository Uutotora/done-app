import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeSet } from '../server/merge.mjs';
import { api, enterAccount, flushWorkspace, logout, useAuth, type AuthUser } from '@/lib/auth';
import {
  classifyFailure,
  loadPendingEntries,
  loadRestorable,
  pendingKey,
  PENDING_TTL,
  replayPending,
  retryDelay,
  savePendingEntry,
} from '@/lib/offline';
import { createEmptyData, useData } from '@/lib/store';
import { useUI } from '@/lib/ui';

const ts = '2026-01-01T00:00:00.000Z';
const project = (id: string, name: string) => ({ id, name, icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts });
const shared = (projects: Record<string, unknown> = {}) => ({ ...createEmptyData('en'), projects }) as unknown as Record<string, unknown>;
const change = (id: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): ChangeSet => ({
  records: { projects: { [id]: { before, after } } },
});
/** Loading "at the end of time" treats every stored entry as expired, which removes them all. */
const clearEntries = () => loadPendingEntries('', Number.POSITIVE_INFINITY);

describe('telling a lost connection from a real error', () => {
  it('treats no answer, gateway errors and non-JSON answers as offline', () => {
    expect(classifyFailure(Object.assign(new TypeError('Failed to fetch'), { network: true }))).toBe('offline');
    expect(classifyFailure(new TypeError('Load failed'))).toBe('offline');
    expect(classifyFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('offline');
    for (const status of [502, 503, 504]) expect(classifyFailure({ status, json: true })).toBe('offline');
    expect(classifyFailure({ status: 500, json: false })).toBe('offline');
    expect(classifyFailure({ status: 200, json: false })).toBe('offline');
    // The browser says it has no network: whatever failed without an answer is offline.
    expect(classifyFailure(new Error('boom'), false)).toBe('offline');
  });

  it('keeps real errors and signed out sessions apart', () => {
    for (const status of [400, 403, 409, 413, 500]) expect(classifyFailure({ status, json: true })).toBe('error');
    expect(classifyFailure({ status: 401, json: true })).toBe('signedOut');
    expect(classifyFailure(new Error('boom'), true)).toBe('error');
    expect(classifyFailure(new TypeError('x is not a function'), true)).toBe('error');
    expect(classifyFailure(undefined, true)).toBe('error');
  });

  it('backs off 2 s, 5 s, 10 s, then 30 s', () => {
    expect([0, 1, 2, 3, 4, 20].map(retryDelay)).toEqual([2000, 5000, 10000, 30000, 30000, 30000]);
  });

  it('describes failed API requests so they can be classified', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(api('/api/workspace')).rejects.toMatchObject({ network: true });
      fetch.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
      const gateway = await api('/api/workspace').catch((e) => e);
      expect(gateway).toMatchObject({ status: 502, json: false });
      expect(classifyFailure(gateway, true)).toBe('offline');
      fetch.mockResolvedValueOnce(Response.json({ error: 'Read-only access' }, { status: 403 }));
      const denied = await api('/api/workspace').catch((e) => e);
      expect(denied).toMatchObject({ status: 403, json: true, message: 'Read-only access' });
      expect(classifyFailure(denied, true)).toBe('error');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('unsaved changes kept in the browser', () => {
  beforeEach(clearEntries);

  it('returns only the entries of this person and drops expired ones', async () => {
    const now = Date.now();
    const mine = { userId: 'u1', revision: 3, changes: change('p1', null, project('p1', 'Mine')), savedAt: now - 1000 };
    await savePendingEntry(pendingKey('u1', 'tab-a'), mine);
    await savePendingEntry(pendingKey('u2', 'tab-b'), { ...mine, userId: 'u2' });
    await savePendingEntry(pendingKey('u1', 'tab-c'), { ...mine, savedAt: now - PENDING_TTL - 1 });
    await savePendingEntry('damaged', { userId: 'u1' } as never);

    const found = await loadPendingEntries('u1', now);
    expect(found.map((s) => s.key)).toEqual([pendingKey('u1', 'tab-a')]);
    expect(found[0].entry).toEqual(mine);
    // Expired and damaged entries are gone; the other person's entry is left alone.
    expect((await loadPendingEntries('u2', now)).map((s) => s.key)).toEqual([pendingKey('u2', 'tab-b')]);
    expect((await loadPendingEntries('u1', now)).length).toBe(1);
  });

  it('leaves entries of tabs that are still open to those tabs', async () => {
    const entry = { userId: 'u1', revision: 1, changes: change('p1', null, project('p1', 'A')), savedAt: Date.now() };
    await savePendingEntry(pendingKey('u1', 'open'), entry);
    await savePendingEntry(pendingKey('u1', 'closed'), entry);
    await savePendingEntry(pendingKey('u1', 'me'), entry);
    const held = ['open', 'me'].map((tab) => ({ name: `done-pending:${pendingKey('u1', tab)}` }));
    vi.stubGlobal('navigator', { onLine: true, locks: { query: async () => ({ held }) } });
    try {
      const keys = (await loadRestorable('u1', pendingKey('u1', 'me'))).map((s) => s.key).sort();
      expect(keys).toEqual([pendingKey('u1', 'closed'), pendingKey('u1', 'me')]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('replays stored edits field by field on top of fresh data', () => {
    const before = project('p1', 'Launch');
    const stored = [
      {
        key: 'k',
        entry: { userId: 'u1', revision: 1, changes: change('p1', before, { ...before, name: 'Launch v2' }), savedAt: 1 },
      },
    ];
    // A teammate changed another field of the same project in the meantime.
    const fresh = shared({ p1: { ...before, status: 'at_risk' } });
    const merged = replayPending(fresh, stored) as { projects: Record<string, { name: string; status: string }> };
    expect(merged.projects.p1).toMatchObject({ name: 'Launch v2', status: 'at_risk' });
  });
});

describe('saving across a lost connection', () => {
  const user: AuthUser = { id: 'u-owner', name: 'Owner', email: 'owner@example.com', role: 'owner', projectIds: null };
  const server = { data: shared({ p0: project('p0', 'Server') }), revision: 1, patches: [] as { changes: ChangeSet }[], offline: false };
  const fetch = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (server.offline) throw new TypeError('Failed to fetch');
    const method = init.method ?? 'GET';
    if (path === '/api/workspace' && method === 'GET') return Response.json({ data: server.data, revision: server.revision, user });
    if (path === '/api/workspace' && method === 'PATCH') {
      server.patches.push(JSON.parse(String(init.body)));
      return Response.json({ revision: ++server.revision });
    }
    return Response.json({ ok: true });
  });
  const memoryStorage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
      removeItem: (k: string) => void values.delete(k),
    };
  };
  const toasts = () => useUI.getState().toasts.map((t) => t.message);
  const patchedProjects = () => server.patches.flatMap((p) => Object.keys(p.changes.records.projects ?? {}));
  const window = new EventTarget();

  beforeAll(() => {
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', window);
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    useData.getState().setPrefs({ lang: 'en' });
  });
  afterAll(async () => {
    server.offline = false;
    await logout();
    vi.unstubAllGlobals();
  });

  it('brings back this person’s unsaved changes on sign in and saves them', async () => {
    await clearEntries();
    const now = Date.now();
    const mine = { userId: user.id, revision: 1, changes: change('p-restored', null, project('p-restored', 'Restored')), savedAt: now };
    await savePendingEntry(pendingKey(user.id, 'closed-tab'), mine);
    await savePendingEntry(pendingKey('someone-else', 'tab'), {
      ...mine,
      userId: 'someone-else',
      changes: change('p-other', null, project('p-other', 'Other')),
    });
    await savePendingEntry(pendingKey(user.id, 'old-tab'), {
      ...mine,
      changes: change('p-old', null, project('p-old', 'Old')),
      savedAt: now - PENDING_TTL - 1,
    });

    await enterAccount(user);

    expect(useAuth.getState().mode).toBe('signedIn');
    const projects = useData.getState().projects;
    expect(projects['p-restored']?.name).toBe('Restored');
    expect(projects.p0?.name).toBe('Server');
    expect(projects['p-other']).toBeUndefined();
    expect(projects['p-old']).toBeUndefined();
    expect(toasts()).toContain('Restored unsaved changes');

    await flushWorkspace();
    expect(useAuth.getState().sync).toBe('saved');
    expect(patchedProjects()).toEqual(['p-restored']);
    await vi.waitFor(async () => expect(await loadPendingEntries(user.id)).toEqual([]));
    expect((await loadPendingEntries('someone-else')).length).toBe(1);
  });

  it('goes calmly offline, keeps the edits, and saves them when the network is back', async () => {
    server.patches = [];
    const id = useData.getState().createProject({ name: 'Written offline' });
    server.offline = true;
    await flushWorkspace();
    expect(useAuth.getState()).toMatchObject({ sync: 'offline', syncError: '' });
    // The edits wait in IndexedDB in case the tab is closed before the network returns.
    await vi.waitFor(async () => {
      const [stored] = await loadPendingEntries(user.id);
      expect(Object.keys(stored?.entry.changes.records.projects ?? {})).toContain(id);
    });

    // Edits keep working while offline.
    useData.getState().updateProject(id, { name: 'Written offline, edited' });
    expect(useAuth.getState().sync).toBe('offline');

    server.offline = false;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(useAuth.getState().sync).toBe('saved'));
    expect(patchedProjects()).toContain(id);
    const saved = server.patches.at(-1)!.changes.records.projects[id].after as { name: string };
    expect(saved.name).toBe('Written offline, edited');
    expect(toasts()).toContain('Back online, changes saved');
    await vi.waitFor(async () => expect(await loadPendingEntries(user.id)).toEqual([]));
  });

  it('refuses to sign out while offline changes are waiting', async () => {
    useData.getState().createProject({ name: 'Not yet saved' });
    server.offline = true;
    await logout();
    expect(useAuth.getState().mode).toBe('signedIn');
    expect(toasts().at(-1)).toBe('No connection. Sign out once you are back online so your changes are not lost.');
    server.offline = false;
    await flushWorkspace();
    expect(useAuth.getState().sync).toBe('saved');
  });
});
