import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
import { createEmptyData } from '@/lib/store';

const PASSWORD = 'a-long-enough-password';

/** A server on a random port; `from` sends X-Forwarded-For as a reverse proxy in front of Done would. */
async function start(options: Record<string, unknown> = {}) {
  const api = createAuthApi({ filename: ':memory:', publicUrl: 'https://done.example.com', mailer: { sendMail: async () => ({}) }, ...options });
  const server: Server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, data: unknown, { cookie = '', from }: { cookie?: string; from?: string } = {}) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie, ...(from ? { 'x-forwarded-for': from } : {}) },
      body: JSON.stringify(data),
    });
  const login = (email: string, password = PASSWORD, from?: string) => call('/api/auth/login', { email, password }, { from });
  const res = await call('/api/auth/register', { name: 'Olga', email: 'owner@example.com', password: PASSWORD, data: createEmptyData('en') });
  const owner = res.headers.get('set-cookie')!.split(';')[0];
  const { link } = await (await call('/api/admin/invite-link', { enabled: true }, { cookie: owner })).json();
  const join = new URL(link.url).searchParams.get('join')!;
  const register = (email: string, from?: string) => call('/api/auth/register', { name: email, email, password: PASSWORD, join }, { from });
  const stop = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    api.close();
  };
  return { call, login, register, join, stop };
}

describe('a team behind one address', () => {
  let s: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (s = await start()));
  afterAll(() => s.stop());

  it('can all join and sign in at once', async () => {
    const people = Array.from({ length: 20 }, (_, i) => `person${i}@example.com`);
    for (const email of people) expect((await s.register(email)).status).toBe(200);
    for (const email of people) expect((await s.login(email)).status).toBe(200);
    for (let i = 0; i < 20; i++) expect((await s.login('owner@example.com')).status).toBe(200);
  });

  it('opens a valid invite link as often as needed', async () => {
    for (let i = 0; i < 60; i++) expect((await s.call('/api/auth/join', { token: s.join })).status).toBe(200);
  });

  it('stops guessing one password without locking out teammates', async () => {
    for (let i = 0; i < 10; i++) expect((await s.login('person0@example.com', 'a-wrong-password')).status).toBe(401);
    expect((await s.login('person0@example.com')).status).toBe(429);
    expect((await s.login('person1@example.com')).status).toBe(200);
  });

  it('keeps counting guesses that arrive at the same time', async () => {
    const statuses = await Promise.all(Array.from({ length: 20 }, () => s.login('person2@example.com', 'a-wrong-password').then((r) => r.status)));
    expect(statuses.filter((x) => x === 401).length).toBe(10);
    expect(statuses.filter((x) => x === 429).length).toBe(10);
  });
});

describe('an address guessing many accounts', () => {
  let s: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => (s = await start()));
  afterAll(() => s.stop());

  it('is cut off after 50 failures, for sign-in and for invite links', async () => {
    for (let i = 0; i < 50; i++) expect((await s.login(`nobody${i}@example.com`, 'a-wrong-password')).status).toBe(401);
    expect((await s.login('owner@example.com')).status).toBe(429);
    for (let i = 0; i < 40; i++) expect((await s.call('/api/auth/join', { token: `wrong-${i}` })).status).toBe(410);
    expect((await s.call('/api/auth/join', { token: s.join })).status).toBe(429);
  });
});

describe('behind a reverse proxy', () => {
  it('ignores X-Forwarded-For unless DONE_TRUST_PROXY says there is a proxy', async () => {
    const s = await start();
    for (let i = 0; i < 10; i++) await s.login('owner@example.com', 'a-wrong-password', `203.0.113.${i}`);
    expect((await s.login('owner@example.com', PASSWORD, '198.51.100.7')).status).toBe(429);
    await s.stop();
  });

  it('tells people apart by the address the proxy saw, which the client cannot forge', async () => {
    const s = await start({ trustProxy: '1' });
    for (let i = 0; i < 10; i++) await s.login('owner@example.com', 'a-wrong-password', `10.0.0.${i}, 203.0.113.9`);
    // The same person again, whatever they put in front of the proxy's entry.
    expect((await s.login('owner@example.com', PASSWORD, '198.51.100.7, 203.0.113.9')).status).toBe(429);
    // The owner at the office is a different address.
    expect((await s.login('owner@example.com', PASSWORD, '198.51.100.7')).status).toBe(200);
    await s.stop();
  });

  it('counts proxies from the right when there are several', async () => {
    const s = await start({ trustProxy: '2' });
    for (let i = 0; i < 10; i++) await s.login('owner@example.com', 'a-wrong-password', `203.0.113.9, 192.0.2.${i}`);
    expect((await s.login('owner@example.com', PASSWORD, '203.0.113.9, 192.0.2.99')).status).toBe(429);
    expect((await s.login('owner@example.com', PASSWORD, '198.51.100.7, 192.0.2.1')).status).toBe(200);
    await s.stop();
  });
});
