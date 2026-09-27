// File storage for the shared workspace: the bytes of uploaded files live on disk,
// one file per blob ("<dir>/<id>"), and SQLite keeps only their metadata. Back up
// the SQLite database and the files directory together.
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Blob ids are file names, so only a safe alphabet is accepted (no dots, no slashes). */
export const BLOB_ID = /^[A-Za-z0-9_-]{1,100}$/;
export const validBlobId = (id) => typeof id === 'string' && BLOB_ID.test(id);
const DAY = 86400000;
const TEMP = '.tmp-';
/** Images the browser may render straight from /api/uploads. Everything else is served as a download. */
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Types that keep their own content type when downloaded, so image, audio, video and PDF blocks keep working. */
const KEEP_TYPE = /^(image\/(png|jpeg|webp|gif|avif|bmp|svg\+xml)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;
const UPLOAD_LINK = /\/api\/uploads\/([A-Za-z0-9_-]{1,100})/g;

const error = (status, message) => Object.assign(new Error(message), { status });

/** A bare "type/subtype" in lower case, or application/octet-stream for anything unexpected. */
export function cleanMime(value) {
  const mime = String(value ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/.test(mime) ? mime : 'application/octet-stream';
}

/** A name to offer when the file is saved: no path, quotes or control characters, at most 200 characters. */
export function cleanFileName(value) {
  const name = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f"\\/]/g, '')
    .trim()
    .slice(0, 200)
    .toWellFormed();
  return name || null;
}

/** Content-Disposition with an RFC 5987 encoded file name. */
export const contentDisposition = (type, name) =>
  name ? `${type}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}` : type;

/** Content type to send for a stored upload: known media keep theirs, the rest is a plain download. */
export const servedMime = (mime) => (KEEP_TYPE.test(cleanMime(mime)) ? cleanMime(mime) : 'application/octet-stream');

/**
 * Where each editor upload is used: upload id → scopes (project ids, '' for workspace pages)
 * of the project briefs, tasks and pages whose text links to it. Someone who can read a page
 * that shows an image can see the image, even after the page moved to another project.
 */
export function uploadReferences(data) {
  const refs = new Map();
  const collect = (value, scope) => {
    if (value === undefined || value === null) return;
    for (const [, id] of JSON.stringify(value).matchAll(UPLOAD_LINK)) {
      if (!refs.has(id)) refs.set(id, new Set());
      refs.get(id).add(scope ?? '');
    }
  };
  for (const project of Object.values(data?.projects ?? {})) collect(project?.brief, project?.id);
  for (const item of Object.values(data?.items ?? {})) collect(item?.content, item?.projectId);
  for (const doc of Object.values(data?.docs ?? {})) collect(doc?.content, doc?.projectId);
  return refs;
}

function fsyncDirectory(dir) {
  // Makes the rename durable. Not every platform can open a directory; the rename is still atomic.
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* unsupported */
  }
}

/**
 * Streams `source` into `out`, stopping at `limit` bytes. Over the limit the rest of the request is
 * left to drain instead of resetting the connection, so the browser still receives the 413 answer.
 */
function receive(source, out, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const cleanup = () => {
      source.off('data', onData);
      source.off('end', onEnd);
      source.off('error', onFail);
      source.off('close', onClose);
      out.off('drain', onDrain);
      out.off('error', onFail);
    };
    const settle = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(size);
    };
    function onData(chunk) {
      size += chunk.length;
      if (size > limit) {
        settle(error(413, 'File is too large'));
        source.resume();
        return;
      }
      if (!out.write(chunk)) source.pause();
    }
    function onDrain() {
      source.resume();
    }
    function onEnd() {
      settle();
    }
    function onFail(err) {
      settle(err?.status ? err : error(400, 'Upload interrupted'));
    }
    function onClose() {
      if (source.complete === false || !source.readableEnded) settle(error(400, 'Upload interrupted'));
    }
    source.on('data', onData);
    source.on('end', onEnd);
    source.on('error', onFail);
    source.on('close', onClose);
    out.on('drain', onDrain);
    out.on('error', onFail);
    // The browser may have gone away while the file was being created.
    if (source.destroyed) onClose();
    else source.resume();
  });
}

/**
 * @param {import('node:sqlite').DatabaseSync} db database with the `workspace` table
 * @param {{ dir?: string, temporary?: boolean }} options `temporary` creates a private directory removed on close
 */
export function createBlobStore(db, { dir, temporary = false } = {}) {
  const root = temporary ? mkdtempSync(join(tmpdir(), 'done-files-')) : dir;
  if (!root) throw new Error('A files directory is required');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // kind: 'file' (a record in workspace.files) or 'upload' (an image or file inside a page); scope: project id, '' for workspace pages.
  db.exec(`CREATE TABLE IF NOT EXISTS blob_meta (id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'file', mime TEXT NOT NULL, size INTEGER NOT NULL,
    created_at INTEGER NOT NULL, scope TEXT, owner TEXT, name TEXT, orphaned_at INTEGER)`);
  const pathOf = (id) => {
    if (!validBlobId(id)) throw error(400, 'Invalid file id');
    return join(root, id);
  };
  const tempPath = () => join(root, `${TEMP}${randomBytes(12).toString('hex')}`);
  const hasLegacyTable = () => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blobs'").get();
  let legacy = hasLegacyTable();
  const saveMeta = (id, { kind = 'file', mime, size, scope = null, owner = null, name = null }, createdAt = Date.now()) =>
    db
      .prepare(
        `INSERT INTO blob_meta(id,kind,mime,size,created_at,scope,owner,name,orphaned_at) VALUES(?,?,?,?,?,?,?,?,NULL)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,mime=excluded.mime,size=excluded.size,created_at=excluded.created_at,
         scope=excluded.scope,owner=excluded.owner,name=excluded.name,orphaned_at=NULL`,
      )
      .run(id, kind, cleanMime(mime), size, Math.round(createdAt), scope, owner, name);
  /**
   * Records a fully written temporary file and moves it into place. Synchronous, so cleanup never sees half of it;
   * the record comes first, so a crash in between never leaves a file whose kind and owner are unknown.
   */
  const commit = (tmp, id, meta) => {
    saveMeta(id, meta);
    renameSync(tmp, pathOf(id));
    fsyncDirectory(root);
  };

  /** Writes bytes that are already in memory (older clients and the migration). */
  function putBuffer(id, buffer, meta) {
    pathOf(id);
    const tmp = tempPath();
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      let offset = 0;
      while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
      fsyncSync(fd);
    } catch (e) {
      closeSync(fd);
      rmSync(tmp, { force: true });
      throw e;
    }
    closeSync(fd);
    commit(tmp, id, { ...meta, size: buffer.length });
  }

  /**
   * Streams a request body to disk. `beforeCommit` runs after the last byte arrived and may throw
   * (for example when the session ended meanwhile); nothing is stored then.
   */
  async function write(id, source, { limit, beforeCommit, ...meta }) {
    pathOf(id);
    const declared = Number(source.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > limit) throw error(413, 'File is too large');
    const tmp = tempPath();
    const out = createWriteStream(tmp, { flags: 'wx', mode: 0o600, flush: true });
    let size;
    try {
      await once(out, 'open');
      size = await receive(source, out, limit);
      out.end();
      await once(out, 'close');
      beforeCommit?.();
    } catch (e) {
      // A write still in flight fails once the stream is destroyed; that is expected and must not crash the server.
      out.on('error', () => {});
      const closed = out.closed ? Promise.resolve() : new Promise((done) => out.once('close', done));
      out.destroy();
      await closed;
      rmSync(tmp, { force: true });
      throw e;
    }
    commit(tmp, id, { ...meta, size });
    return size;
  }

  /** Opens a stored blob for reading, or returns null. Legacy rows not moved yet are read from SQLite. */
  async function read(id) {
    let handle;
    try {
      handle = await open(pathOf(id), 'r');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (handle) {
      // Opened first, so a concurrent cleanup or replacement cannot cut the download short.
      const info = await handle.stat().catch(async (e) => {
        await handle.close();
        throw e;
      });
      if (info.isFile()) return { handle, size: info.size };
      await handle.close();
    }
    if (!legacy) return null;
    const row = db.prepare('SELECT data FROM blobs WHERE id=?').get(id);
    return row ? { buffer: Buffer.from(row.data), size: row.data.length } : null;
  }

  const meta = (id) => (validBlobId(id) ? db.prepare('SELECT * FROM blob_meta WHERE id=?').get(id) : undefined);

  /**
   * Moves file bytes kept in SQLite by earlier versions onto disk. Idempotent: a row is deleted only
   * after its file is written and synced, and a file already on disk (newer or from an interrupted
   * run) is kept.
   */
  function migrate() {
    if (!legacy) return { moved: 0, left: 0 };
    let moved = 0;
    let left = 0;
    for (const { id } of db.prepare('SELECT id FROM blobs').all()) {
      if (!validBlobId(id)) {
        left++;
        continue;
      }
      try {
        const row = db.prepare('SELECT mime, data FROM blobs WHERE id=?').get(id);
        if (!row) continue;
        const onDisk = existsSync(join(root, id));
        if (!onDisk) putBuffer(id, Buffer.from(row.data), { kind: 'file', mime: row.mime });
        else if (!meta(id)) saveMeta(id, { kind: 'file', mime: row.mime, size: statSync(join(root, id)).size });
        db.prepare('DELETE FROM blobs WHERE id=?').run(id);
        moved++;
      } catch (e) {
        left++;
        console.error(`Done: could not move file ${id} out of SQLite:`, e.message);
      }
    }
    if (moved) console.log(`Done: moved ${moved} file(s) from SQLite to ${root}`);
    if (left) console.warn(`Done: ${left} file(s) are still stored in SQLite`);
    if (!left) {
      try {
        db.exec('DROP TABLE blobs');
        legacy = false;
        // Give the space back to the file system once.
        if (moved) db.exec('VACUUM');
      } catch (e) {
        console.error('Done: could not compact the database:', e.message);
      }
    }
    return { moved, left };
  }

  /**
   * Deletes blobs nothing refers to any more. Files count as used while the workspace or a trash
   * entry lists them, editor uploads while any text in the workspace (trash included) links to them.
   * A blob goes only when it is older than a day and has been unused for a whole day, so undo,
   * restore from trash and clients that were offline for a while keep working.
   */
  function collectGarbage(now = Date.now()) {
    const row = db.prepare('SELECT data FROM workspace WHERE id=1').get();
    if (!row) return { deleted: 0, marked: 0 };
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      return { deleted: 0, marked: 0 };
    }
    const files = new Set(Object.keys(data.files ?? {}));
    for (const entry of data.trash ?? []) for (const id of Object.keys(entry?.snapshot?.files ?? {})) files.add(id);
    const used = (m) => (m.kind === 'upload' ? row.data.includes(m.id) : files.has(m.id));
    const known = new Set(
      db
        .prepare('SELECT id FROM blob_meta')
        .all()
        .map((m) => m.id),
    );
    for (const name of readdirSync(root)) {
      const path = join(root, name);
      let info;
      try {
        info = statSync(path);
      } catch {
        continue;
      }
      if (!info.isFile()) continue;
      if (name.startsWith(TEMP)) {
        // Left behind by an interrupted upload.
        if (info.mtimeMs < now - DAY) rmSync(path, { force: true });
        continue;
      }
      // A file without metadata (the server stopped between writing and recording it) is tracked like any other.
      if (validBlobId(name) && !known.has(name))
        saveMeta(name, { kind: 'file', mime: 'application/octet-stream', size: info.size }, Math.min(info.mtimeMs, now));
    }
    let deleted = 0;
    let marked = 0;
    for (const m of db.prepare('SELECT id, kind, created_at, orphaned_at FROM blob_meta').all()) {
      if (used(m)) {
        if (m.orphaned_at !== null) db.prepare('UPDATE blob_meta SET orphaned_at=NULL WHERE id=?').run(m.id);
        continue;
      }
      if (m.created_at > now - DAY) continue;
      if (m.orphaned_at === null) {
        db.prepare('UPDATE blob_meta SET orphaned_at=? WHERE id=?').run(now, m.id);
        marked++;
        continue;
      }
      if (m.orphaned_at > now - DAY) continue;
      rmSync(join(root, m.id), { force: true });
      db.prepare('DELETE FROM blob_meta WHERE id=?').run(m.id);
      deleted++;
    }
    return { deleted, marked };
  }

  return {
    dir: root,
    meta,
    write,
    putBuffer,
    read,
    migrate,
    collectGarbage,
    close() {
      if (temporary) rmSync(root, { recursive: true, force: true });
    },
  };
}
