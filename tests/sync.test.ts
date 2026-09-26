import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
import { applyShared, diffShared } from '../server/merge.mjs';
import { createEmptyData } from '@/lib/store';

let server: Server;
let url = '';
let api: ReturnType<typeof createAuthApi>;
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const ts = '2026-09-01T00:00:00.000Z';

const call = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
  fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookies[who] ?? '' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
const load = async (who: string) => (await call('/api/workspace', 'GET', undefined, who)).json();
const patch = (who: string, changes: unknown) => call('/api/workspace', 'PATCH', { changes }, who);
const item = (id: string, projectId: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectId,
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

async function join(name: string, role: string, projectIds: string[] | null) {
  const invite = await (await call('/api/admin/invites', 'POST', { email: `${name}@example.com`, role, projectIds })).json();
  const response = await call(
    '/api/auth/register',
    'POST',
    { name, email: `${name}@example.com`, password: `a-long-${name}-password`, invite: invite.token },
    '',
  );
  cookies[name] = response.headers.get('set-cookie')!.split(';')[0];
  ids[name] = (await response.json()).user.id;
}

beforeAll(async () => {
  api = createAuthApi({ filename: ':memory:' });
  server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const data = createEmptyData('en');
  data.projects = Object.fromEntries(
    ['alpha', 'secret'].map((id) => [id, { id, name: id, icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts }]),
  ) as typeof data.projects;
  data.items = { shared: item('shared', 'alpha'), hidden: item('hidden', 'secret') } as unknown as typeof data.items;
  const response = await call(
    '/api/auth/register',
    'POST',
    { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data },
    '',
  );
  cookies.owner = response.headers.get('set-cookie')!.split(';')[0];
  ids.owner = (await response.json()).user.id;
  await join('mia', 'member', ['alpha']);
  await join('leo', 'member', null);
  await join('vic', 'viewer', ['alpha']);
});

afterAll(async () => {
  api.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('change sets', () => {
  it('diffs by record and replays unsaved edits on top of fresh data', () => {
    const a = { items: { x: { id: 'x', title: 'A', status: 'backlog' } }, workspace: { name: 'W' }, activity: [], trash: [] };
    const local = { ...a, items: { x: { ...a.items.x, title: 'Local title' } } };
    const changes = diffShared(a, local)!;
    expect(Object.keys(changes.records)).toEqual(['items']);
    const remote = { ...a, items: { x: { ...a.items.x, status: 'done' } } };
    expect(applyShared(remote, changes).items.x).toEqual({ id: 'x', title: 'Local title', status: 'done' });
    expect(diffShared(a, a)).toBeNull();
  });
});

describe('team sync on the server', () => {
  it('keeps both edits when two members change different fields of one task at once', async () => {
    const base = (await load('mia')).data.items.shared;
    expect((await patch('mia', { records: { items: { shared: { before: base, after: { ...base, status: 'in_progress' } } } } })).status).toBe(200);
    expect((await patch('leo', { records: { items: { shared: { before: base, after: { ...base, assigneeId: ids.leo } } } } })).status).toBe(200);
    const merged = (await load('owner')).data.items.shared;
    expect(merged.status).toBe('in_progress');
    expect(merged.assigneeId).toBe(ids.leo);
  });

  it('never exposes or accepts hidden records', async () => {
    const mia = await load('mia');
    expect(mia.data.items.hidden).toBeUndefined();
    const hidden = item('hidden', 'alpha', { title: 'Injected' });
    expect((await patch('mia', { records: { items: { hidden: { before: null, after: hidden } } } })).status).toBe(403);
    expect((await patch('mia', { records: { items: { x2: { before: null, after: item('x2', 'secret') } } } })).status).toBe(403);
    expect((await load('owner')).data.items.hidden.title).toBe('hidden');
  });

  it('saves project maps and keeps saving afterwards', async () => {
    const map = { nodes: [{ id: 'n', kind: 'goal', x: 0, y: 0, text: 'Goal' }], edges: [], updatedAt: ts };
    expect((await patch('owner', { records: { maps: { alpha: { before: null, after: map } } } })).status).toBe(200);
    const mia = await load('mia');
    expect(mia.data.maps.alpha.nodes).toHaveLength(1);
    const base = mia.data.items.shared;
    expect((await patch('mia', { records: { items: { shared: { before: base, after: { ...base, title: 'After map' } } } } })).status).toBe(200);
    // The legacy full-snapshot save no longer trips over maps either.
    const full = await load('owner');
    full.data.items.shared.priority = 'high';
    expect((await call('/api/workspace', 'PUT', full)).status).toBe(200);
    expect((await patch('mia', { records: { maps: { secret: { before: null, after: map } } } })).status).toBe(403);
  });

  it('keeps a task deleted even if someone edits it concurrently', async () => {
    const created = item('temp', 'alpha');
    await patch('owner', { records: { items: { temp: { before: null, after: created } } } });
    await patch('owner', { records: { items: { temp: { before: created, after: null } } } });
    expect((await patch('mia', { records: { items: { temp: { before: created, after: { ...created, title: 'Late edit' } } } } })).status).toBe(200);
    expect((await load('owner')).data.items.temp).toBeUndefined();
  });

  it('only lets authors post and edit their comments', async () => {
    const comment = { id: 'c1', targetKind: 'item', targetId: 'shared', authorId: ids.mia, text: 'Hi', createdAt: ts };
    expect((await patch('leo', { records: { comments: { c1: { before: null, after: comment } } } })).status).toBe(403);
    expect((await patch('mia', { records: { comments: { c1: { before: null, after: comment } } } })).status).toBe(200);
    expect((await patch('leo', { records: { comments: { c1: { before: comment, after: { ...comment, text: 'Edited' } } } } })).status).toBe(403);
    expect((await patch('leo', { records: { comments: { c1: { before: comment, after: null } } } })).status).toBe(403);
  });

  it('delivers notifications only to their recipient', async () => {
    const note = {
      id: 'n1',
      recipientId: ids.vic,
      actorId: ids.mia,
      kind: 'assigned',
      targetKind: 'item',
      targetId: 'shared',
      projectId: 'alpha',
      createdAt: ts,
    };
    expect((await patch('mia', { records: { notifications: { n1: { before: null, after: { ...note, actorId: ids.owner } } } } })).status).toBe(403);
    expect((await patch('mia', { records: { notifications: { n1: { before: null, after: note } } } })).status).toBe(200);
    expect((await load('mia')).data.notifications.n1).toBeUndefined();
    const inbox = (await load('vic')).data.notifications;
    expect(inbox.n1.kind).toBe('assigned');
    // Viewers can mark their own inbox as read but still cannot edit work.
    expect((await patch('vic', { records: { notifications: { n1: { before: inbox.n1, after: { ...inbox.n1, readAt: ts } } } } })).status).toBe(200);
    const task = (await load('vic')).data.items.shared;
    expect((await patch('vic', { records: { items: { shared: { before: task, after: { ...task, title: 'Viewer' } } } } })).status).toBe(403);
    expect((await patch('leo', { records: { notifications: { n1: { before: inbox.n1, after: { ...inbox.n1, archivedAt: ts } } } } })).status).toBe(
      403,
    );
    expect((await load('vic')).data.notifications.n1.readAt).toBe(ts);
  });

  it('streams revisions and presence to signed-in members', async () => {
    const controller = new AbortController();
    const response = await fetch(`${url}/api/events`, { headers: { cookie: cookies.leo }, signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
    };
    await readUntil('event: presence');
    await call('/api/presence', 'POST', { path: '/p/alpha/board' }, 'leo');
    await readUntil('/p/alpha/board');
    const base = (await load('owner')).data.items.shared;
    const saved = await (await patch('owner', { records: { items: { shared: { before: base, after: { ...base, title: 'Live' } } } } })).json();
    await readUntil(`"revision":${saved.revision}`);
    controller.abort();
    expect((await fetch(`${url}/api/events`)).status).toBe(401);
  });
});
