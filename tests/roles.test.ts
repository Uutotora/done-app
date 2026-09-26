import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
// @ts-expect-error shared Node server
import { projectLevel } from '../server/access.mjs';
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
const project = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  icon: '📁',
  color: 'blue',
  status: 'on_track',
  order: 1,
  createdAt: ts,
  updatedAt: ts,
  ...extra,
});
const task = (id: string, projectId: string) => ({
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
});

async function invite(name: string, body: Record<string, unknown>, by = 'owner') {
  const res = await call('/api/admin/invites', 'POST', { emails: `${name}@example.com`, ...body }, by);
  return { status: res.status, json: await res.json() };
}
async function join(name: string, body: Record<string, unknown>) {
  const { json } = await invite(name, body);
  const res = await call(
    '/api/auth/register',
    'POST',
    { name, email: `${name}@example.com`, password: `a-long-${name}-password`, invite: json.token },
    '',
  );
  cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
  ids[name] = (await res.json()).user.id;
}

beforeAll(async () => {
  api = createAuthApi({ filename: ':memory:' });
  server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const data = createEmptyData('en');
  data.projects = { alpha: project('alpha'), beta: project('beta') } as unknown as typeof data.projects;
  data.items = { a1: task('a1', 'alpha'), b1: task('b1', 'beta') } as unknown as typeof data.items;
  const res = await call('/api/auth/register', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data }, '');
  cookies.owner = res.headers.get('set-cookie')!.split(';')[0];
  ids.owner = (await res.json()).user.id;
  await join('ada', { role: 'admin' });
  await join('eve', { role: 'editor', projectIds: ['alpha'], canCreateProjects: true });
  await join('ned', { role: 'editor', projectIds: ['alpha', 'beta'], projectRoles: { beta: 'commenter' }, canCreateProjects: false });
  await join('vic', { role: 'viewer', projectIds: ['alpha'] });
});

afterAll(async () => {
  api.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('access levels', () => {
  it('derives the level in a project from the role and per-project settings', () => {
    expect(projectLevel({ role: 'member', projectIds: ['p'], projectRoles: { p: 'commenter' } }, 'p')).toBe('commenter');
    expect(projectLevel({ role: 'editor', projectIds: null, projectRoles: {} }, 'x')).toBe('editor');
    expect(projectLevel({ role: 'viewer', projectIds: ['p'], projectRoles: { p: 'editor' } }, 'p')).toBe('commenter');
    expect(projectLevel({ role: 'admin', projectIds: [], projectRoles: {} }, 'p')).toBe('full');
    expect(projectLevel({ role: 'editor', projectIds: ['p'], projectRoles: {} }, 'q')).toBeNull();
  });
});

describe('roles on the server', () => {
  it('invites several people by email; admins cannot hand out admin rights', async () => {
    const many = await invite('x1', { emails: 'x1@example.com, x2@example.com;owner@example.com', role: 'viewer', projectIds: ['alpha'] });
    expect(many.status).toBe(201);
    expect(many.json.invites.map((i: { email: string }) => i.email)).toEqual(['x1@example.com', 'x2@example.com']);
    expect(many.json.skipped).toEqual([{ email: 'owner@example.com', reason: 'exists' }]);
    expect((await invite('boss', { role: 'admin' }, 'ada')).status).toBe(403);
    expect((await invite('boss', { role: 'owner' }, 'ada')).status).toBe(403);
    expect((await invite('boss', { role: 'viewer', emails: 'not-an-email' })).status).toBe(400);
    const list = await (await call('/api/admin/members')).json();
    expect(list.invites.find((i: { email: string }) => i.email === 'x1@example.com')).toMatchObject({ role: 'viewer', projectIds: ['alpha'] });
  });

  it('lets editors create projects when allowed and keeps them in their new project', async () => {
    expect((await patch('eve', { records: { projects: { gamma: { before: null, after: project('gamma', { createdBy: ids.eve }) } } } })).status).toBe(
      200,
    );
    expect(Object.keys((await load('eve')).data.projects).sort()).toEqual(['alpha', 'gamma']);
    expect((await patch('eve', { records: { items: { g1: { before: null, after: task('g1', 'gamma') } } } })).status).toBe(200);
    expect((await patch('ned', { records: { projects: { delta: { before: null, after: project('delta') } } } })).status).toBe(403);
    expect((await patch('vic', { records: { projects: { omega: { before: null, after: project('omega') } } } })).status).toBe(403);
  });

  it('only admins and the creator delete a project', async () => {
    const gamma = (await load('owner')).data.projects.gamma;
    expect((await call(`/api/admin/members/${ids.ned}`, 'PATCH', { projectIds: ['alpha', 'beta', 'gamma'] })).status).toBe(200);
    const g1 = (await load('ned')).data.items.g1;
    expect(
      (await patch('ned', { records: { projects: { gamma: { before: gamma, after: null } }, items: { g1: { before: g1, after: null } } } })).status,
    ).toBe(403);
    expect(
      (await patch('eve', { records: { projects: { gamma: { before: gamma, after: null } }, items: { g1: { before: g1, after: null } } } })).status,
    ).toBe(200);
  });

  it('respects per-project levels: commenters comment, viewers only read', async () => {
    const b1 = (await load('ned')).data.items.b1;
    expect((await patch('ned', { records: { items: { b1: { before: b1, after: { ...b1, title: 'Edited' } } } } })).status).toBe(403);
    const comment = { id: 'c-ned', targetKind: 'item', targetId: 'b1', authorId: ids.ned, text: 'Looks good', createdAt: ts };
    expect((await patch('ned', { records: { comments: { 'c-ned': { before: null, after: comment } } } })).status).toBe(200);
    const a1 = (await load('vic')).data.items.a1;
    expect((await patch('vic', { records: { items: { a1: { before: a1, after: { ...a1, title: 'Viewer' } } } } })).status).toBe(403);
    const vcomment = { ...comment, id: 'c-vic', targetId: 'a1', authorId: ids.vic };
    expect((await patch('vic', { records: { comments: { 'c-vic': { before: null, after: vcomment } } } })).status).toBe(403);
  });

  it('manages project access from the project, for admins only', async () => {
    const before = await (await call('/api/projects/beta/access', 'GET', undefined, 'ned')).json();
    expect(before.members.find((m: { id: string }) => m.id === ids.ned).level).toBe('commenter');
    expect((await call('/api/projects/beta/access', 'PUT', { userId: ids.vic, level: 'viewer' }, 'ned')).status).toBe(403);
    expect((await call('/api/projects/beta/access', 'PUT', { userId: ids.vic, level: 'editor' })).status).toBe(400);
    expect((await call('/api/projects/beta/access', 'PUT', { userId: ids.vic, level: 'commenter' })).status).toBe(200);
    expect((await load('vic')).data.projects.beta).toBeDefined();
    await call('/api/projects/beta/access', 'PUT', { userId: ids.vic, level: null });
    expect((await load('vic')).data.projects.beta).toBeUndefined();
  });

  it('keeps an owner in charge and lets owners hand over ownership', async () => {
    expect((await call(`/api/admin/members/${ids.owner}`, 'PATCH', { role: 'admin' }, 'ada')).status).toBe(403);
    expect((await call(`/api/admin/members/${ids.ada}`, 'PATCH', { role: 'owner' })).status).toBe(200);
    expect((await call(`/api/admin/members/${ids.owner}`, 'PATCH', { role: 'admin' }, 'ada')).status).toBe(200);
    expect((await call(`/api/admin/members/${ids.ada}`, 'DELETE', {}, 'owner')).status).toBe(403);
    expect((await call(`/api/admin/members/${ids.owner}`, 'PATCH', { role: 'owner' }, 'ada')).status).toBe(200);
  });

  it('removes a member from the workspace but keeps their name on past work', async () => {
    expect((await call(`/api/admin/members/${ids.vic}`, 'DELETE', {})).status).toBe(200);
    expect((await call('/api/workspace', 'GET', undefined, 'vic')).status).toBe(401);
    expect((await load('owner')).data.people[ids.vic]).toMatchObject({ name: 'vic', removed: true });
  });
});
