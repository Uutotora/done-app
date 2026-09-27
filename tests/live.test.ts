import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
import { applyDelta, type RevisionEvent, type WorkspaceDelta } from '@/lib/liveDelta';
import { createEmptyData } from '@/lib/store';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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
const load = async (who: string): Promise<Json> => (await (await call('/api/workspace', 'GET', undefined, who)).json()).data;
async function patch(who: string, changes: unknown): Promise<number> {
  const res = await call('/api/workspace', 'PATCH', { changes }, who);
  expect(res.status).toBe(200);
  return (await res.json()).revision;
}
const project = (id: string, extra: Json = {}) => ({
  id,
  name: `Project ${id}`,
  icon: '📁',
  color: 'blue',
  status: 'on_track',
  order: 1,
  createdAt: ts,
  updatedAt: ts,
  ...extra,
});
const task = (id: string, projectId: string, extra: Json = {}) => ({
  id,
  projectId,
  type: 'task',
  title: `Task ${id}`,
  status: 'backlog',
  priority: 'none',
  tags: [],
  order: 1,
  createdAt: ts,
  updatedAt: ts,
  ...extra,
});
const doc = (id: string, projectId: string, extra: Json = {}) => ({
  id,
  projectId,
  title: `Doc ${id}`,
  order: 1,
  createdAt: ts,
  updatedAt: ts,
  ...extra,
});
const comment = (id: string, targetId: string, authorId: string, targetKind = 'item') => ({
  id,
  targetKind,
  targetId,
  authorId,
  text: id,
  createdAt: ts,
});
const activity = (id: string, itemId: string) => ({ id, itemId, actorId: ids.owner, kind: 'status', from: 'backlog', to: 'done', at: ts });
const group = (id: string) => ({ id, name: id, icon: '📂', order: 1 });
/** Record change helpers: the owner sees everything, so its view is the "before" of every edit. */
const edit = async (key: string, id: string, update: (r: Json) => Json | null) => {
  const before = (await load('owner'))[key][id] ?? null;
  return { [key]: { [id]: { before, after: update(before) } } };
};

/** Reads one member's live stream and collects its events. */
async function openStream(who: string) {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/events`, { headers: { cookie: cookies[who] }, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: Json }[] = [];
  let buffer = '';
  let wake = () => {};
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
        wake();
      }
    } catch {
      /* aborted */
    }
  })();
  /** The live update for one saved revision. */
  const revision = async (rev: number): Promise<RevisionEvent> => {
    for (;;) {
      const found = events.find((e) => e.event === 'revision' && e.data.revision === rev && 'baseRevision' in e.data);
      if (found) return found.data as RevisionEvent;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  };
  await new Promise<void>((resolve) => {
    const check = () => (events.some((e) => e.event === 'revision') ? resolve() : void (wake = check));
    check();
  });
  return { events, revision, close: () => controller.abort() };
}

beforeAll(async () => {
  api = createAuthApi({ filename: ':memory:' });
  server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const data = createEmptyData('en') as unknown as Json;
  data.groups = { g1: group('g1'), g2: group('g2') };
  data.projects = { p1: project('p1', { groupId: 'g1' }), p2: project('p2', { groupId: 'g2' }) };
  data.items = { i1: task('i1', 'p1'), i2: task('i2', 'p2'), i3: task('i3', 'p1', { dependsOn: ['i1'] }) };
  data.docs = { d1: doc('d1', 'p1'), d2: doc('d2', 'p2') };
  const res = await call('/api/auth/register', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data }, '');
  cookies.owner = res.headers.get('set-cookie')!.split(';')[0];
  ids.owner = (await res.json()).user.id;
  for (const name of ['bob', 'cat']) await join(name, { role: 'editor', projectIds: ['p1'] });
});

async function join(name: string, access: Json) {
  const invite = await (await call('/api/admin/invites', 'POST', { emails: `${name}@example.com`, ...access })).json();
  const res = await call(
    '/api/auth/register',
    'POST',
    { name, email: `${name}@example.com`, password: `a-long-${name}-password`, invite: invite.token },
    '',
  );
  cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
  ids[name] = (await res.json()).user.id;
}

afterAll(async () => {
  api.close();
  await new Promise<void>((r) => server.close(() => r()));
});

/** Drops undefined fields and ignores the order of activity, which a delta appends per task. */
const normalize = (data: Json) => {
  const out = JSON.parse(JSON.stringify(data));
  out.activity = [...out.activity].sort((a: Json, b: Json) => a.id.localeCompare(b.id));
  return out;
};

describe('live updates over the event stream', () => {
  const who = ['owner', 'bob', 'cat'] as const;
  const streams: Record<string, Awaited<ReturnType<typeof openStream>>> = {};
  /** What each member's tab holds when it only applies deltas. */
  const views: Record<string, Json> = {};
  let deltas: Record<string, WorkspaceDelta | undefined> = {};

  /** Saves as `actor`, then checks every member's delta leads to exactly what a full reload would show. */
  async function save(actor: string, changes: Json) {
    const revision = await patch(actor, changes);
    deltas = {};
    for (const name of who) {
      const event = await streams[name].revision(revision);
      expect(event.baseRevision).toBe(revision - 1);
      deltas[name] = event.delta;
      expect(event.delta).toBeDefined();
      views[name] = applyDelta(views[name], event.delta!);
      expect(normalize(views[name])).toEqual(normalize(await load(name)));
    }
  }

  beforeAll(async () => {
    for (const name of who) {
      streams[name] = await openStream(name);
      views[name] = await load(name);
    }
  });
  afterAll(() => {
    for (const name of who) streams[name].close();
  });

  it('sends a changed task to the members of its project', async () => {
    await save('owner', { records: await edit('items', 'i1', (r) => ({ ...r!, title: 'Renamed' })) });
    expect(deltas.bob!.records!.items.i1!.title).toBe('Renamed');
    expect(deltas.owner!.records!.items.i1!.title).toBe('Renamed');
  });

  it('sends nothing about projects a member cannot open', async () => {
    await save('owner', { records: await edit('items', 'i2', (r) => ({ ...r!, status: 'done' })) });
    expect(deltas.bob).toEqual({});
    expect(deltas.owner!.records!.items.i2!.status).toBe('done');
    await save('owner', { records: { comments: { c2: { before: null, after: comment('c2', 'i2', ids.owner) } } } });
    expect(deltas.bob).toEqual({});
    await save('owner', { records: { comments: { c1: { before: null, after: comment('c1', 'i1', ids.owner) } } } });
    expect(deltas.bob!.records!.comments.c1).toMatchObject({ targetId: 'i1' });
  });

  it('leaves out dependencies on hidden tasks', async () => {
    await save('owner', { records: await edit('items', 'i3', (r) => ({ ...r!, dependsOn: ['i1', 'i2'] })) });
    expect(deltas.bob!.records!.items.i3!.dependsOn).toEqual(['i1']);
    expect(deltas.owner!.records!.items.i3!.dependsOn).toEqual(['i1', 'i2']);
  });

  it('delivers notifications only to their recipient', async () => {
    const note = {
      id: 'n1',
      recipientId: ids.bob,
      actorId: ids.owner,
      kind: 'assigned',
      targetKind: 'item',
      targetId: 'i1',
      projectId: 'p1',
      createdAt: ts,
    };
    await save('owner', { records: { notifications: { n1: { before: null, after: note } } } });
    expect(deltas.bob!.records!.notifications.n1).toMatchObject({ kind: 'assigned' });
    expect(deltas.cat).toEqual({});
    expect(deltas.owner).toEqual({});
  });

  it('shares activity of visible tasks only', async () => {
    await save('owner', { records: {}, activity: [activity('a1', 'i1'), activity('a2', 'i2')] });
    expect(deltas.bob!.activity).toEqual({ add: [expect.objectContaining({ id: 'a1' })], remove: [] });
    expect(deltas.owner!.activity!.add.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('follows groups through the projects a member can open', async () => {
    await save('owner', {
      records: { groups: { g3: { before: null, after: group('g3') } }, projects: { p3: { before: null, after: project('p3', { groupId: 'g3' }) } } },
    });
    expect(deltas.bob).toEqual({});
    expect(Object.keys(deltas.owner!.records!.groups)).toEqual(['g3']);
    await save('owner', { records: await edit('projects', 'p1', (r) => ({ ...r!, groupId: 'g3' })) });
    expect(deltas.bob!.records!.groups).toEqual({ g3: group('g3'), g1: null });
    expect(deltas.bob!.records!.projects.p1!.groupId).toBe('g3');
    expect(deltas.owner!.records!.groups).toBeUndefined();
  });

  it('removes a task moved to a hidden project, with its comments and history, and brings it back', async () => {
    await save('owner', { records: await edit('items', 'i1', (r) => ({ ...r!, projectId: 'p2' })) });
    expect(deltas.bob!.records!.items).toEqual({ i1: null, i3: expect.objectContaining({ dependsOn: [] }) });
    expect(deltas.bob!.records!.comments).toEqual({ c1: null });
    expect(deltas.bob!.activity).toEqual({ add: [], remove: ['a1'] });
    expect(deltas.owner!.records!.items.i1!.projectId).toBe('p2');
    expect(deltas.owner!.records!.comments).toBeUndefined();
    // Records a member never saw are never mentioned, not even as removed.
    expect(deltas.bob!.records!.items).not.toHaveProperty('i2');
    await save('owner', { records: await edit('items', 'i1', (r) => ({ ...r!, projectId: 'p1' })) });
    expect(deltas.bob!.records!.items.i1).toMatchObject({ projectId: 'p1' });
    expect(deltas.bob!.records!.items.i3!.dependsOn).toEqual(['i1']);
    expect(deltas.bob!.records!.comments.c1).toBeTruthy();
    expect(deltas.bob!.activity!.add.map((a) => a.id)).toEqual(['a1']);
  });

  it('sends the trash to administrators only', async () => {
    const d2 = (await load('owner')).docs.d2;
    const entry = { id: 't1', kind: 'doc', title: d2.title, snapshot: { docs: { d2 } }, deletedAt: new Date().toISOString() };
    await save('owner', { records: { docs: { d2: { before: d2, after: null } } }, trash: { add: [entry], remove: [] } });
    expect(deltas.owner!.trash).toEqual({ add: [entry], remove: [] });
    expect(deltas.bob).toEqual({});
  });

  it('tells about new and removed members', async () => {
    const before = await (await call('/api/workspace', 'GET')).json();
    await join('dan', { role: 'viewer', projectIds: ['p1'] });
    for (const name of who) {
      const event = await streams[name].revision(before.revision + 1);
      expect(event.delta!.records!.people[ids.dan]).toMatchObject({ name: 'dan' });
      views[name] = applyDelta(views[name], event.delta!);
    }
    expect((await call(`/api/admin/members/${ids.dan}`, 'DELETE', {})).status).toBe(200);
    const event = await streams.bob.revision(before.revision + 2);
    expect(event.delta!.records!.people[ids.dan]).toMatchObject({ removed: true });
    views.bob = applyDelta(views.bob, event.delta!);
    expect(normalize(views.bob)).toEqual(normalize(await load('bob')));
  });

  it('uses current access, not the access a tab had when it connected', async () => {
    expect((await call(`/api/admin/members/${ids.cat}`, 'PATCH', { projectIds: ['p1', 'p2'] })).status).toBe(200);
    const revision = await patch('owner', { records: await edit('items', 'i2', (r) => ({ ...r!, title: 'Visible now' })) });
    expect((await streams.cat.revision(revision)).delta!.records!.items.i2!.title).toBe('Visible now');
    expect(streams.cat.events.some((e) => e.event === 'access')).toBe(true);
    expect((await call(`/api/admin/members/${ids.cat}`, 'PATCH', { projectIds: ['p1'] })).status).toBe(200);
    const next = await patch('owner', { records: await edit('items', 'i2', (r) => ({ ...r!, title: 'Hidden again' })) });
    expect((await streams.cat.revision(next)).delta).toEqual({});
  });

  it('leaves out deltas that are too large, so the tab reloads instead', async () => {
    const big = [{ type: 'paragraph', content: 'x'.repeat(600 * 1024) }];
    const revision = await patch('owner', { records: await edit('docs', 'd1', (r) => ({ ...r!, content: big })) });
    const event = await streams.bob.revision(revision);
    expect(event.delta).toBeUndefined();
    expect(event.baseRevision).toBe(revision - 1);
    expect((await streams.owner.revision(revision)).delta).toBeUndefined();
  });
});

describe('content events in the security log', () => {
  type AuditRow = { id: number; action: string; detail: string; kind: string; name: string };
  const log = async (query = ''): Promise<{ events: AuditRow[]; more: boolean }> => (await call(`/api/admin/audit${query}`)).json();
  let mark = 0;
  /** Content events written since the previous call, oldest first. */
  const fresh = async () => {
    const { events } = await log('?kind=content');
    const out = events.filter((e) => e.id > mark).reverse();
    mark = Math.max(mark, ...events.map((e) => e.id));
    return out.map((e) => [e.action, e.detail]);
  };

  it('logs created and deleted work, not everyday edits', async () => {
    await fresh();
    await patch('bob', { records: { items: { t1: { before: null, after: task('t1', 'p1', { title: 'Write spec' }) } } } });
    expect(await fresh()).toEqual([['task.created', 'Write spec · Project p1']]);
    await patch('bob', { records: await edit('items', 't1', (r) => ({ ...r!, status: 'in_progress', title: 'Write the spec' })) });
    expect(await fresh()).toEqual([]);
    await patch('bob', { records: await edit('items', 't1', () => null) });
    expect(await fresh()).toEqual([['task.deleted', 'Write the spec · Project p1']]);
    await patch('owner', {
      records: { sprints: { s1: { before: null, after: { id: 's1', projectId: 'p1', name: 'Sprint 1', status: 'planned' } } } },
    });
    await patch('owner', {
      records: { files: { f1: { before: null, after: { id: 'f1', kind: 'folder', projectId: 'p1', name: 'Specs', createdAt: ts } } } },
    });
    expect(await fresh()).toEqual([
      ['sprint.created', 'Sprint 1 · Project p1'],
      ['folder.created', 'Specs · Project p1'],
    ]);
  });

  it('logs a new project once, even for members limited to some projects', async () => {
    await patch('bob', { records: { projects: { p9: { before: null, after: project('p9', { name: 'Launch', createdBy: ids.bob }) } } } });
    expect(await fresh()).toEqual([['project.created', 'Launch']]);
    const { events } = await log('?kind=access');
    expect(events.some((e) => e.action === 'project.created')).toBe(false);
    await patch('bob', { records: await edit('projects', 'p9', (r) => ({ ...r!, archived: true })) });
    await patch('bob', { records: await edit('projects', 'p9', (r) => ({ ...r!, name: 'Launch 2' })) });
    expect(await fresh()).toEqual([
      ['project.archived', 'Launch'],
      ['project.renamed', 'Launch → Launch 2'],
    ]);
    // Deleting a project lists the project, not every task in it.
    await patch('owner', { records: { items: { t9: { before: null, after: task('t9', 'p9') } } } });
    await fresh();
    await patch('bob', { records: { ...(await edit('projects', 'p9', () => null)), ...(await edit('items', 't9', () => null)) } });
    expect(await fresh()).toEqual([['project.deleted', 'Launch 2']]);
  });

  it('folds a burst of renames into one entry', async () => {
    await patch('bob', { records: { docs: { d5: { before: null, after: doc('d5', 'p1', { title: '' }) } } } });
    for (const title of ['R', 'Roadmap', 'Roadmap Q4']) await patch('bob', { records: await edit('docs', 'd5', (r) => ({ ...r!, title })) });
    expect(await fresh()).toEqual([['doc.created', 'Roadmap Q4 · Project p1']]);
    for (const title of ['Plan', 'Plan 2026']) await patch('owner', { records: await edit('docs', 'd5', (r) => ({ ...r!, title })) });
    expect(await fresh()).toEqual([['doc.renamed', 'Roadmap Q4 → Plan 2026 · Project p1']]);
  });

  it("logs removing someone else's comment", async () => {
    await patch('bob', { records: { comments: { cb: { before: null, after: comment('cb', 'i1', ids.bob) } } } });
    await patch('bob', { records: { comments: { cb2: { before: null, after: comment('cb2', 'i1', ids.bob) } } } });
    await patch('bob', { records: await edit('comments', 'cb2', () => null) });
    expect(await fresh()).toEqual([]);
    await patch('owner', { records: await edit('comments', 'cb', () => null) });
    expect(await fresh()).toEqual([['comment.removed', 'bob · Renamed · Project p1']]);
  });

  it('logs restoring from the trash and emptying it', async () => {
    const t2 = task('t2', 'p1', { title: 'Old task' });
    await patch('owner', { records: { items: { t2: { before: null, after: t2 } } } });
    const deletedAt = new Date().toISOString();
    const entry = { id: 'tr2', kind: 'item', title: 'Old task', snapshot: { items: { t2 } }, deletedAt };
    await patch('owner', { records: { items: { t2: { before: t2, after: null } } }, trash: { add: [entry], remove: [] } });
    await fresh();
    await patch('owner', { records: { items: { t2: { before: null, after: t2 } } }, trash: { add: [], remove: ['tr2'] } });
    expect(await fresh()).toEqual([['trash.restored', 'Old task']]);
    await patch('owner', { records: {}, trash: { add: [{ ...entry, id: 'tr3', title: 'Another', snapshot: {} }], remove: [] } });
    const trash = (await load('owner')).trash as Json[];
    expect(trash.length).toBeGreaterThan(1);
    await patch('owner', { records: {}, trash: { add: [], remove: trash.map((e) => e.id) } });
    expect(await fresh()).toEqual([['trash.emptied', String(trash.length)]]);
  });

  it('pages through the log and filters it', async () => {
    const res = await call('/api/admin/audit?kind=content', 'GET', undefined, 'bob');
    expect(res.status).toBe(403);
    expect((await call('/api/admin/audit?kind=everything')).status).toBe(400);
    expect((await call('/api/admin/audit?before=abc')).status).toBe(400);
    const access = await log('?kind=access');
    expect(access.events.length).toBeGreaterThan(0);
    expect(access.events.every((e) => e.kind === 'access')).toBe(true);
    // Enough entries for more than one page.
    for (let n = 0; n < 11; n++) {
      const records = Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`bulk-${n}-${i}`, { before: null, after: task(`bulk-${n}-${i}`, 'p1') }]),
      );
      await patch('owner', { records: { items: records } });
    }
    const first = await log();
    expect(first.events).toHaveLength(100);
    expect(first.more).toBe(true);
    const ordered = first.events.map((e) => e.id);
    expect(ordered).toEqual([...ordered].sort((a, b) => b - a));
    const next = await log(`?before=${ordered.at(-1)}`);
    expect(next.events[0].id).toBeLessThan(ordered.at(-1)!);
    expect(next.events.every((e) => e.id < ordered.at(-1)!)).toBe(true);
  });

  it('summarises a bulk change after the first few entries', async () => {
    await fresh();
    const records = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`many-${i}`, { before: null, after: task(`many-${i}`, 'p1') }]));
    await patch('owner', { records: { items: records } });
    const events = await fresh();
    expect(events).toHaveLength(11);
    expect(events.at(-1)).toEqual(['task.created.more', '4']);
  });
});
