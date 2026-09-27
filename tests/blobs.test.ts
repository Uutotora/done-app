import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
// @ts-expect-error shared Node server
import { cleanMime, createBlobStore, uploadReferences, validBlobId } from '../server/blobs.mjs';
import { createEmptyData } from '@/lib/store';
import { uploadErrorText } from '@/lib/files';
import { translate } from '@/lib/i18n';
import { MAX_UPLOAD_MB, UploadError } from '@/lib/storage';

const MB = 1024 * 1024;
const DAY = 86400000;
const ts = '2026-09-01T00:00:00.000Z';
let server: Server;
let url = '';
let api: ReturnType<typeof createAuthApi>;
const cookies: Record<string, string> = {};

type Init = { body?: BodyInit | null; headers?: Record<string, string>; who?: string; client?: boolean };
const request = (path: string, method = 'GET', { body, headers = {}, who = 'owner', client = true }: Init = {}) =>
  fetch(`${url}${path}`, {
    method,
    headers: { ...(client ? { 'x-done-client': 'web' } : {}), cookie: cookies[who] ?? '', ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
const json = (path: string, method: string, data: unknown, who = 'owner') =>
  request(path, method, { body: JSON.stringify(data), headers: { 'content-type': 'application/json' }, who });
const putBytes = (id: string, bytes: Uint8Array<ArrayBuffer>, who = 'owner', headers: Record<string, string> = {}) =>
  request(`/api/blobs/${id}`, 'PUT', { body: bytes, who, headers: { 'content-type': 'application/octet-stream', ...headers } });
const upload = (scope: string | null, bytes: Uint8Array<ArrayBuffer>, type: string, who = 'owner', name?: string) =>
  request(scope === null ? '/api/uploads' : `/api/uploads?scope=${scope}`, 'POST', {
    body: bytes,
    who,
    headers: { 'content-type': type, ...(name ? { 'x-done-file-name': encodeURIComponent(name) } : {}) },
  });
const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());
const project = (id: string) => ({ id, name: id, icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts });
const file = (id: string, projectId?: string, mime = 'application/pdf') => ({
  id,
  kind: 'file',
  projectId,
  name: `${id}.pdf`,
  size: 1,
  mime,
  createdAt: ts,
  updatedAt: ts,
});
const doc = (id: string, projectId: string | undefined, content: unknown[]) => ({
  id,
  projectId,
  title: id,
  content,
  order: 1,
  createdAt: ts,
  updatedAt: ts,
});
const every = new Uint8Array(512).map((_, i) => i % 256);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function addMember(name: string, body: Record<string, unknown>) {
  const invite = await (await json('/api/admin/invites', 'POST', { emails: `${name}@example.com`, ...body })).json();
  const res = await json(
    '/api/auth/register',
    'POST',
    { name, email: `${name}@example.com`, password: `a-long-${name}-password`, invite: invite.token },
    '',
  );
  cookies[name] = res.headers.get('set-cookie')!.split(';')[0];
}

beforeAll(async () => {
  // A 1 MB limit keeps the size checks quick.
  api = createAuthApi({ filename: ':memory:', maxUploadMb: 1 });
  server = createServer(api.handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const data = createEmptyData('en');
  data.projects = { pub: project('pub'), priv: project('priv') } as unknown as typeof data.projects;
  data.files = {
    fpub: file('fpub', 'pub'),
    fpriv: file('fpriv', 'priv'),
    fbig: file('fbig', 'pub'),
    flegacy: file('flegacy', 'pub'),
  } as unknown as typeof data.files;
  const res = await json('/api/auth/register', 'POST', { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data }, '');
  cookies.owner = res.headers.get('set-cookie')!.split(';')[0];
  await addMember('mia', { role: 'editor', projectIds: ['pub'] });
  await addMember('val', { role: 'viewer', projectIds: ['pub'] });
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  const dir = api.filesDir;
  api.close();
  // The in-memory database keeps its files in a temporary directory that goes away with it.
  expect(existsSync(dir)).toBe(false);
});

describe('shared files on disk', () => {
  it('stores the raw bytes on disk and streams them back with safe headers', async () => {
    expect((await putBytes('fpub', every, 'mia')).status).toBe(200);
    expect(readFileSync(join(api.filesDir, 'fpub'))).toEqual(Buffer.from(every));
    for (const who of ['owner', 'mia', 'val']) {
      const res = await request('/api/blobs/fpub', 'GET', { who });
      expect(res.status).toBe(200);
      expect(await bytesOf(res)).toEqual(every);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-length')).toBe('512');
      expect(res.headers.get('content-disposition')).toBe('attachment');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
    const head = await request('/api/blobs/fpub', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('512');
  });

  it('still accepts base64 in JSON from older clients', async () => {
    const res = await json('/api/blobs/flegacy', 'PUT', { base64: Buffer.from('hello, legacy').toString('base64') });
    expect(res.status).toBe(200);
    expect(await (await request('/api/blobs/flegacy')).text()).toBe('hello, legacy');
  });

  it('rejects ids that are not plain names', async () => {
    for (const id of ['..%2F..%2Fetc%2Fpasswd', 'a.b', '.hidden', 'x'.repeat(101), 'a%00b']) {
      expect((await request(`/api/blobs/${id}`)).status).toBe(400);
      expect((await putBytes(id, every)).status).toBe(400);
      expect((await request(`/api/uploads/${id}`)).status).toBe(400);
    }
    expect(validBlobId('abc_DEF-123')).toBe(true);
    expect(validBlobId('../x')).toBe(false);
    expect(validBlobId('')).toBe(false);
  });

  it('answers 413 above the size limit and keeps nothing', async () => {
    const big = new Uint8Array(MB + 1);
    const res = await putBytes('fbig', big);
    expect(res.status).toBe(413);
    expect((await res.json()).maxMb).toBe(1);
    // Without a declared length the limit is enforced while the body streams in.
    const chunks = Array.from({ length: 20 }, () => new Uint8Array(64 * 1024));
    const streamed = await request('/api/blobs/fbig', 'PUT', {
      body: Readable.toWeb(Readable.from(chunks)) as ReadableStream,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(streamed.status).toBe(413);
    expect((await request('/api/blobs/fbig')).status).toBe(404);
    expect((await json('/api/blobs/fbig', 'PUT', { base64: Buffer.from(big).toString('base64') })).status).toBe(413);
    expect((await putBytes('fbig', new Uint8Array(MB))).status).toBe(200);
  });

  it('keeps the permission checks: hidden projects, read-only members, signed-out visitors', async () => {
    expect((await putBytes('fpriv', every, 'mia')).status).toBe(404);
    expect((await request('/api/blobs/fpriv', 'GET', { who: 'mia' })).status).toBe(404);
    expect((await putBytes('fpub', every, 'val')).status).toBe(403);
    expect((await putBytes('nofile', every)).status).toBe(404);
    expect((await request('/api/blobs/fpub', 'GET', { who: 'nobody' })).status).toBe(401);
    expect((await putBytes('fpriv', every)).status).toBe(200);
    expect((await request('/api/blobs/fpriv', 'GET', { who: 'mia' })).status).toBe(404);
  });

  it('still requires the client header, the same origin and a known body type', async () => {
    const headers = { 'content-type': 'application/octet-stream' };
    expect((await request('/api/blobs/fpub', 'PUT', { body: every, headers, client: false })).status).toBe(403);
    expect((await request('/api/blobs/fpub', 'PUT', { body: every, headers: { ...headers, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await request('/api/blobs/fpub', 'PUT', { body: every, headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await request('/api/blobs/fpub', 'PUT', { body: every, headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await request('/api/uploads?scope=pub', 'POST', { body: PNG, headers: { 'content-type': 'image/png' }, client: false })).status).toBe(
      403,
    );
    expect(
      (await request('/api/uploads?scope=pub', 'POST', { body: PNG, headers: { 'content-type': 'image/png', origin: 'https://evil.example' } }))
        .status,
    ).toBe(403);
    expect(await bytesOf(await request('/api/blobs/fpub'))).toEqual(every);
  });
});

describe('editor uploads', () => {
  it('stores an image for the project and serves it inline only to people who can read it', async () => {
    const res = await upload('pub', PNG, 'image/png', 'mia', 'Схема.png');
    expect(res.status).toBe(201);
    const { url: link, id } = await res.json();
    expect(link).toBe(`/api/uploads/${id}`);
    expect(validBlobId(id)).toBe(true);
    for (const who of ['mia', 'val', 'owner']) {
      const image = await request(link, 'GET', { who });
      expect(image.status).toBe(200);
      expect(await bytesOf(image)).toEqual(PNG);
      expect(image.headers.get('content-type')).toBe('image/png');
      expect(image.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${encodeURIComponent('Схема.png')}`);
      expect(image.headers.get('x-content-type-options')).toBe('nosniff');
      expect(image.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(image.headers.get('content-length')).toBe(String(PNG.length));
    }
    expect((await request(link, 'GET', { who: 'nobody' })).status).toBe(401);
    const etag = (await request(link)).headers.get('etag')!;
    expect((await request(link, 'GET', { headers: { 'if-none-match': etag } })).status).toBe(304);
    // Upload ids are not shared files.
    expect((await request(`/api/blobs/${id}`)).status).toBe(404);
  });

  it('requires edit access in the scope and a known scope', async () => {
    expect((await upload('pub', PNG, 'image/png', 'val')).status).toBe(403);
    expect((await upload('priv', PNG, 'image/png', 'mia')).status).toBe(404);
    expect((await upload('missing', PNG, 'image/png')).status).toBe(404);
    expect((await upload(null, PNG, 'image/png')).status).toBe(400);
    // Pages outside projects are for members who see the whole workspace.
    expect((await upload('workspace', PNG, 'image/png', 'mia')).status).toBe(403);
    const own = await upload('workspace', PNG, 'image/png');
    expect(own.status).toBe(201);
    expect((await request((await own.json()).url, 'GET', { who: 'mia' })).status).toBe(404);
    const big = await upload('pub', new Uint8Array(MB + 1), 'image/png');
    expect(big.status).toBe(413);
  });

  it('hides uploads of hidden projects unless a readable page shows them', async () => {
    const { url: link, id } = await (await upload('priv', PNG, 'image/png')).json();
    expect((await request(link, 'GET', { who: 'mia' })).status).toBe(404);
    const content = [{ type: 'image', props: { url: link } }];
    const changes = { records: { docs: { dpub: { before: null, after: doc('dpub', 'pub', content) } } } };
    expect((await json('/api/workspace', 'PATCH', { changes })).status).toBe(200);
    expect((await request(link, 'GET', { who: 'mia' })).status).toBe(200);
    // A shared file record cannot take over an upload id.
    const taken = { records: { files: { [id]: { before: null, after: file(id, 'pub') } } } };
    expect((await json('/api/workspace', 'PATCH', { changes: taken })).status).toBe(200);
    expect((await putBytes(id, every)).status).toBe(409);
    expect((await request(`/api/blobs/${id}`)).status).toBe(404);
  });

  it('never shows SVG, HTML or other documents inline', async () => {
    const svg = await (await upload('pub', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).json();
    const svgRes = await request(svg.url);
    expect(svgRes.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(svgRes.headers.get('content-security-policy')).toContain('sandbox');
    const html = await (await upload('pub', new TextEncoder().encode('<script>alert(1)</script>'), 'text/html')).json();
    const htmlRes = await request(html.url);
    expect(htmlRes.headers.get('content-type')).toBe('application/octet-stream');
    expect(htmlRes.headers.get('content-disposition')).toMatch(/^attachment/);
    const pdf = await (await upload('pub', new TextEncoder().encode('%PDF-1.4'), 'application/pdf; charset=binary', 'owner', 'a"b.pdf')).json();
    const pdfRes = await request(pdf.url);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    expect(pdfRes.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''ab.pdf");
  });

  it('finds upload links in page, task and brief text', () => {
    const refs = uploadReferences({
      projects: { p: { id: 'p', brief: [{ props: { url: '/api/uploads/uBrief' } }] } },
      items: { i: { id: 'i', projectId: 'q', content: [{ props: { url: 'https://done.example/api/uploads/uTask' } }] } },
      docs: { d: { id: 'd', content: [{ props: { url: '/api/uploads/uPage' } }] } },
    });
    expect([...refs.get('uBrief')]).toEqual(['p']);
    expect([...refs.get('uTask')]).toEqual(['q']);
    expect([...refs.get('uPage')]).toEqual(['']);
    expect(cleanMime('Image/PNG; charset=x')).toBe('image/png');
    expect(cleanMime('not a type')).toBe('application/octet-stream');
  });
});

describe('upload messages', () => {
  it('explains a failed upload in a few calm words', () => {
    const ru = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('ru', key, vars);
    expect(MAX_UPLOAD_MB).toBe(100);
    expect(uploadErrorText(new UploadError('too_large', 20), ru)).toBe('Файл слишком большой. Можно до 20 MB');
    expect(uploadErrorText(new UploadError('unsaved'), ru)).toBe('Изменения еще сохраняются. Попробуйте загрузить файл чуть позже');
    expect(uploadErrorText(new Error('Network down'), (key) => translate('en', key))).toBe('Could not upload the file');
  });
});

describe('blob store', () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'done-blobs-test-'));
    dirs.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const database = (data: unknown) => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL)');
    db.prepare('INSERT INTO workspace VALUES(1,?,1)').run(JSON.stringify(data));
    return db;
  };

  it('moves files kept in SQLite onto disk, once, and deletes a row only after its file is written', async () => {
    const db = database({ files: {} });
    db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL)');
    const insert = db.prepare('INSERT INTO blobs VALUES(?,?,?)');
    insert.run('old1', 'application/pdf', Buffer.from('first'));
    insert.run('old2', 'image/png', Buffer.from(PNG));
    insert.run('done', 'text/plain', Buffer.from('stale copy'));
    const dir = tempDir();
    // A file an interrupted run already wrote wins over its row.
    writeFileSync(join(dir, 'done'), 'already moved');
    const store = createBlobStore(db, { dir });
    // Rows not moved yet can still be read.
    expect((await store.read('old1')).buffer.toString()).toBe('first');
    expect(store.migrate()).toEqual({ moved: 3, left: 0 });
    expect(readFileSync(join(dir, 'old1'), 'utf8')).toBe('first');
    expect(readFileSync(join(dir, 'old2'))).toEqual(Buffer.from(PNG));
    expect(readFileSync(join(dir, 'done'), 'utf8')).toBe('already moved');
    expect(store.meta('old2')).toMatchObject({ kind: 'file', mime: 'image/png', size: PNG.length });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='blobs'").get()).toBeUndefined();
    expect(store.migrate()).toEqual({ moved: 0, left: 0 });
    const blob = await store.read('old1');
    expect(blob.size).toBe(5);
    await blob.handle.close();
    store.close();
  });

  it('migrates at server start and serves the moved files', async () => {
    const dir = tempDir();
    const filename = join(dir, 'done.sqlite');
    const db = new DatabaseSync(filename);
    db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL)');
    db.prepare('INSERT INTO blobs VALUES(?,?,?)').run('f1', 'application/pdf', Buffer.from('moved'));
    db.close();
    const started = createAuthApi({ filename });
    try {
      expect(started.filesDir).toBe(join(dir, 'files'));
      expect(readFileSync(join(dir, 'files', 'f1'), 'utf8')).toBe('moved');
    } finally {
      started.close();
    }
    const check = new DatabaseSync(filename);
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name='blobs'").get()).toBeUndefined();
    expect(check.prepare('SELECT mime, size FROM blob_meta WHERE id=?').get('f1')).toEqual({ mime: 'application/pdf', size: 5 });
    check.close();
  });

  it('streams to a temporary file and refuses bad ids and oversized bodies', async () => {
    const store = createBlobStore(database({ files: {} }), { temporary: true });
    expect(await store.write('s1', Readable.from([Buffer.from('ab'), Buffer.from('cd')]), { mime: 'text/plain', limit: 10 })).toBe(4);
    expect(readFileSync(join(store.dir, 's1'), 'utf8')).toBe('abcd');
    await expect(store.write('../s2', Readable.from([Buffer.from('x')]), { mime: 'text/plain', limit: 10 })).rejects.toMatchObject({ status: 400 });
    await expect(store.write('s3', Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), { mime: 'text/plain', limit: 10 })).rejects.toMatchObject({
      status: 413,
    });
    const denied = () => {
      throw Object.assign(new Error('no'), { status: 403 });
    };
    await expect(store.write('s4', Readable.from([Buffer.from('x')]), { mime: 'text/plain', limit: 10, beforeCommit: denied })).rejects.toMatchObject(
      {
        status: 403,
      },
    );
    const gone = new Readable({ read() {} });
    gone.destroy();
    await expect(store.write('s5', gone, { mime: 'text/plain', limit: 10 })).rejects.toMatchObject({ status: 400 });
    expect(existsSync(join(store.dir, 's3'))).toBe(false);
    expect(existsSync(join(store.dir, 's4'))).toBe(false);
    expect(store.meta('s4')).toBeUndefined();
    // No temporary files are left behind.
    expect(readdirSync(store.dir)).toEqual(['s1']);
    store.close();
    expect(existsSync(store.dir)).toBe(false);
  });

  it('collects only old blobs that nothing uses, and only after a day unused', () => {
    const now = Date.parse('2026-09-10T12:00:00Z');
    const files: Record<string, unknown> = { live: file('live') };
    const data = {
      files,
      docs: { d: doc('d', undefined, [{ type: 'image', props: { url: '/api/uploads/uLive' } }]) },
      trash: [
        {
          id: 't',
          kind: 'doc',
          title: 'x',
          deletedAt: ts,
          snapshot: { files: { trashed: file('trashed') }, docs: { g: doc('g', undefined, [{ props: { url: '/api/uploads/uTrash' } }]) } },
        },
      ],
    };
    const db = database(data);
    const store = createBlobStore(db, { temporary: true });
    const old = now - 3 * DAY;
    for (const id of ['live', 'trashed', 'gone', 'fresh']) {
      store.putBuffer(id, Buffer.from(id), { mime: 'text/plain' });
      db.prepare('UPDATE blob_meta SET created_at=? WHERE id=?').run(id === 'fresh' ? now - 3600000 : old, id);
    }
    for (const id of ['uLive', 'uTrash', 'uGone']) {
      store.putBuffer(id, Buffer.from(id), { kind: 'upload', mime: 'image/png', scope: '' });
      db.prepare('UPDATE blob_meta SET created_at=? WHERE id=?').run(old, id);
    }
    // A file on disk without metadata (the server stopped mid-write) and a stale temporary file.
    writeFileSync(join(store.dir, 'stray'), 'x');
    utimesSync(join(store.dir, 'stray'), new Date(old), new Date(old));
    writeFileSync(join(store.dir, '.tmp-left'), 'x');
    utimesSync(join(store.dir, '.tmp-left'), new Date(old), new Date(old));

    expect(store.collectGarbage(now)).toEqual({ deleted: 0, marked: 3 });
    expect(existsSync(join(store.dir, '.tmp-left'))).toBe(false);
    expect(store.collectGarbage(now + DAY / 2)).toEqual({ deleted: 0, marked: 0 });
    const later = now + DAY + 1;
    expect(store.collectGarbage(later)).toEqual({ deleted: 3, marked: 1 });
    for (const id of ['live', 'trashed', 'fresh', 'uLive', 'uTrash']) expect(existsSync(join(store.dir, id))).toBe(true);
    for (const id of ['gone', 'uGone', 'stray']) {
      expect(existsSync(join(store.dir, id))).toBe(false);
      expect(store.meta(id)).toBeUndefined();
    }
    // Used again before its day was over: the mark is dropped.
    files.fresh = file('fresh');
    db.prepare('UPDATE workspace SET data=? WHERE id=1').run(JSON.stringify(data));
    expect(store.collectGarbage(later + 2 * DAY)).toEqual({ deleted: 0, marked: 0 });
    expect(store.meta('fresh').orphaned_at).toBeNull();
    store.close();
  });
});
