import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
// @ts-expect-error shared Node server
import { inviteEmail } from '../server/mail.mjs';
import { createEmptyData } from '@/lib/store';
import { teamNameFromEmail } from '@/lib/team';

const PUBLIC = 'https://done.example.com';
let server: Server;
let url: string;
let api: ReturnType<typeof createAuthApi>;
const cookies: Record<string, string> = {};
const call = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
  fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookies[who] ?? '' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
const register = (body: Record<string, unknown>) => call('/api/auth/register', 'POST', { password: 'a-long-enough-password', ...body }, '');
const remember = (who: string, res: Response) => {
  cookies[who] = res.headers.get('set-cookie')!.split(';')[0];
};
const tokenOf = (link: { url: string }) => new URL(link.url).searchParams.get('join')!;

beforeAll(async () => {
  api = createAuthApi({ filename: ':memory:', publicUrl: PUBLIC, mailer: { sendMail: async () => ({}) } });
  server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const data = createEmptyData('en');
  data.workspace = { ...data.workspace, name: 'Acme' };
  const ts = new Date().toISOString();
  data.projects = {
    secret: { id: 'secret', name: 'Secret plan', icon: '🔒', color: 'red', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts },
  };
  remember('owner', await register({ name: 'Olga', email: 'owner@example.com', data }));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  api.close();
});

describe('team invite link', () => {
  let link: { enabled: boolean; url: string; level: string; joined: number };

  it('is off until an administrator turns it on', async () => {
    const members = await (await call('/api/admin/members')).json();
    expect(members.link).toMatchObject({ enabled: false, url: null });
    const res = await call('/api/admin/invite-link', 'POST', { enabled: true });
    expect(res.status).toBe(200);
    link = (await res.json()).link;
    expect(link).toMatchObject({ enabled: true, level: 'editor', joined: 0 });
    expect(link.url).toMatch(new RegExp(`^${PUBLIC}/\\?join=[A-Za-z0-9_-]{20,}$`));
    // The link stays the same when the dialog is opened again.
    expect((await (await call('/api/admin/members')).json()).link.url).toBe(link.url);
  });

  it('shows who invites and where, but nothing about projects or accounts', async () => {
    const res = await call('/api/auth/join', 'POST', { token: tokenOf(link) }, '');
    expect(res.status).toBe(200);
    const preview = await res.json();
    expect(preview).toMatchObject({ workspace: 'Acme', inviter: 'Olga', role: 'editor' });
    expect(Object.keys(preview).sort()).toEqual(['inviter', 'inviterAvatar', 'inviterColor', 'inviterPhoto', 'level', 'role', 'workspace']);
    expect(JSON.stringify(preview)).not.toContain('Secret plan');
    expect(JSON.stringify(preview)).not.toContain('owner@example.com');
    expect((await call('/api/auth/join', 'POST', { token: 'wrong' }, '')).status).toBe(410);
    expect((await call('/api/auth/join', 'POST', { token: {} }, '')).status).toBe(410);
  });

  it('creates an editor with every project and counts who joined', async () => {
    const res = await register({ name: 'Anna', email: 'anna@example.com', join: tokenOf(link) });
    expect(res.status).toBe(200);
    const { user } = await res.json();
    expect(user).toMatchObject({ role: 'editor', projectIds: null, canCreateProjects: true });
    remember('anna', res);
    expect((await (await call('/api/admin/members')).json()).link.joined).toBe(1);
    // The same address cannot join twice.
    expect((await register({ name: 'Anna', email: 'anna@example.com', join: tokenOf(link) })).status).toBe(409);
    const audit = await (await call('/api/admin/audit')).json();
    expect(audit.events.map((e: { action: string }) => e.action)).toContain('account.joined');
  });

  it('uses up a pending email invitation for the same address', async () => {
    await call('/api/admin/invites', 'POST', { emails: ['ben@example.com'], role: 'viewer' });
    expect((await register({ name: 'Ben', email: 'ben@example.com', join: tokenOf(link) })).status).toBe(200);
    const members = await (await call('/api/admin/members')).json();
    expect(members.invites.map((i: { email: string }) => i.email)).not.toContain('ben@example.com');
  });

  it('gives viewers read-only access and never an admin role', async () => {
    expect((await call('/api/admin/invite-link', 'POST', { role: 'admin' })).status).toBe(400);
    expect((await call('/api/admin/invite-link', 'POST', { role: 'owner' })).status).toBe(400);
    link = (await (await call('/api/admin/invite-link', 'POST', { level: 'viewer' })).json()).link;
    const res = await register({ name: 'Vic', email: 'vic@example.com', join: tokenOf(link) });
    expect((await res.json()).user).toMatchObject({ role: 'viewer', canCreateProjects: false });
  });

  it('can only be managed by administrators', async () => {
    expect((await call('/api/admin/invite-link', 'POST', { enabled: false }, 'anna')).status).toBe(403);
    expect((await call('/api/admin/invite-link', 'POST', { enabled: false }, '')).status).toBe(401);
  });

  it('stops working when turned off and comes back with the same link', async () => {
    await call('/api/admin/invite-link', 'POST', { enabled: false });
    expect((await call('/api/auth/join', 'POST', { token: tokenOf(link) }, '')).status).toBe(410);
    expect((await register({ name: 'Off', email: 'off@example.com', join: tokenOf(link) })).status).toBe(403);
    const again = (await (await call('/api/admin/invite-link', 'POST', { enabled: true })).json()).link;
    expect(again.url).toBe(link.url);
  });

  it('replaces the link on reset, so the old one no longer opens anything', async () => {
    const fresh = (await (await call('/api/admin/invite-link', 'POST', { reset: true })).json()).link;
    expect(fresh.url).not.toBe(link.url);
    expect(fresh.joined).toBe(0);
    expect((await call('/api/auth/join', 'POST', { token: tokenOf(link) }, '')).status).toBe(410);
    expect((await register({ name: 'Late', email: 'late@example.com', join: tokenOf(link) })).status).toBe(403);
    expect((await register({ name: 'Nia', email: 'nia@example.com', join: tokenOf(fresh) })).status).toBe(200);
  });
});

describe('project invite link', () => {
  let projectLink: { enabled: boolean; url: string; level: string; joined: number };

  it('is made by administrators for one project', async () => {
    expect((await (await call('/api/projects/secret/invite-link')).json()).link).toMatchObject({ enabled: false, url: null });
    expect((await call('/api/projects/secret/invite-link', 'POST', { enabled: true }, 'anna')).status).toBe(403);
    expect((await call('/api/projects/missing/invite-link', 'POST', { enabled: true })).status).toBe(404);
    expect((await call('/api/projects/secret/invite-link', 'POST', { level: 'owner' })).status).toBe(400);
    const res = await call('/api/projects/secret/invite-link', 'POST', { enabled: true });
    expect(res.status).toBe(200);
    projectLink = (await res.json()).link;
    expect(projectLink).toMatchObject({ enabled: true, level: 'editor' });
    // Each project has its own link, separate from the team link.
    expect(projectLink.url).not.toBe((await (await call('/api/admin/members')).json()).link.url);
  });

  it('names the project it opens', async () => {
    const preview = await (await call('/api/auth/join', 'POST', { token: tokenOf(projectLink) }, '')).json();
    expect(preview).toMatchObject({ project: { id: 'secret', name: 'Secret plan', icon: '🔒' }, level: 'editor', role: 'editor', inviter: 'Olga' });
  });

  it('creates an account with only that project and says where to go', async () => {
    const res = await register({ name: 'Pia', email: 'pia@example.com', join: tokenOf(projectLink) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projectId).toBe('secret');
    expect(body.user).toMatchObject({ role: 'editor', projectIds: ['secret'], canCreateProjects: false });
    remember('pia', res);
    const workspace = await (await call('/api/workspace', 'GET', undefined, 'pia')).json();
    expect(Object.keys(workspace.data.projects)).toEqual(['secret']);
  });

  it('opens at the chosen level: commenters join as viewers who may comment', async () => {
    projectLink = (await (await call('/api/projects/secret/invite-link', 'POST', { level: 'commenter' })).json()).link;
    const { user } = await (await register({ name: 'Cal', email: 'cal@example.com', join: tokenOf(projectLink) })).json();
    expect(user).toMatchObject({ role: 'viewer', projectIds: ['secret'], projectRoles: { secret: 'commenter' } });
  });

  it('adds the project to people who already have an account', async () => {
    const ts = new Date().toISOString();
    // A second project Pia cannot see yet; she opens its link while signed in.
    const patch = {
      changes: {
        records: {
          projects: {
            second: {
              before: null,
              after: { id: 'second', name: 'Second', icon: '📦', color: 'blue', status: 'on_track', order: 2, createdAt: ts, updatedAt: ts },
            },
          },
        },
      },
    };
    expect((await call('/api/workspace', 'PATCH', patch)).status).toBe(200);
    const second = (await (await call('/api/projects/second/invite-link', 'POST', { enabled: true, level: 'viewer' })).json()).link;
    const accepted = await call('/api/auth/join/accept', 'POST', { token: tokenOf(second) }, 'pia');
    expect(await accepted.json()).toEqual({ projectId: 'second', added: true });
    const session = await (await call('/api/auth/session', 'GET', undefined, 'pia')).json();
    expect(session.user).toMatchObject({ projectIds: ['secret', 'second'], projectRoles: { second: 'viewer' } });
    // Opening it again changes nothing; admins already see everything.
    expect(await (await call('/api/auth/join/accept', 'POST', { token: tokenOf(second) }, 'pia')).json()).toEqual({
      projectId: 'second',
      added: false,
    });
    expect(await (await call('/api/auth/join/accept', 'POST', { token: tokenOf(second) })).json()).toEqual({ projectId: 'second', added: false });
    expect((await call('/api/auth/join/accept', 'POST', { token: tokenOf(second) }, '')).status).toBe(401);
  });

  it('stops working when turned off or reset', async () => {
    await call('/api/projects/secret/invite-link', 'POST', { enabled: false });
    expect((await call('/api/auth/join', 'POST', { token: tokenOf(projectLink) }, '')).status).toBe(410);
    const fresh = (await (await call('/api/projects/secret/invite-link', 'POST', { enabled: true, reset: true })).json()).link;
    expect(fresh.url).not.toBe(projectLink.url);
    expect((await call('/api/auth/join', 'POST', { token: tokenOf(projectLink) }, '')).status).toBe(410);
    expect((await call('/api/auth/join', 'POST', { token: tokenOf(fresh) }, '')).status).toBe(200);
  });
});

describe('email settings saved in the app', () => {
  const sent: { to: string; subject: string; from: string }[] = [];
  let failWith: string | null = null;
  const factory = () => ({
    verify: async () => {
      if (failWith) throw Object.assign(new Error('Invalid login: 535 5.7.8'), { code: failWith });
      return true;
    },
    sendMail: async (message: { to: string; subject: string; from: string }) => {
      sent.push(message);
      return {};
    },
    close: () => undefined,
  });
  let mailApi: ReturnType<typeof createAuthApi>;
  let mailServer: Server;
  const cookie: Record<string, string> = {};
  let base = '';
  const req = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookie[who] ?? '' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const settings = {
    host: 'smtp.yandex.ru',
    port: 465,
    user: 'team@acme.ru',
    pass: 'app-password',
    name: 'Acme',
    publicUrl: 'https://done.acme.ru/',
  };
  beforeAll(async () => {
    mailApi = createAuthApi({ filename: ':memory:', smtpFactory: factory });
    mailServer = createServer(mailApi.handler);
    await new Promise<void>((r) => mailServer.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mailServer.address() as AddressInfo).port}`;
    const res = await req(
      '/api/auth/register',
      'POST',
      { name: 'Olga', email: 'owner@acme.ru', password: 'a-long-enough-password', data: createEmptyData('en') },
      '',
    );
    cookie.owner = res.headers.get('set-cookie')!.split(';')[0];
    const invite = await (await req('/api/admin/invites', 'POST', { emails: ['ada@acme.ru'], role: 'admin' })).json();
    const ada = await req(
      '/api/auth/register',
      'POST',
      { name: 'Ada', email: 'ada@acme.ru', password: 'a-long-enough-password', invite: invite.token },
      '',
    );
    cookie.ada = ada.headers.get('set-cookie')!.split(';')[0];
  });
  afterAll(async () => {
    await new Promise<void>((r) => mailServer.close(() => r()));
    mailApi.close();
  });

  it('starts off and only the owner can connect a mailbox', async () => {
    const { mail } = await (await req('/api/admin/mail')).json();
    expect(mail).toMatchObject({ configured: false, source: null, editable: true });
    expect((await (await req('/api/admin/mail', 'GET', undefined, 'ada')).json()).mail.editable).toBe(false);
    expect((await req('/api/admin/mail', 'PUT', settings, 'ada')).status).toBe(403);
  });

  it('explains what is wrong and saves nothing when the letter cannot go out', async () => {
    failWith = 'EAUTH';
    const res = await req('/api/admin/mail', 'PUT', settings);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'auth' });
    expect((await (await req('/api/admin/mail')).json()).mail.configured).toBe(false);
    failWith = null;
    expect(await (await req('/api/admin/mail', 'PUT', { ...settings, publicUrl: 'ftp://x' })).json()).toMatchObject({ field: 'publicUrl' });
    expect(await (await req('/api/admin/mail', 'PUT', { ...settings, host: 'not a host' })).json()).toMatchObject({ field: 'host' });
  });

  it('sends a test letter to the owner, then invitations go out with the saved address', async () => {
    const res = await req('/api/admin/mail', 'PUT', settings);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.to).toBe('owner@acme.ru');
    expect(body.mail).toMatchObject({ configured: true, source: 'app', from: 'Acme <team@acme.ru>' });
    expect(body.mail.settings).toEqual({
      host: 'smtp.yandex.ru',
      port: 465,
      secure: true,
      user: 'team@acme.ru',
      name: 'Acme',
      publicUrl: 'https://done.acme.ru',
    });
    expect(JSON.stringify(body)).not.toContain('app-password');
    expect(sent.at(-1)).toMatchObject({ to: 'owner@acme.ru', from: 'Acme <team@acme.ru>' });
    const invite = await (await req('/api/admin/invites', 'POST', { emails: ['new@acme.ru'], role: 'editor' })).json();
    expect(invite.emailed).toEqual(['new@acme.ru']);
    expect(invite.invites[0].url).toMatch(/^https:\/\/done\.acme\.ru\/\?invite=/);
    expect((await (await req('/api/auth/session', 'GET', undefined, '')).json()).mail).toBe(true);
  });

  it('keeps the saved password when the form leaves it empty', async () => {
    const res = await req('/api/admin/mail', 'PUT', { ...settings, pass: '', name: 'Acme team' });
    expect(res.status).toBe(200);
    expect((await res.json()).mail.from).toBe('Acme team <team@acme.ru>');
    expect((await req('/api/admin/mail', 'PUT', { ...settings, user: 'other@acme.ru', pass: '' })).status).toBe(400);
  });

  it('can be disconnected', async () => {
    const { mail } = await (await req('/api/admin/mail', 'DELETE', {})).json();
    expect(mail).toMatchObject({ configured: false, source: null });
    const audit = await (await req('/api/admin/audit')).json();
    expect(audit.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['mail.updated', 'mail.removed']));
  });
});

describe('invitation letter', () => {
  it('lists the projects an invitation opens, one per line', () => {
    const letter = inviteEmail({
      lang: 'ru',
      workspace: 'Acme',
      inviter: 'Olga',
      role: 'editor',
      link: `${PUBLIC}/?invite=t&email=a%40b.co`,
      expires: Date.UTC(2026, 9, 4),
      email: 'a@b.co',
      projects: [
        { name: 'Mobile <app>', icon: '📱' },
        { name: 'Web', icon: 'lucide:globe' },
      ],
    });
    expect(letter.subject).toBe('Olga приглашает вас в «Acme»');
    expect(letter.text).toContain('Проекты: 📱 Mobile <app>, Web.');
    expect(letter.html).toContain('📱 Mobile &lt;app&gt;<br>Web');
    expect(letter.html).toContain('Приглашение для a@b.co действует до 4 октября');
    expect(letter.html).toContain('prefers-color-scheme:dark');
  });

  it('reads well without a team name or an inviter', () => {
    const ru = inviteEmail({ lang: 'ru', workspace: '', inviter: '', role: 'viewer', link: `${PUBLIC}/`, expires: Date.now() });
    expect(ru.subject).toBe('Приглашение в Done');
    const en = inviteEmail({ lang: 'en', workspace: '', inviter: 'Mike', role: 'viewer', link: `${PUBLIC}/`, expires: Date.now() });
    expect(en.subject).toBe('Mike invited you to Done');
    // The logo and illustration travel inside the letter, whatever address Done runs on.
    expect(en.attachments.map((a: { cid: string }) => a.cid)).toEqual(['done-mark@done', 'team@done']);
  });
});

describe('team name from the sign-up email', () => {
  it('uses the company domain and skips personal mail services', () => {
    expect(teamNameFromEmail('anna@acme.ru')).toBe('Acme');
    expect(teamNameFromEmail('anna@mail.big-corp.com')).toBe('Big Corp');
    expect(teamNameFromEmail('anna@studio.co.uk')).toBe('Studio');
    expect(teamNameFromEmail('anna@gmail.com')).toBe('');
    expect(teamNameFromEmail('anna@yandex.ru')).toBe('');
    expect(teamNameFromEmail('anna@mail.ru')).toBe('');
    expect(teamNameFromEmail('anna@localhost')).toBe('');
    expect(teamNameFromEmail('not an email')).toBe('');
  });
});
