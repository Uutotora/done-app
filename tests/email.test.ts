import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
// @ts-expect-error shared Node server
import { createMail, escapeHtml, inviteEmail, normalizePublicUrl, resetEmail, smtpFromEnv } from '../server/mail.mjs';
import { createEmptyData } from '@/lib/store';

interface Message {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}
const PUBLIC = 'https://done.example.com';

/** A transport that records messages and refuses the addresses in `refuse`. */
function stubMailer() {
  const sent: Message[] = [];
  const refuse = new Set<string>();
  return {
    sent,
    refuse,
    sendMail: async (message: Message) => {
      if (refuse.has(message.to)) throw Object.assign(new Error('550 mailbox unavailable at smtp.secret.local'), { code: 'EENVELOPE' });
      sent.push(message);
      return { messageId: String(sent.length) };
    },
  };
}

/** One server on a random port with its own cookie jar per person. */
async function startServer(options: Record<string, unknown>) {
  const api = createAuthApi({ filename: ':memory:', ...options });
  const server: Server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const call = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
    fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookies[who] ?? '' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const remember = (who: string, res: Response) => {
    cookies[who] = res.headers.get('set-cookie')!.split(';')[0];
  };
  const data = createEmptyData('en');
  data.workspace = { ...data.workspace, name: 'Acme <b>&</b> "Co"' };
  const res = await call(
    '/api/auth/register',
    'POST',
    { name: 'Olga <img src=x onerror=alert(1)>', email: 'owner@example.com', password: 'a-long-owner-password', data },
    '',
  );
  remember('owner', res);
  ids.owner = (await res.json()).user.id;
  /** Invites and registers someone, returning nothing; the stub mailer must not refuse them. */
  const join = async (name: string, role: string) => {
    const invite = await (await call('/api/admin/invites', 'POST', { emails: [`${name}@example.com`], role })).json();
    const reg = await call(
      '/api/auth/register',
      'POST',
      { name, email: `${name}@example.com`, password: `a-long-${name}-password`, invite: invite.token },
      '',
    );
    remember(name, reg);
    ids[name] = (await reg.json()).user.id;
  };
  const stop = async () => {
    await api.idle();
    api.close();
    await new Promise((r) => server.close(r));
  };
  return { api, call, cookies, ids, join, remember, stop };
}

const tokenFrom = (text: string, param: string) => new RegExp(`[?&]${param}=([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? '';

describe('mail helpers', () => {
  it('builds links only from a configured http(s) public URL', () => {
    expect(normalizePublicUrl('https://done.example.com/')).toBe('https://done.example.com');
    expect(normalizePublicUrl(' https://example.com/app// ')).toBe('https://example.com/app');
    expect(normalizePublicUrl('javascript:alert(1)')).toBe('');
    expect(normalizePublicUrl('https://user:pass@example.com')).toBe('');
    expect(normalizePublicUrl('')).toBe('');
    expect(normalizePublicUrl(undefined)).toBe('');
  });

  it('reads SMTP settings from the environment', () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ DONE_SMTP_URL: 'ftp://x' })).toBeNull();
    const byUrl = smtpFromEnv({ DONE_SMTP_URL: 'smtps://robot%40acme.ru:secret@smtp.yandex.ru:465' });
    expect(byUrl.user).toBe('robot@acme.ru');
    expect(byUrl.options.url).toContain('smtp.yandex.ru');
    const byHost = smtpFromEnv({ DONE_SMTP_HOST: 'smtp.acme.ru', DONE_SMTP_USER: 'robot', DONE_SMTP_PASS: 'pw' });
    expect(byHost.options).toMatchObject({ host: 'smtp.acme.ru', port: 587, secure: false, auth: { user: 'robot', pass: 'pw' } });
    expect(smtpFromEnv({ DONE_SMTP_HOST: 'smtp.acme.ru', DONE_SMTP_SECURE: 'true' }).options).toMatchObject({ port: 465, secure: true });
  });

  it('is off without a public URL, even with a transport', () => {
    const transport = stubMailer();
    expect(createMail({ transport, publicUrl: '', from: 'Done <a@b.co>', env: {} }).configured).toBe(false);
    const on = createMail({ transport, publicUrl: PUBLIC, env: {} });
    expect(on.configured).toBe(true);
    expect(on.from).toBe('Done <noreply@done.example.com>');
    expect(on.link('reset=abc')).toBe(`${PUBLIC}/?reset=abc`);
    // The environment is used when nothing is passed in; DONE_ORIGIN is the fallback for links.
    expect(createMail({ transport, env: { DONE_ORIGIN: 'https://origin.example.com', DONE_MAIL_FROM: 'Done <x@y.z>' } }).publicUrl).toBe(
      'https://origin.example.com',
    );
  });

  it('refuses recipient lists and reports failures without throwing', async () => {
    const transport = stubMailer();
    const mail = createMail({ transport, publicUrl: PUBLIC, from: 'Done <a@b.co>', env: {} });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    transport.refuse.add('bad@example.com');
    const result = await mail.sendAll([
      { to: 'ok@example.com', subject: 's', text: 't' },
      { to: 'bad@example.com', subject: 's', text: 't' },
      { to: 'a,b@example.com', subject: 's', text: 't' },
    ]);
    expect(result).toEqual({ sent: ['ok@example.com'], failed: ['bad@example.com', 'a,b@example.com'] });
    expect(transport.sent.map((m) => m.to)).toEqual(['ok@example.com']);
    error.mockRestore();
  });

  it('escapes every user value in the HTML version', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    const letter = inviteEmail({
      lang: 'ru',
      workspace: '<script>alert(1)</script>',
      inviter: 'Eve <img src=x>',
      role: 'editor',
      link: `${PUBLIC}/?invite=t&email=a%40b.co`,
      expires: Date.UTC(2026, 9, 4),
    });
    expect(letter.subject).toBe('Приглашение в <script>alert(1)</script> · Done');
    expect(letter.html).not.toMatch(/<script|<img/);
    expect(letter.html).toContain('&lt;script&gt;');
    expect(letter.html).toContain('href="https://done.example.com/?invite=t&amp;email=a%40b.co"');
    expect(letter.text).toContain('Ваша роль: редактор.');
    const reset = resetEmail({ lang: 'en', name: 'Ann\n<b>', email: 'ann@example.com', link: `${PUBLIC}/?reset=abc`, hours: 1 });
    expect(reset.subject).toBe('Password reset · Done');
    expect(reset.html).not.toContain('<b>');
    expect(reset.text).toContain('1 hour');
  });
});

describe('email on the server', () => {
  const mailer = stubMailer();
  let s: Awaited<ReturnType<typeof startServer>>;
  const lastTo = (to: string) => [...mailer.sent].reverse().find((m) => m.to === to);
  beforeAll(async () => {
    s = await startServer({ mailer, publicUrl: PUBLIC, mailFrom: 'Done <noreply@example.com>' });
    await s.join('ada', 'admin');
    await s.join('eve', 'editor');
    await s.join('vic', 'viewer');
  });
  afterAll(() => s.stop());
  afterEach(() => vi.restoreAllMocks());

  it('tells the sign-in form and admins that email is on', async () => {
    expect((await (await s.call('/api/auth/session', 'GET', undefined, '')).json()).mail).toBe(true);
    const admin = await (await s.call('/api/admin/members')).json();
    expect(admin.mail).toEqual({ configured: true, from: 'Done <noreply@example.com>' });
  });

  it('emails invitations with the link, the inviter and the escaped workspace name', async () => {
    mailer.refuse.add('broken@example.com');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await s.call('/api/admin/invites', 'POST', { emails: ['new1@example.com', 'broken@example.com'], role: 'viewer', lang: 'ru' });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.emailed).toEqual(['new1@example.com']);
    expect(json.failed).toEqual(['broken@example.com']);
    // No SMTP details reach the client.
    expect(JSON.stringify(json)).not.toContain('secret');
    const letter = lastTo('new1@example.com')!;
    expect(letter.from).toBe('Done <noreply@example.com>');
    expect(letter.subject).toBe('Приглашение в Acme <b>&</b> "Co" · Done');
    const token = json.invites.find((i: { email: string }) => i.email === 'new1@example.com').token;
    expect(letter.text).toContain(`${PUBLIC}/?invite=${token}&email=new1%40example.com`);
    expect(letter.text).toContain('Olga');
    expect(letter.text).toContain('наблюдатель');
    expect(letter.html).not.toMatch(/<img|<b>/);
    expect(letter.html).toContain('Acme &lt;b&gt;&amp;&lt;/b&gt; &quot;Co&quot;');
    expect(json.invites[0].url).toBe(`${PUBLIC}/?invite=${json.invites[0].token}&email=new1%40example.com`);

    const en = await (await s.call('/api/admin/invites', 'POST', { emails: 'new2@example.com', role: 'editor', lang: 'en' })).json();
    expect(en.emailed).toEqual(['new2@example.com']);
    expect(lastTo('new2@example.com')!.subject).toBe('Invitation to Acme <b>&</b> "Co" · Done');
  });

  it('resends a pending invitation with a new link', async () => {
    const first = await (await s.call('/api/admin/invites', 'POST', { emails: ['again@example.com'], role: 'editor' })).json();
    const before = mailer.sent.length;
    const res = await s.call('/api/admin/invites/resend', 'POST', { email: 'again@example.com', lang: 'en' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailed).toBe(true);
    expect(json.token).not.toBe(first.token);
    expect(json.url).toBe(`${PUBLIC}/?invite=${json.token}&email=again%40example.com`);
    expect(mailer.sent.length).toBe(before + 1);
    expect(lastTo('again@example.com')!.text).toContain(json.token);
    // The old link stops working; the new one creates the account with the same role.
    const old = await s.call(
      '/api/auth/register',
      'POST',
      { name: 'Again', email: 'again@example.com', password: 'a-long-again-password', invite: first.token },
      '',
    );
    expect(old.status).toBe(403);
    const fresh = await s.call(
      '/api/auth/register',
      'POST',
      { name: 'Again', email: 'again@example.com', password: 'a-long-again-password', invite: json.token },
      '',
    );
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).user.role).toBe('editor');
    expect((await s.call('/api/admin/invites/resend', 'POST', { email: 'again@example.com' })).status).toBe(404);
  });

  it('lets only those who could invite resend an invitation', async () => {
    await s.call('/api/admin/invites', 'POST', { emails: ['boss@example.com'], role: 'admin' });
    expect((await s.call('/api/admin/invites/resend', 'POST', { email: 'boss@example.com' }, 'ada')).status).toBe(403);
    expect((await s.call('/api/admin/invites/resend', 'POST', { email: 'boss@example.com' }, 'eve')).status).toBe(403);
    expect((await s.call('/api/admin/invites/resend', 'POST', { email: 'boss@example.com' }, 'owner')).status).toBe(200);
  });

  it('answers a reset request the same way whether or not the account exists', async () => {
    const before = mailer.sent.length;
    const unknown = await s.call('/api/auth/reset/request', 'POST', { email: 'nobody@example.com', lang: 'en' }, '');
    await s.api.idle();
    expect(mailer.sent.length).toBe(before);
    const known = await s.call('/api/auth/reset/request', 'POST', { email: 'Vic@Example.com', lang: 'en' }, '');
    await s.api.idle();
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(await unknown.json()).toEqual(await known.json());
    expect(mailer.sent.length).toBe(before + 1);
    const letter = lastTo('vic@example.com')!;
    expect(letter.subject).toBe('Password reset · Done');
    expect(letter.text).toContain(`${PUBLIC}/?reset=`);
    expect((await s.call('/api/auth/reset/request', 'POST', { email: 'not-an-email' }, '')).status).toBe(400);
  });

  it('resets the password once, signs out old sessions and signs in', async () => {
    await s.call('/api/auth/reset/request', 'POST', { email: 'eve@example.com', lang: 'ru' }, '');
    await s.api.idle();
    const letter = lastTo('eve@example.com')!;
    expect(letter.subject).toBe('Сброс пароля · Done');
    const token = tokenFrom(letter.text, 'reset');
    expect(token).toHaveLength(43);
    const check = await s.call('/api/auth/reset/check', 'POST', { token }, '');
    expect(await check.json()).toMatchObject({ email: 'eve@example.com' });
    expect((await s.call('/api/auth/reset', 'POST', { token, password: 'short' }, '')).status).toBe(400);

    const res = await s.call('/api/auth/reset', 'POST', { token, password: 'a-brand-new-eve-password' }, '');
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe('eve@example.com');
    s.cookies.eveBefore = s.cookies.eve;
    s.remember('eve', res);
    expect((await s.call('/api/workspace', 'GET', undefined, 'eve')).status).toBe(200);
    expect((await s.call('/api/workspace', 'GET', undefined, 'eveBefore')).status).toBe(401);
    // Single use.
    expect((await s.call('/api/auth/reset', 'POST', { token, password: 'another-long-password' }, '')).status).toBe(410);
    expect((await s.call('/api/auth/reset/check', 'POST', { token }, '')).status).toBe(410);
    // The new password works and the old one does not.
    const login = (password: string) => s.call('/api/auth/login', 'POST', { email: 'eve@example.com', password }, '');
    expect((await login('a-long-eve-password')).status).toBe(401);
    expect((await login('a-brand-new-eve-password')).status).toBe(200);
    const events = (await (await s.call('/api/admin/audit')).json()).events.map((e: { action: string }) => e.action);
    expect(events).toContain('password.reset');
  });

  it('keeps only the newest reset link and lets links expire', async () => {
    const request = async () => {
      await s.call('/api/auth/reset/request', 'POST', { email: 'vic@example.com' }, '');
      await s.api.idle();
      return tokenFrom(lastTo('vic@example.com')!.text, 'reset');
    };
    const older = await request();
    const newer = await request();
    expect(newer).not.toBe(older);
    expect((await s.call('/api/auth/reset/check', 'POST', { token: older }, '')).status).toBe(410);
    expect((await s.call('/api/auth/reset/check', 'POST', { token: newer }, '')).status).toBe(200);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61 * 60000);
    expect((await s.call('/api/auth/reset', 'POST', { token: newer, password: 'a-late-vic-password' }, '')).status).toBe(410);
  });

  it('lets administrators create reset links for the people they manage', async () => {
    const reset = (target: string, who: string) => s.call(`/api/admin/members/${s.ids[target]}/reset`, 'POST', { lang: 'en' }, who);
    expect((await reset('owner', 'ada')).status).toBe(403);
    expect((await reset('ada', 'ada')).status).toBe(403);
    expect((await reset('owner', 'owner')).status).toBe(403);
    expect((await reset('vic', 'eve')).status).toBe(403);
    const res = await reset('vic', 'ada');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailed).toBe(true);
    expect(json.url).toBe(`${PUBLIC}/?reset=${json.token}`);
    const letter = lastTo('vic@example.com')!;
    expect(letter.text).toContain(json.url);
    expect(letter.text).toContain('ada');
    // Nothing changes until the password is actually reset.
    expect((await s.call('/api/workspace', 'GET', undefined, 'vic')).status).toBe(200);
    expect((await (await s.call('/api/admin/audit')).json()).events.map((e: { action: string }) => e.action)).toContain('password.reset.link');
    // The owner can reset an administrator.
    expect((await reset('ada', 'owner')).status).toBe(200);
  });

  it('sends a test email to the administrator', async () => {
    const res = await s.call('/api/admin/mail/test', 'POST', { lang: 'en' }, 'ada');
    expect(res.status).toBe(200);
    expect((await res.json()).to).toBe('ada@example.com');
    expect(lastTo('ada@example.com')!.subject).toBe('Email check · Done');
    expect((await s.call('/api/admin/mail/test', 'POST', {}, 'eve')).status).toBe(403);
  });

  it('says nothing about SMTP errors when a test email fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mailer.refuse.add('owner@example.com');
    const res = await s.call('/api/admin/mail/test', 'POST', {});
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
    mailer.refuse.delete('owner@example.com');
  });
});

describe('reset requests are rate limited', () => {
  const mailer = stubMailer();
  let s: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    s = await startServer({ mailer, publicUrl: PUBLIC, mailFrom: 'Done <noreply@example.com>' });
  });
  afterAll(() => s.stop());

  it('sends at most five letters per address and then limits the IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await s.call('/api/auth/reset/request', 'POST', { email: 'owner@example.com' }, '')).status);
    await s.api.idle();
    expect(statuses.every((x) => x === 200)).toBe(true);
    expect(mailer.sent.length).toBe(5);
    for (let i = 7; i < 20; i++) await s.call('/api/auth/reset/request', 'POST', { email: `n${i}@example.com` }, '');
    expect((await s.call('/api/auth/reset/request', 'POST', { email: 'x@example.com' }, '')).status).toBe(429);
  });
});

describe('without a public URL', () => {
  const mailer = stubMailer();
  let s: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    s = await startServer({ mailer, publicUrl: '', mailFrom: 'Done <noreply@example.com>' });
    await s.join('eve', 'editor');
  });
  afterAll(() => s.stop());

  it('sends nothing and keeps links to share by hand', async () => {
    expect((await (await s.call('/api/auth/session', 'GET', undefined, '')).json()).mail).toBe(false);
    expect((await (await s.call('/api/admin/members')).json()).mail).toEqual({ configured: false });
    const invite = await (await s.call('/api/admin/invites', 'POST', { emails: ['x@example.com'], role: 'viewer' })).json();
    expect(invite).toMatchObject({ emailed: [], failed: [], url: null });
    expect(invite.token).toBeTruthy();
    expect((await s.call('/api/auth/reset/request', 'POST', { email: 'eve@example.com' }, '')).status).toBe(200);
    const link = await (await s.call(`/api/admin/members/${s.ids.eve}/reset`, 'POST', {})).json();
    expect(link).toMatchObject({ emailed: false, url: null });
    expect((await s.call('/api/auth/reset/check', 'POST', { token: link.token }, '')).status).toBe(200);
    expect((await s.call('/api/admin/mail/test', 'POST', {})).status).toBe(400);
    await s.api.idle();
    expect(mailer.sent).toEqual([]);
  });
});
