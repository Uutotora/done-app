import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
// @ts-expect-error shared Node server
import { applyChanges } from '../server/access.mjs';
import { createEmptyData, useData } from '@/lib/store';
import { itemFromTemplate, sanitizeTemplate, templatesFor } from '@/lib/templates';
import type { ItemTemplate } from '@/lib/types';

/* --------------------------------- Store --------------------------------- */

const s = () => useData.getState();
let projectId = '';

beforeEach(() => {
  const data = createEmptyData('en', 'Tester');
  data.onboarded = true;
  s().replaceAll(data);
  projectId = s().createProject({ name: 'Product' });
});

const childrenOf = (id: string) =>
  Object.values(s().items)
    .filter((i) => i.parentId === id)
    .sort((a, b) => a.order - b.order);

describe('task templates in the store', () => {
  it('creates, updates and deletes templates with undo', () => {
    const id = s().createTemplate({ projectId, name: 'Bug report', type: 'bug', priority: 'high', subtasks: ['  Reproduce ', '', 'Fix'] });
    expect(s().templates[id]).toMatchObject({ name: 'Bug report', type: 'bug', priority: 'high', tags: [], subtasks: ['Reproduce', 'Fix'] });
    expect(s().templates[id].createdBy).toBe(s().meId);

    s().updateTemplate(id, { name: 'Bug', subtasks: Array.from({ length: 80 }, (_, i) => `Step ${i}`) });
    expect(s().templates[id].name).toBe('Bug');
    expect(s().templates[id].subtasks).toHaveLength(50);

    const snap = s().deleteTemplate(id);
    expect(s().templates[id]).toBeUndefined();
    s().restore(snap);
    expect(s().templates[id].name).toBe('Bug');
  });

  it('creates a task with its sub-tasks from a template', () => {
    const tpl = s().createTemplate({
      projectId,
      name: 'Feature with PRD',
      type: 'feature',
      priority: 'medium',
      status: 'planned',
      tags: ['prd'],
      estimate: 5,
      horizon: 'next',
      content: [{ type: 'checkListItem', props: { checked: true }, content: 'Problem' }],
      subtasks: ['Write PRD', 'Design review', 'Ship'],
    });
    const id = s().createItemFromTemplate(tpl, { projectId, title: 'Dark mode' })!;
    expect(s().items[id]).toMatchObject({
      projectId,
      title: 'Dark mode',
      type: 'feature',
      priority: 'medium',
      status: 'planned',
      tags: ['prd'],
      estimate: 5,
      horizon: 'next',
      content: [{ type: 'checkListItem', props: { checked: false }, content: 'Problem' }],
    });
    const children = childrenOf(id);
    expect(children.map((c) => c.title)).toEqual(['Write PRD', 'Design review', 'Ship']);
    expect(children.every((c) => c.type === 'task' && c.projectId === projectId)).toBe(true);

    // Overrides such as the board column win over the template.
    const other = s().createItemFromTemplate(tpl, { projectId, title: 'Search', status: 'in_progress' })!;
    expect(s().items[other].status).toBe('in_progress');
    expect(s().createItemFromTemplate('missing', { projectId })).toBeUndefined();
  });

  it('saves a task as a template with its description and direct sub-tasks', () => {
    const parent = s().createItem({
      projectId,
      title: 'Weekly report',
      type: 'task',
      priority: 'low',
      status: 'in_progress',
      tags: ['report'],
      content: [{ type: 'paragraph', content: 'Numbers' }],
      recurrence: { freq: 'weekly', interval: 1 },
      dueDate: '2026-09-28',
    });
    const a = s().createItem({ projectId, title: 'Collect metrics', parentId: parent, order: 1 });
    s().createItem({ projectId, title: 'Send to team', parentId: parent, order: 2 });
    s().createItem({ projectId, title: 'Grandchild', parentId: a });

    const id = s().saveItemAsTemplate(parent, 'Weekly report')!;
    const tpl = s().templates[id];
    expect(tpl).toMatchObject({
      projectId,
      name: 'Weekly report',
      type: 'task',
      priority: 'low',
      tags: ['report'],
      content: [{ type: 'paragraph', content: 'Numbers' }],
      subtasks: ['Collect metrics', 'Send to team'],
      recurrence: { freq: 'weekly', interval: 1 },
    });
    // Work in progress is not a starting status.
    expect(tpl.status).toBeUndefined();
  });

  it('lists the project templates first, then the shared ones', () => {
    const other = s().createProject({ name: 'Other' });
    s().createTemplate({ name: 'Shared B' });
    s().createTemplate({ name: 'Shared A' });
    s().createTemplate({ projectId, name: 'Mine' });
    s().createTemplate({ projectId: other, name: 'Theirs' });
    expect(templatesFor(s().templates, projectId).map((t) => t.name)).toEqual(['Mine', 'Shared A', 'Shared B']);
    expect(templatesFor(s().templates).map((t) => t.name)).toEqual(['Shared A', 'Shared B']);
  });

  it('removes and restores project templates with the project and copies them with it', () => {
    const own = s().createTemplate({ projectId, name: 'Own' });
    const shared = s().createTemplate({ name: 'Shared' });
    const copy = s().duplicateProject(projectId)!;
    const copied = Object.values(s().templates).filter((t) => t.projectId === copy);
    expect(copied.map((t) => t.name)).toEqual(['Own']);
    expect(copied[0].id).not.toBe(own);

    const snap = s().deleteProject(projectId);
    expect(s().templates[own]).toBeUndefined();
    expect(s().templates[shared]).toBeDefined();
    s().restore(snap);
    expect(s().templates[own].name).toBe('Own');
  });

  it('skips people who left when filling a task from a template', () => {
    const tpl = { id: 't', name: 'T', type: 'task', priority: 'none', tags: [], assigneeId: 'gone', createdAt: '', updatedAt: '' } as ItemTemplate;
    expect(itemFromTemplate(tpl, { gone: { id: 'gone', name: 'Gone', color: 'gray', removed: true } }).assigneeId).toBeUndefined();
    expect(itemFromTemplate(tpl, { gone: { id: 'gone', name: 'Here', color: 'gray' } }).assigneeId).toBe('gone');
    expect(sanitizeTemplate({ recurrence: { freq: 'nope', interval: 1 } } as unknown as ItemTemplate).recurrence).toBeUndefined();
  });
});

describe('pruning orphaned templates', () => {
  it('reports the delta for a template dropped together with its deleted project, like a task', () => {
    const owner = { id: 'own', role: 'owner', projectIds: null };
    const at = '2026-09-01T00:00:00.000Z';
    const current = createEmptyData('en') as unknown as Record<string, Record<string, unknown>>;
    current.projects = { alpha: { id: 'alpha', name: 'Alpha', createdAt: at, updatedAt: at } };
    current.templates = { t1: { id: 't1', projectId: 'alpha', name: 'T', type: 'task', priority: 'none', tags: [], createdAt: at, updatedAt: at } };
    const info: { changed?: { records?: Record<string, string[]> } } = {};
    const next = applyChanges(current, { records: { projects: { alpha: { before: current.projects.alpha, after: null } } } }, owner, info);
    expect((next as { templates: Record<string, unknown> }).templates.t1).toBeUndefined();
    // Without this delta entry, other tabs never learn the template is gone until a full reload.
    expect(info.changed?.records?.templates).toEqual(['t1']);
  });
});

/* --------------------------------- Server -------------------------------- */

let server: Server;
let url = '';
let api: ReturnType<typeof createAuthApi>;
const cookies: Record<string, string> = {};
const ts = '2026-09-01T00:00:00.000Z';
const call = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
  fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookies[who] ?? '' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
const load = async (who: string) => (await call('/api/workspace', 'GET', undefined, who)).json();
const patch = (who: string, changes: unknown) => call('/api/workspace', 'PATCH', { changes }, who);
const project = (id: string) => ({ id, name: id, icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts });
const task = (id: string, projectId: string, extra: Record<string, unknown> = {}) => ({
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
const template = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: 'task',
  priority: 'none',
  tags: [],
  createdAt: ts,
  updatedAt: ts,
  ...extra,
});
const addTemplate = (who: string, tpl: { id: string }) => patch(who, { records: { templates: { [tpl.id]: { before: null, after: tpl } } } });

async function join(name: string, body: Record<string, unknown>) {
  const invite = await (await call('/api/admin/invites', 'POST', { emails: `${name}@example.com`, ...body })).json();
  const res = await call(
    '/api/auth/register',
    'POST',
    { name, email: `${name}@example.com`, password: `a-long-${name}-password`, invite: invite.token },
    '',
  );
  cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
}

beforeAll(async () => {
  api = createAuthApi({ filename: ':memory:' });
  server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const data = createEmptyData('en');
  data.projects = { alpha: project('alpha'), beta: project('beta') } as unknown as typeof data.projects;
  data.items = { a1: task('a1', 'alpha') } as unknown as typeof data.items;
  const res = await call('/api/auth/register', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data }, '');
  cookies.owner = res.headers.get('set-cookie')!.split(';')[0];
  await join('eve', { role: 'editor', projectIds: ['alpha'] });
  await join('vic', { role: 'viewer', projectIds: ['alpha'] });
});

afterAll(async () => {
  api.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('templates on the server', () => {
  it('lets editors add templates only to projects they edit', async () => {
    expect((await addTemplate('eve', template('t-alpha', { projectId: 'alpha', subtasks: ['One', 'Two'] }))).status).toBe(200);
    expect((await addTemplate('eve', template('t-beta', { projectId: 'beta' }))).status).toBe(403);
    // Shared templates need access to every project, like workspace pages.
    expect((await addTemplate('eve', template('t-shared-eve'))).status).toBe(403);
    expect((await addTemplate('vic', template('t-vic', { projectId: 'alpha' }))).status).toBe(403);
    expect((await addTemplate('owner', template('t-beta', { projectId: 'beta' }))).status).toBe(200);
    expect((await addTemplate('owner', template('t-shared'))).status).toBe(200);

    const eve = (await load('eve')).data.templates;
    expect(Object.keys(eve)).toEqual(['t-alpha']);
    expect(Object.keys((await load('vic')).data.templates)).toEqual(['t-alpha']);
    expect(Object.keys((await load('owner')).data.templates).sort()).toEqual(['t-alpha', 't-beta', 't-shared']);

    // Viewers cannot change or delete a template they can see.
    const tpl = eve['t-alpha'];
    expect((await patch('vic', { records: { templates: { 't-alpha': { before: tpl, after: { ...tpl, name: 'Mine' } } } } })).status).toBe(403);
    expect((await patch('vic', { records: { templates: { 't-alpha': { before: tpl, after: null } } } })).status).toBe(403);
    // An editor cannot move a template out of their project.
    expect((await patch('eve', { records: { templates: { 't-alpha': { before: tpl, after: { ...tpl, projectId: 'beta' } } } } })).status).toBe(403);
    expect((await patch('eve', { records: { templates: { 't-alpha': { before: tpl, after: { ...tpl, name: 'Renamed' } } } } })).status).toBe(200);
    expect((await load('owner')).data.templates['t-alpha'].name).toBe('Renamed');
  });

  it('validates templates', async () => {
    expect((await addTemplate('owner', template('bad-type', { type: 'story' }))).status).toBe(400);
    expect((await addTemplate('owner', template('bad-priority', { priority: 'p0' }))).status).toBe(400);
    expect((await addTemplate('owner', template('bad-status', { status: 'waiting' }))).status).toBe(400);
    expect((await addTemplate('owner', template('bad-name', { name: 42 }))).status).toBe(400);
    // A template saved into a project deleted a moment ago is dropped, like a task.
    expect((await addTemplate('owner', template('lost', { projectId: 'nowhere' }))).status).toBe(200);
    expect((await load('owner')).data.templates.lost).toBeUndefined();
    expect((await addTemplate('owner', template('bad-subtasks', { subtasks: [1, 2] }))).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `Step ${i}`);
    expect((await addTemplate('owner', template('too-many', { subtasks: many }))).status).toBe(400);
    expect((await addTemplate('owner', template('fifty', { subtasks: many.slice(0, 50), status: 'planned' }))).status).toBe(200);
  });

  it('validates repeat rules of tasks', async () => {
    const add = (id: string, recurrence: unknown) =>
      patch('owner', { records: { items: { [id]: { before: null, after: task(id, 'alpha', { recurrence }) } } } });
    expect((await add('r-ok', { freq: 'weekly', interval: 2 })).status).toBe(200);
    expect((await add('r-day', { freq: 'monthly', interval: 1, day: 31 })).status).toBe(200);
    expect((await add('r-freq', { freq: 'hourly', interval: 1 })).status).toBe(400);
    expect((await add('r-zero', { freq: 'daily', interval: 0 })).status).toBe(400);
    expect((await add('r-big', { freq: 'daily', interval: 366 })).status).toBe(400);
    expect((await add('r-frac', { freq: 'daily', interval: 1.5 })).status).toBe(400);
  });

  it('drops the templates of a deleted project', async () => {
    const owner = (await load('owner')).data;
    const res = await patch('owner', { records: { projects: { beta: { before: owner.projects.beta, after: null } } } });
    expect(res.status).toBe(200);
    const templates = (await load('owner')).data.templates;
    expect(templates['t-beta']).toBeUndefined();
    expect(templates['t-shared']).toBeDefined();
  });
});
