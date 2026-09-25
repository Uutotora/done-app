// Minimal pass-through proxy for the Plane REST API.
//
// Plane does not send CORS headers for API-key requests, so the browser
// cannot talk to it directly. The client calls `/api/plane/api/v1/...` with
// two headers: `x-plane-base` (e.g. https://api.plane.so or a self-hosted
// origin) and `x-api-key`. We forward only `/api/v1/*` paths and only the
// headers Plane needs, which keeps this from becoming an open proxy for
// arbitrary URLs on the target host.
//
// Optional hardening: set PLANE_ALLOWED_HOSTS="api.plane.so,plane.acme.dev"
// to restrict which Plane origins may be targeted.

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

function allowedHosts() {
  const raw = process.env.PLANE_ALLOWED_HOSTS;
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Node/Connect style handler. `req.url` is expected to be the path after the
 * mount point, e.g. `/api/v1/workspaces/acme/projects/`.
 */
export async function planeProxy(req, res) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return send(res, 405, { error: 'Method not allowed' });

    const path = req.url || '/';
    if (!path.startsWith('/api/v1/') || path.includes('..')) {
      return send(res, 400, { error: 'Only /api/v1/* paths can be proxied' });
    }

    const baseHeader = req.headers['x-plane-base'];
    const apiKey = req.headers['x-api-key'];
    if (typeof baseHeader !== 'string' || typeof apiKey !== 'string' || !apiKey) {
      return send(res, 400, { error: 'x-plane-base and x-api-key headers are required' });
    }

    let base;
    try {
      base = new URL(baseHeader);
    } catch {
      return send(res, 400, { error: 'x-plane-base must be an absolute URL' });
    }
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      return send(res, 400, { error: 'x-plane-base must use http or https' });
    }
    const hosts = allowedHosts();
    if (hosts && !hosts.has(base.host.toLowerCase())) {
      return send(res, 403, { error: `Host ${base.host} is not in PLANE_ALLOWED_HOSTS` });
    }

    const target = new URL(path, base.origin);
    const headers = { 'x-api-key': apiKey, accept: 'application/json' };
    let body;
    if (method !== 'GET') {
      body = await readBody(req);
      headers['content-type'] = 'application/json';
    }

    const upstream = await fetch(target, { method, headers, body, redirect: 'follow' });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.end(text);
  } catch (err) {
    send(res, 502, { error: 'Plane request failed', detail: String(err && err.message ? err.message : err) });
  }
}
