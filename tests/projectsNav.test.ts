import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
import { createEmptyData, useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { translate, type TKey } from '@/lib/i18n';
import { archivedProjects, isArchivedProject, refInArchive } from '@/lib/archive';
import { archiveProjectWithUndo, restoreArchivedProject } from '@/lib/actions';
import { documentTitle, pageTitle, type TitleSource } from '@/lib/documentTitle';
import type { DataState, Lang, Project } from '@/lib/types';

const s = () => useData.getState();

beforeEach(() => {
  const data = createEmptyData('ru', 'Tester');
  data.onboarded = true;
  s().replaceAll(data);
  useUI.setState({ toasts: [] });
});

describe('project archive in the store', () => {
  it('archives with a timestamp and restores without leftovers', () => {
    const id = s().createProject({ name: 'Apollo' });
    s().setProjectArchived(id, true);
    const archived = s().projects[id];
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.updatedAt).toBe(archived.archivedAt);

    // Archiving twice keeps the original date.
    s().setProjectArchived(id, true);
    expect(s().projects[id]).toBe(archived);

    s().setProjectArchived(id, false);
    expect(s().projects[id]).not.toHaveProperty('archived');
    expect(s().projects[id]).not.toHaveProperty('archivedAt');
  });

  it('keeps the work of an archived project and makes duplicates active', () => {
    const id = s().createProject({ name: 'Apollo' });
    const item = s().createItem({ projectId: id, title: 'Launch' });
    s().setProjectArchived(id, true);
    expect(s().items[item].projectId).toBe(id);
    const copy = s().duplicateProject(id)!;
    expect(s().projects[copy].archived).toBeFalsy();
    expect(s().projects[copy].archivedAt).toBeUndefined();
  });

  it('offers undo right after archiving and confirms a restore', () => {
    const id = s().createProject({ name: 'Apollo' });
    archiveProjectWithUndo(id);
    expect(s().projects[id].archived).toBe(true);
    const toast = useUI.getState().toasts.at(-1)!;
    expect(toast.message).toBe('Проект «Apollo» перемещен в архив');
    toast.action!.run();
    expect(s().projects[id].archived).toBeUndefined();

    archiveProjectWithUndo(id);
    restoreArchivedProject(id);
    expect(s().projects[id].archived).toBeUndefined();
    expect(useUI.getState().toasts.at(-1)!.message).toBe('Проект «Apollo» возвращен из архива');
  });
});

describe('archive helpers', () => {
  const at = '2026-09-01T00:00:00.000Z';
  const project = (id: string, extra: Partial<Project> = {}): Project =>
    ({ id, name: id, icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: at, updatedAt: at, ...extra }) as Project;

  it('lists archived projects, latest first, searchable by name and group', () => {
    const projects = {
      a: project('Alpha', { id: 'a', archived: true, archivedAt: '2026-09-02T00:00:00.000Z', groupId: 'g' }),
      b: project('Beta', { id: 'b', archived: true, archivedAt: '2026-09-05T00:00:00.000Z' }),
      c: project('Gamma', { id: 'c' }),
    };
    const groups = { g: { id: 'g', name: 'Marketing', icon: '📁', order: 1, createdAt: at, updatedAt: at } } as unknown as DataState['groups'];
    expect(archivedProjects(projects, groups).map((p) => p.id)).toEqual(['b', 'a']);
    expect(archivedProjects(projects, groups, 'market').map((p) => p.id)).toEqual(['a']);
    expect(archivedProjects(projects, groups, 'gamma')).toEqual([]);
    expect(isArchivedProject(projects, 'a')).toBe(true);
    expect(isArchivedProject(projects, 'c')).toBe(false);
    expect(isArchivedProject(projects, undefined)).toBe(false);
  });

  it('recognises favorites and recents that lead into an archived project', () => {
    const projects = { a: project('a', { archived: true }), b: project('b') };
    const docs = { d1: { id: 'd1', projectId: 'a' }, d2: { id: 'd2', projectId: 'b' }, d3: { id: 'd3' } } as unknown as DataState['docs'];
    expect(refInArchive({ kind: 'project', id: 'a' }, { projects, docs })).toBe(true);
    expect(refInArchive({ kind: 'project', id: 'b' }, { projects, docs })).toBe(false);
    expect(refInArchive({ kind: 'doc', id: 'd1' }, { projects, docs })).toBe(true);
    expect(refInArchive({ kind: 'doc', id: 'd2' }, { projects, docs })).toBe(false);
    expect(refInArchive({ kind: 'doc', id: 'd3' }, { projects, docs })).toBe(false);
  });
});

describe('browser tab title', () => {
  const source = (pathname: string, extra: Partial<TitleSource> = {}, lang: Lang = 'ru'): TitleSource => ({
    pathname,
    unread: 0,
    data: s(),
    t: (key: TKey) => translate(lang, key),
    ...extra,
  });

  it('names the workspace on home and the section elsewhere', () => {
    s().updateWorkspace({ name: 'Acme' });
    expect(documentTitle(source('/'))).toBe('Acme · Done');
    expect(documentTitle(source('/inbox'))).toBe('Входящие · Done');
    expect(documentTitle(source('/my-work'))).toBe('Мои задачи · Done');
    expect(documentTitle(source('/settings/people'))).toBe('Настройки · Done');
    expect(documentTitle(source('/calendar', {}, 'en'))).toBe('Calendar · Done');
    expect(documentTitle(source('/roadmap', {}, 'en'))).toBe('Roadmap · Done');
    expect(documentTitle(source('/files', {}, 'en'))).toBe('Files · Done');
  });

  it('adds the unread count only when there is something unread', () => {
    s().updateWorkspace({ name: 'Acme' });
    expect(documentTitle(source('/', { unread: 3 }))).toBe('(3) Acme · Done');
    expect(documentTitle(source('/nowhere', { unread: 2 }))).toBe('(2) Done');
    expect(documentTitle(source('/nowhere'))).toBe('Done');
  });

  it('describes project tabs, pages and tasks, and follows renames', () => {
    const p = s().createProject({ name: 'Apollo' });
    expect(documentTitle(source(`/p/${p}/overview`))).toBe('Apollo · Done');
    expect(documentTitle(source(`/p/${p}`))).toBe('Apollo · Done');
    expect(documentTitle(source(`/p/${p}/backlog`))).toBe('Бэклог · Apollo · Done');
    expect(documentTitle(source(`/p/${p}/sprints`, {}, 'en'))).toBe('Sprints · Apollo · Done');
    s().updateProject(p, { name: 'Zeus' });
    expect(pageTitle(source(`/p/${p}/board`))).toBe('Доска · Zeus');
    s().updateProject(p, { name: '  ' });
    expect(pageTitle(source(`/p/${p}/overview`))).toBe('Новый проект');
    expect(pageTitle(source('/p/missing/backlog'))).toBeUndefined();

    const doc = s().createDoc({ projectId: p, title: '' });
    expect(documentTitle(source(`/docs/${doc}`))).toBe('Без названия · Done');
    s().updateDoc(doc, { title: 'Spec' });
    expect(pageTitle(source(`/docs/${doc}`))).toBe('Spec');

    const item = s().createItem({ projectId: p, title: 'Launch' });
    expect(pageTitle(source(`/items/${item}`))).toBe('Launch');
  });

  it('prefers the task open in the side peek', () => {
    const p = s().createProject({ name: 'Apollo' });
    const item = s().createItem({ projectId: p, title: 'Fix login' });
    expect(documentTitle(source(`/p/${p}/backlog`, { peekItemId: item, unread: 1 }))).toBe('(1) Fix login · Done');
    expect(pageTitle(source(`/p/${p}/backlog`, { peekItemId: 'gone' }))).toBe('Бэклог · Apollo');
  });
});

describe('archiving on the server', () => {
  let server: Server;
  let url = '';
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
  const archive = async (who: string, id: string, archived: boolean) => {
    const before = (await load(who)).data.projects[id];
    const after = { ...before, updatedAt: '2026-09-03T00:00:00.000Z' };
    if (archived) Object.assign(after, { archived: true, archivedAt: '2026-09-03T00:00:00.000Z' });
    else (delete after.archived, delete after.archivedAt);
    return (await patch(who, { records: { projects: { [id]: { before, after } } } })).status;
  };
  const join = async (name: string, body: Record<string, unknown>) => {
    const invite = await (await call('/api/admin/invites', 'POST', { emails: `${name}@example.com`, ...body })).json();
    const res = await call(
      '/api/auth/register',
      'POST',
      { name, email: `${name}@example.com`, password: `a-long-${name}-password`, invite: invite.token },
      '',
    );
    cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
  };

  beforeAll(async () => {
    const api = createAuthApi({ filename: ':memory:' });
    server = createServer(api.handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const data = createEmptyData('en');
    const project = (id: string) => ({ id, name: id, icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts });
    data.projects = { alpha: project('alpha'), beta: project('beta') } as unknown as typeof data.projects;
    const res = await call('/api/auth/register', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data }, '');
    cookies.owner = res.headers.get('set-cookie')!.split(';')[0];
    await join('eve', { role: 'editor', projectIds: ['alpha', 'beta'], projectRoles: { beta: 'commenter' } });
    await join('vic', { role: 'viewer', projectIds: ['alpha'] });
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('lets whoever edits the project archive and restore it', async () => {
    expect(await archive('vic', 'alpha', true)).toBe(403);
    expect(await archive('eve', 'beta', true)).toBe(403);
    expect(await archive('eve', 'alpha', true)).toBe(200);
    // Members with access still see the archived project and can open it.
    expect((await load('vic')).data.projects.alpha).toMatchObject({ archived: true, archivedAt: '2026-09-03T00:00:00.000Z' });
    expect(await archive('vic', 'alpha', false)).toBe(403);
    expect(await archive('owner', 'alpha', false)).toBe(200);
    expect((await load('eve')).data.projects.alpha).not.toHaveProperty('archived');
  });
});
