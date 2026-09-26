import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
import { createEmptyData } from '@/lib/store';
let server: Server;
let url: string;
let owner = '';
let viewer = '';
let member = '';
let memberId = '';
let viewerId = '';
let api: ReturnType<typeof createAuthApi>;
const call = (path: string, method = 'GET', data?: unknown, cookie = owner, extra = {}) =>
  fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie, ...extra },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
beforeAll(async () => {
  api = createAuthApi({ filename: ':memory:' });
  server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  api.close();
});
describe('authentication and server-enforced permissions', () => {
  it('protects workspace and creates only one owner, with an HttpOnly session', async () => {
    expect((await call('/api/workspace', 'GET', undefined, '')).status).toBe(401);
    const data = createEmptyData('en');
    const ts = new Date().toISOString();
    data.projects = Object.fromEntries(
      ['public', 'private'].map((id) => [
        id,
        { id, name: id, icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts },
      ]),
    );
    const response = await call(
      '/api/auth/register',
      'POST',
      { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data },
      '',
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    owner = cookie.split(';')[0];
    expect(
      (await call('/api/auth/register', 'POST', { name: 'Intruder', email: 'intruder@example.com', password: 'a-long-bad-password', data }, ''))
        .status,
    ).toBe(403);
  });
  it('rejects cross-origin writes and invalid credentials', async () => {
    expect((await call('/api/admin/invites', 'POST', {}, owner, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/api/auth/login', 'POST', { email: 'owner@example.com', password: 'incorrect' }, '')).status).toBe(401);
  });
  it('creates an email-bound, single-use viewer invitation', async () => {
    const invite = await (await call('/api/admin/invites', 'POST', { email: 'viewer@example.com', role: 'viewer', projectIds: ['public'] })).json();
    expect(
      (
        await call(
          '/api/auth/register',
          'POST',
          { name: 'Wrong', email: 'wrong@example.com', password: 'a-long-viewer-password', invite: invite.token },
          '',
        )
      ).status,
    ).toBe(403);
    const response = await call(
      '/api/auth/register',
      'POST',
      { name: 'Viewer', email: 'viewer@example.com', password: 'a-long-viewer-password', invite: invite.token },
      '',
    );
    expect(response.status).toBe(200);
    viewer = response.headers.get('set-cookie')!.split(';')[0];
    viewerId = (await response.json()).user.id;
    expect(
      (
        await call(
          '/api/auth/register',
          'POST',
          { name: 'Viewer', email: 'viewer@example.com', password: 'a-long-viewer-password', invite: invite.token },
          '',
        )
      ).status,
    ).toBe(403);
  });
  it('filters hidden projects and refuses viewer writes and admin access', async () => {
    const current = await (await call('/api/workspace', 'GET', undefined, viewer)).json();
    expect(Object.keys(current.data.projects)).toEqual(['public']);
    expect((await call('/api/workspace', 'PUT', current, viewer)).status).toBe(403);
    expect((await call('/api/admin/members', 'GET', undefined, viewer)).status).toBe(403);
    expect((await call('/api/blobs/secret', 'GET', undefined, viewer)).status).toBe(404);
  });
  it('lets members edit allowed projects without overwriting hidden data', async () => {
    const invite = await (await call('/api/admin/invites', 'POST', { email: 'member@example.com', role: 'member', projectIds: ['public'] })).json();
    const response = await call(
      '/api/auth/register',
      'POST',
      { name: 'Member', email: 'member@example.com', password: 'a-long-member-password', invite: invite.token },
      '',
    );
    member = response.headers.get('set-cookie')!.split(';')[0];
    memberId = (await response.json()).user.id;
    const current = await (await call('/api/workspace', 'GET', undefined, member)).json();
    current.data.projects.public.name = 'Updated';
    expect((await call('/api/workspace', 'PUT', current, member)).status).toBe(200);
    const result = await (await call('/api/workspace')).json();
    expect(result.data.projects.private.name).toBe('private');
    expect(result.data.projects.public.name).toBe('Updated');
    expect((await call('/api/workspace', 'PUT', current, member)).status).toBe(409);
  });
  it('rejects hidden-record injection and privilege escalation', async () => {
    const current = await (await call('/api/workspace', 'GET', undefined, member)).json();
    current.data.projects.private = { ...current.data.projects.public, id: 'private' };
    expect((await call('/api/workspace', 'PUT', current, member)).status).toBe(403);
    expect((await call(`/api/admin/members/${memberId}`, 'PATCH', { role: 'admin' }, member)).status).toBe(403);
    const fresh = await (await call('/api/workspace', 'GET', undefined, member)).json();
    fresh.data.groups.x = { id: 'x', name: 'Hacked', order: 0, icon: '📁' };
    expect((await call('/api/workspace', 'PUT', fresh, member)).status).toBe(403);
  });
  it('revokes sessions when access is suspended and protects the owner', async () => {
    expect((await call(`/api/admin/members/${viewerId}`, 'PATCH', { disabled: true })).status).toBe(200);
    expect((await call('/api/workspace', 'GET', undefined, viewer)).status).toBe(401);
    const self = await (await call('/api/auth/session')).json();
    expect((await call(`/api/admin/members/${self.user.id}`, 'PATCH', { role: 'viewer' })).status).toBe(403);
    const log = await (await call('/api/admin/audit')).json();
    expect(log.events.some((e: { action: string }) => e.action === 'member.suspended')).toBe(true);
  });
  it('ends the session on logout', async () => {
    expect((await call('/api/auth/logout', 'POST', {}, member)).status).toBe(200);
    expect((await call('/api/workspace', 'GET', undefined, member)).status).toBe(401);
  });
});
