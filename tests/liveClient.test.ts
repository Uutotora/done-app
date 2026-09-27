import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enterAccount, hasUnsavedChanges, receiveRevision, useAuth, type AuthUser } from '@/lib/auth';
import { applyDelta } from '@/lib/liveDelta';
import { createEmptyData, useData } from '@/lib/store';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ts = '2026-09-01T00:00:00.000Z';
const user: AuthUser = { id: 'u1', name: 'Owner', email: 'owner@example.com', role: 'owner', projectIds: null };
const task = (id: string, extra: Json = {}) => ({
  id,
  projectId: 'p1',
  type: 'task',
  title: id,
  status: 'backlog',
  priority: 'none',
  tags: [],
  order: 1,
  createdAt: ts,
  updatedAt: ts,
  ...extra,
});

/** A fake server: what GET /api/workspace returns, and how many times the whole workspace was downloaded. */
const server: { data: Json; revision: number; gets: number } = { data: {}, revision: 5, gets: 0 };
const noop = () => undefined;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const memory = new Map<string, string>();
  const storage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal('EventSource', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (path === '/api/workspace' && method === 'GET') {
        server.gets++;
        return reply({ data: structuredClone(server.data), revision: server.revision, user });
      }
      return reply({ ok: true });
    }),
  );
  const { prefs: _prefs, plane: _plane, ai: _ai, ...data } = createEmptyData('en') as unknown as Json;
  server.data = {
    ...data,
    projects: { p1: { id: 'p1', name: 'P1', icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts } },
    items: { i1: task('i1', { title: 'Server title' }) },
    meId: user.id,
    onboarded: true,
  };
  await enterAccount(user);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('live deltas in the browser', () => {
  it('applies a teammate change without reloading and keeps unsaved local edits', async () => {
    expect(useAuth.getState().mode).toBe('signedIn');
    expect(server.gets).toBe(1);
    useData.getState().updateItem('i1', { title: 'Local title' });
    expect(hasUnsavedChanges()).toBe(true);
    const docs = useData.getState().docs;
    const p1 = useData.getState().projects.p1;

    await receiveRevision({
      revision: 6,
      baseRevision: 5,
      actorId: 'u2',
      delta: { records: { items: { i1: task('i1', { title: 'Server title', status: 'done' }), i2: task('i2') } } },
    });
    const state = useData.getState();
    expect(server.gets).toBe(1);
    // Both edits survive: the teammate's status and this tab's title.
    expect(state.items.i1).toMatchObject({ title: 'Local title', status: 'done' });
    expect(state.items.i2).toBeDefined();
    // Untouched collections and records keep their identity, so the UI does not redraw everything.
    expect(state.docs).toBe(docs);
    expect(state.projects.p1).toBe(p1);
    // The local edit is still waiting to be saved, now on top of the new revision.
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('ignores updates it already has and reloads after a gap', async () => {
    await receiveRevision({ revision: 6, baseRevision: 5, delta: { records: { items: { i1: null } } } });
    expect(useData.getState().items.i1).toBeDefined();
    server.revision = 9;
    server.data = { ...server.data, items: { ...server.data.items, i2: task('i2'), i3: task('i3', { title: 'Missed' }) } };
    await receiveRevision({ revision: 9, baseRevision: 8, delta: { records: { items: { i3: task('i3', { title: 'Missed' }) } } } });
    expect(server.gets).toBe(2);
    expect(useData.getState().items.i3.title).toBe('Missed');
    expect(useData.getState().items.i1.title).toBe('Local title');
  });

  it('removes records the delta marks as gone and keeps the order of lists', () => {
    const base = { items: { a: { id: 'a' }, b: { id: 'b' } }, docs: {}, activity: [{ id: 'x1' }, { id: 'x2' }], trash: [{ id: 't1' }] };
    const next = applyDelta(base, {
      records: { items: { a: null, c: { id: 'c' } }, unknown: { z: { id: 'z' } } },
      activity: { add: [{ id: 'x3' }], remove: ['x1'] },
      trash: { add: [{ id: 't2' }], remove: [] },
    });
    expect(Object.keys(next.items)).toEqual(['b', 'c']);
    expect(next.items.b).toBe(base.items.b);
    expect(next.docs).toBe(base.docs);
    expect(next).not.toHaveProperty('unknown');
    expect(next.activity.map((a) => a.id)).toEqual(['x2', 'x3']);
    expect(next.trash.map((e) => e.id)).toEqual(['t2', 't1']);
  });
});
