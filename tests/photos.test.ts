import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
// @ts-expect-error shared Node server
import { isValidPhoto, validateState } from '../server/access.mjs';
import { createEmptyData } from '@/lib/store';
import { PHOTO_MAX_CHARS, PHOTO_QUALITIES, centerSquare, encodeWithinLimit, isSafePhoto, photoFileProblem } from '@/lib/photo';

const webp = `data:image/webp;base64,${'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA='}`;

describe('profile photo helper', () => {
  it('cuts the centered square out of any picture', () => {
    expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
    expect(centerSquare(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 });
    expect(centerSquare(128, 128)).toEqual({ sx: 0, sy: 0, side: 128 });
    expect(centerSquare(0, 0).side).toBe(1);
  });

  it('checks the file type and size before reading it', () => {
    expect(photoFileProblem({ type: 'image/png', size: 1000 })).toBeUndefined();
    expect(photoFileProblem({ type: 'image/gif', size: 10 * 1024 * 1024 })).toBeUndefined();
    expect(photoFileProblem({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toBe('tooBig');
    expect(photoFileProblem({ type: 'image/svg+xml', size: 100 })).toBe('type');
    expect(photoFileProblem({ type: 'application/pdf', size: 100 })).toBe('type');
  });

  it('lowers the quality until the photo fits, and falls back to jpeg without webp', () => {
    const calls: [string, number][] = [];
    // Size shrinks with quality: 0.85 → 60 000 chars, 0.65 → 46 000 chars.
    const encoder = (supportsWebp: boolean) => (type: string, quality: number) => {
      calls.push([type, quality]);
      const actual = type === 'image/webp' && !supportsWebp ? 'image/png' : type;
      return `data:${actual};base64,${'A'.repeat(Math.round(quality * 70000))}`;
    };
    const url = encodeWithinLimit(encoder(true));
    expect(url?.startsWith('data:image/webp;base64,')).toBe(true);
    expect(url!.length).toBeLessThanOrEqual(PHOTO_MAX_CHARS);
    expect(calls).toEqual([
      ['image/webp', 0.85],
      ['image/webp', 0.75],
      ['image/webp', 0.65],
    ]);

    calls.length = 0;
    const jpeg = encodeWithinLimit(encoder(false));
    expect(jpeg?.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(calls[0]).toEqual(['image/webp', 0.85]);
    expect(calls.slice(1).every(([type]) => type === 'image/jpeg')).toBe(true);

    expect(encodeWithinLimit(() => `data:image/webp;base64,${'A'.repeat(100000)}`)).toBeUndefined();
    expect(PHOTO_QUALITIES[0]).toBe(0.85);
  });

  it('only renders raster data URLs', () => {
    expect(isSafePhoto(webp)).toBe(true);
    expect(isSafePhoto('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafePhoto('javascript:alert(1)')).toBe(false);
    expect(isSafePhoto('https://example.com/me.png')).toBe(false);
    expect(isSafePhoto(undefined)).toBe(false);
  });
});

describe('profile photos on the server', () => {
  it('accepts small raster images only', () => {
    expect(isValidPhoto(undefined)).toBe(true);
    expect(isValidPhoto(webp)).toBe(true);
    expect(isValidPhoto(`data:image/png;base64,${'A'.repeat(69000)}`)).toBe(true);
    expect(isValidPhoto(`data:image/png;base64,${'A'.repeat(70000)}`)).toBe(false);
    expect(isValidPhoto('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+')).toBe(false);
    expect(isValidPhoto('data:image/png;base64,AAAA" onerror="alert(1)')).toBe(false);
    expect(isValidPhoto('data:text/html;base64,PGgxPg==')).toBe(false);
    expect(isValidPhoto('https://example.com/me.png')).toBe(false);
    expect(isValidPhoto(null)).toBe(false);
    expect(isValidPhoto(42)).toBe(false);

    const data = createEmptyData('en', 'Me');
    data.people[data.meId].photo = webp;
    expect(() => validateState(structuredClone(data))).not.toThrow();
    (data.people[data.meId] as { photo?: unknown }).photo = 'data:image/svg+xml;base64,PHN2Zz4=';
    expect(() => validateState(structuredClone(data))).toThrow('Invalid photo');
  });
});

describe('photos through the API', () => {
  let server: Server;
  let url = '';
  let api: ReturnType<typeof createAuthApi>;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const call = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
    fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookies[who] ?? '' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const load = async (who: string) => (await call('/api/workspace', 'GET', undefined, who)).json();
  const patchPerson = async (who: string, id: string, photo: unknown) => {
    const person = (await load(who)).data.people[id];
    return call('/api/workspace', 'PATCH', { changes: { records: { people: { [id]: { before: person, after: { ...person, photo } } } } } }, who);
  };

  beforeAll(async () => {
    api = createAuthApi({ filename: ':memory:' });
    server = createServer(api.handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await call(
      '/api/auth/register',
      'POST',
      { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data: createEmptyData('en') },
      '',
    );
    cookies.owner = res.headers.get('set-cookie')!.split(';')[0];
    ids.owner = (await res.json()).user.id;
    const invite = await (await call('/api/admin/invites', 'POST', { emails: 'vic@example.com', role: 'viewer', projectIds: [] })).json();
    const joined = await call(
      '/api/auth/register',
      'POST',
      { name: 'Vic', email: 'vic@example.com', password: 'a-long-vic-password', invite: invite.token },
      '',
    );
    cookies.vic = joined.headers.get('set-cookie')!.split(';')[0];
    ids.vic = (await joined.json()).user.id;
  });

  afterAll(async () => {
    api.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('lets everyone set their own photo, rejects unsafe images and other people’s photos', async () => {
    expect((await patchPerson('vic', ids.vic, webp)).status).toBe(200);
    expect((await load('owner')).data.people[ids.vic].photo).toBe(webp);
    expect((await patchPerson('vic', ids.vic, 'data:image/svg+xml;base64,PHN2Zz4=')).status).toBe(400);
    expect((await patchPerson('vic', ids.owner, webp)).status).toBe(403);
    expect((await patchPerson('vic', ids.vic, undefined)).status).toBe(200);
    expect((await load('vic')).data.people[ids.vic].photo).toBeUndefined();
  });
});
