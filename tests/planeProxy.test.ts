import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error plain ESM module without types
import { planeProxy } from '../server/planeProxy.mjs';

/** A fake Plane API and the Done proxy in front of it. */
let plane: Server;
let proxy: Server;
let planeUrl = '';
let proxyUrl = '';
const seen: { url?: string; key?: string; method?: string; body?: string }[] = [];

beforeAll(async () => {
  plane = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-api-key'] as string, method: req.method, body });
      res.setHeader('content-type', 'application/json');
      if (req.headers['x-api-key'] !== 'secret') {
        res.statusCode = 401;
        res.end(JSON.stringify({ detail: 'Invalid API key' }));
        return;
      }
      res.end(JSON.stringify({ results: [{ id: 'p1', name: 'Mobile', identifier: 'MOB' }], next_page_results: false }));
    });
  });
  proxy = createServer((req, res) => {
    req.url = (req.url ?? '').replace(/^\/api\/plane/, '');
    void planeProxy(req, res);
  });
  await new Promise<void>((r) => plane.listen(0, r));
  await new Promise<void>((r) => proxy.listen(0, r));
  planeUrl = `http://127.0.0.1:${(plane.address() as AddressInfo).port}`;
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});

afterAll(() => {
  plane.close();
  proxy.close();
});

const call = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  fetch(`${proxyUrl}/api/plane${path}`, { ...init, headers: { 'x-plane-base': planeUrl, 'x-api-key': 'secret', ...headers } });

describe('Plane proxy', () => {
  it('forwards API requests with the key', async () => {
    const res = await call('/api/v1/workspaces/acme/projects/?per_page=100');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ results: [{ identifier: 'MOB' }] });
    expect(seen.at(-1)).toMatchObject({ url: '/api/v1/workspaces/acme/projects/?per_page=100', key: 'secret', method: 'GET' });
  });

  it('forwards POST bodies', async () => {
    const res = await call('/api/v1/workspaces/acme/projects/p1/issues/', { method: 'POST', body: JSON.stringify({ name: 'Hi' }) });
    expect(res.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ method: 'POST', body: '{"name":"Hi"}' });
  });

  it('passes Plane errors through', async () => {
    const res = await call('/api/v1/workspaces/acme/projects/', {}, { 'x-api-key': 'wrong' });
    expect(res.status).toBe(401);
  });

  it('refuses paths outside /api/v1 and path traversal', async () => {
    expect((await call('/admin')).status).toBe(400);
    expect((await call('/api/v1/../../etc/passwd')).status).toBe(400);
  });

  it('requires a valid http(s) base URL and a key', async () => {
    expect((await call('/api/v1/x', {}, { 'x-plane-base': 'file:///etc' })).status).toBe(400);
    expect((await call('/api/v1/x', {}, { 'x-plane-base': 'not a url' })).status).toBe(400);
    const res = await fetch(`${proxyUrl}/api/plane/api/v1/x`, { headers: { 'x-plane-base': planeUrl } });
    expect(res.status).toBe(400);
  });

  it('honours PLANE_ALLOWED_HOSTS', async () => {
    process.env.PLANE_ALLOWED_HOSTS = 'api.plane.so';
    try {
      expect((await call('/api/v1/workspaces/acme/projects/')).status).toBe(403);
    } finally {
      delete process.env.PLANE_ALLOWED_HOSTS;
    }
  });
});
