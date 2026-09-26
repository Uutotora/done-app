// Production server: serves the built SPA from ./dist and mounts the Plane
// API proxy at /api/plane. Run `npm run build && npm start`.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planeProxy } from './server/planeProxy.mjs';
import { createAuthApi } from './server/auth.mjs';
const auth = createAuthApi();

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

async function serveFile(res, file, cache) {
  const data = await readFile(file);
  res.statusCode = 200;
  res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
  res.setHeader('cache-control', cache ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.end(data);
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (/^\/api\/(auth\/|admin\/|projects\/|workspace$|events$|presence$|members$|blobs\/)/.test(url.pathname)) return auth.handler(req, res);

  if (url.pathname.startsWith('/api/plane/')) {
    if (!auth.authenticate(req)) {
      res.writeHead(401);
      res.end('Sign in required');
      return;
    }
    req.url = req.url.slice('/api/plane'.length);
    return planeProxy(req, res);
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end('Invalid URL');
    return;
  }
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, safe);
  try {
    if (file.startsWith(root + '/') && (await stat(file)).isFile()) {
      return await serveFile(res, file, safe.startsWith('/assets/'));
    }
  } catch {
    // fall through to SPA index
  }
  try {
    await serveFile(res, join(root, 'index.html'), false);
  } catch {
    res.statusCode = 500;
    res.end('dist/ not found. Run `npm run build` first.');
  }
}).listen(port, () => {
  console.log(`Done is running at http://localhost:${port}`);
});
