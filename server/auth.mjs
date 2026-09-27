import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  applyChanges,
  canReadProject,
  canWriteProject,
  deltaIndex,
  isAdmin,
  mergeState,
  normalizeRole,
  projectLevel,
  sharedState,
  validateState,
  visibleDelta,
  visibleState,
} from './access.mjs';
import {
  INLINE_IMAGE_TYPES,
  cleanFileName,
  cleanMime,
  contentDisposition,
  createBlobStore,
  servedMime,
  uploadReferences,
  validBlobId,
} from './blobs.mjs';
import { contentEvents, isContentAction } from './contentAudit.mjs';
import { createMail, inviteEmail, resetEmail, testEmail } from './mail.mjs';
const derive = promisify(scrypt);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const parse = (value, fallback) => {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};
const publicUser = (row) =>
  row && {
    id: row.id,
    name: row.name,
    email: row.email,
    role: normalizeRole(row.role),
    projectIds: row.project_ids === null ? null : parse(row.project_ids, []),
    projectRoles: parse(row.project_roles, {}),
    canCreateProjects: row.can_create_projects === undefined ? true : !!row.can_create_projects,
    disabled: !!row.disabled,
    createdAt: row.created_at,
    lastSeen: row.last_seen ?? null,
  };
const ROLE_INPUT = ['owner', 'admin', 'editor', 'viewer'];
const PERSON_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'yellow', 'red', 'brown'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MB = 1024 * 1024;
/** Same default as MAX_UPLOAD_MB in src/lib/storage.ts. */
const DEFAULT_MAX_UPLOAD_MB = 100;
/** Images and files inserted into pages, tasks and project briefs. */
const EDITOR_UPLOAD_MB = 20;
const CLEANUP_EVERY = 6 * 3600000;
const HOUR = 3600000;
/** Counts requests per key in a fixed window; the map stays bounded under a flood of keys. */
function createLimiter(max, windowMs, cap = 10000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      hits.delete(key);
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (hits.size > cap) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      for (const k of hits.keys()) {
        if (hits.size <= cap) break;
        hits.delete(k);
      }
    }
    return entry.count <= max;
  };
}

export function createAuthApi({
  filename = process.env.DONE_DB_PATH || resolve('.data/done.sqlite'),
  secure = process.env.DONE_SECURE_COOKIES === 'true',
  // Uploaded files live next to the database unless DONE_FILES_DIR says otherwise; an in-memory database gets a temporary directory.
  filesDir = filename === ':memory:' ? undefined : resolve(process.env.DONE_FILES_DIR || resolve(dirname(filename), 'files')),
  maxUploadMb = Number(process.env.DONE_MAX_UPLOAD_MB) > 0 ? Number(process.env.DONE_MAX_UPLOAD_MB) : DEFAULT_MAX_UPLOAD_MB,
  // Email: a transport with sendMail (tests), the public URL for links and the sender; default to the environment.
  mailer,
  publicUrl,
  mailFrom,
} = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, project_ids TEXT, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, project_ids TEXT, expires INTEGER NOT NULL, created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL, created_at INTEGER NOT NULL);`);
  // Columns added after the first release; older databases are upgraded in place.
  const addColumn = (table, name, definition) => {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  addColumn('users', 'project_roles', "TEXT NOT NULL DEFAULT '{}'");
  addColumn('users', 'can_create_projects', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('users', 'last_seen', 'INTEGER');
  addColumn('invites', 'project_roles', "TEXT NOT NULL DEFAULT '{}'");
  addColumn('invites', 'can_create_projects', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('invites', 'created_at', 'INTEGER');
  db.exec("UPDATE users SET role='editor' WHERE role='member'; UPDATE invites SET role='editor' WHERE role='member';");
  // File bytes: on disk, metadata in SQLite. Files kept in the database by earlier versions move to disk once.
  const blobs = createBlobStore(db, filesDir ? { dir: filesDir } : { temporary: true });
  blobs.migrate();
  const maxUpload = Math.floor(maxUploadMb * MB);
  const editorUpload = Math.min(EDITOR_UPLOAD_MB * MB, maxUpload);
  const cleanup = () => {
    try {
      const { deleted } = blobs.collectGarbage();
      if (deleted) console.log(`Done: removed ${deleted} unused file(s)`);
    } catch (e) {
      console.error('Done: file cleanup failed:', e.message);
    }
  };
  const firstCleanup = setTimeout(cleanup, 10000);
  firstCleanup.unref?.();
  const cleanupTimer = setInterval(cleanup, CLEANUP_EVERY);
  cleanupTimer.unref?.();
  // The security log holds access events (sign-ins, invitations, roles) and content events (created, deleted, renamed).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('audit') WHERE name='kind'").get()) {
    db.exec("ALTER TABLE audit ADD COLUMN kind TEXT NOT NULL DEFAULT 'access'; UPDATE audit SET kind='content' WHERE action='project.created';");
  }
  db.exec('CREATE INDEX IF NOT EXISTS audit_kind ON audit(kind, id)');
  const attempts = new Map();
  const mail = createMail({ transport: mailer, publicUrl, from: mailFrom });
  // Password reset: requests per IP and per address, and uses of reset links per IP.
  const resetRequestsByIp = createLimiter(20, 15 * 60000);
  const resetRequestsByEmail = createLimiter(5, 15 * 60000);
  const invitationLookups = createLimiter(40, 15 * 60000);
  const resetLinksByIp = createLimiter(30, 15 * 60000);
  const mailTests = createLimiter(5, 15 * 60000);
  const background = new Set();
  /** Work that must not delay the response or change its timing, such as sending a reset email. */
  const later = (task) => {
    const run = new Promise((resolve) => setImmediate(resolve))
      .then(task)
      .catch((error) => console.error('Done background task failed:', error?.message ?? error))
      .finally(() => background.delete(run));
    background.add(run);
  };
  const audit = (user, action, detail = '') =>
    db
      .prepare('INSERT INTO audit(actor,action,detail,at,kind) VALUES(?,?,?,?,?)')
      .run(user, action, detail, new Date().toISOString(), isContentAction(action) ? 'content' : 'access');
  const AUDIT_PAGE = 100;
  // Renames arrive a few characters at a time; a burst of renames of one record by one person is kept as one entry.
  const RENAME_WINDOW = 5 * 60000;
  const renames = new Map();
  /** Writes the content events of one save. Runs inside the transaction that stores the workspace. */
  const auditContent = (actorId, events) => {
    const now = Date.now();
    if (renames.size > 1000) for (const [key, r] of renames) if (now - r.at > RENAME_WINDOW) renames.delete(key);
    for (const event of events) {
      const previous = event.rename && renames.get(event.target);
      if (previous && previous.actor === actorId && now - previous.at < RENAME_WINDOW) {
        previous.at = now;
        // A page named right after it was created: the creation shows the name.
        if (previous.created) db.prepare('UPDATE audit SET detail=? WHERE id=?').run(`${event.rename.to}${event.rename.suffix}`, previous.id);
        // Renamed back to where it started: nothing changed in the end.
        else if (previous.from === event.rename.to) {
          db.prepare('DELETE FROM audit WHERE id=?').run(previous.id);
          renames.delete(event.target);
        } else db.prepare('UPDATE audit SET detail=? WHERE id=?').run(`${previous.from} → ${event.rename.to}${event.rename.suffix}`, previous.id);
        continue;
      }
      const row = audit(actorId, event.action, event.detail);
      const id = Number(row.lastInsertRowid);
      if (event.rename) renames.set(event.target, { id, actor: actorId, from: event.rename.from, at: now });
      else if (/^(project|doc)\.created$/.test(event.action)) renames.set(event.target, { id, actor: actorId, created: true, at: now });
      else if (event.target) renames.delete(event.target);
    }
  };
  // Live updates: every signed-in tab keeps one Server-Sent Events stream open.
  const streams = new Set();
  const presence = new Map();
  const emitRaw = (stream, event, json) => {
    try {
      stream.res.write(`event: ${event}\ndata: ${json}\n\n`);
    } catch {
      /* the socket is closing */
    }
  };
  const emit = (stream, event, data) => emitRaw(stream, event, JSON.stringify(data));
  /** Largest live update sent to one tab; bigger changes make it reload the workspace instead. */
  const DELTA_LIMIT = 512 * 1024;
  // Which project a task or page belongs to, rebuilt only when the workspace revision changes.
  let pathIndex = { revision: -1, items: new Map(), docs: new Map() };
  const currentPathIndex = () => {
    const row = db.prepare('SELECT revision FROM workspace WHERE id=1').get();
    if (row && row.revision !== pathIndex.revision) {
      const data = readWorkspace().data;
      pathIndex = {
        revision: row.revision,
        items: new Map(Object.values(data.items ?? {}).map((i) => [i.id, i.projectId])),
        docs: new Map(Object.values(data.docs ?? {}).map((d) => [d.id, d.projectId])),
      };
    }
    return pathIndex;
  };
  const projectOfPath = (path, index) => {
    const [, section, id] = /^\/(p|items|docs)\/([^/?#]+)/.exec(path) ?? [];
    if (!section) return { scoped: false };
    if (section === 'p') return { scoped: true, projectId: id };
    const map = section === 'items' ? index.items : index.docs;
    return { scoped: true, projectId: map.get(id), missing: !map.has(id) };
  };
  const broadcastPresence = () => {
    if (!streams.size) return;
    const index = currentPathIndex();
    const online = new Map();
    for (const stream of streams) online.set(stream.user.id, stream.user);
    const peers = [...online.values()].map((peer) => {
      const entry = presence.get(peer.id);
      const path = entry?.path ?? '';
      return { id: peer.id, name: peer.name, path, at: entry?.at ?? 0, ...projectOfPath(path, index) };
    });
    // Each member only learns where teammates are when they can see that place too.
    for (const stream of streams) {
      const viewer = stream.user;
      emit(stream, 'presence', {
        peers: peers.map(({ scoped, projectId, missing, ...peer }) => ({
          ...peer,
          path: !scoped || (!missing && canReadProject(viewer, projectId)) ? peer.path : '',
        })),
      });
    }
  };
  /**
   * Tells every open tab about a new revision. With `write` ({ prev, next, changed }) each tab also receives
   * `delta`: only the changes its member may see, so it can update without downloading the whole workspace.
   * A delta that is too large or cannot be built is left out and that tab reloads instead.
   */
  const broadcastRevision = (revision, actorId, tab, write) => {
    if (!streams.size) return;
    const head = { revision, baseRevision: revision - 1, actorId, tab };
    const plain = JSON.stringify(head);
    // Access may have changed since a stream was opened: always use the current role and projects.
    const members = write
      ? new Map(
          db
            .prepare('SELECT * FROM users')
            .all()
            .map((row) => [row.id, publicUser(row)]),
        )
      : null;
    let index;
    const payloads = new Map();
    const payloadFor = (stream) => {
      const user = members?.get(stream.user.id);
      if (!user || user.disabled) return plain;
      stream.user = user;
      if (!payloads.has(user.id)) {
        let payload = plain;
        try {
          index ??= deltaIndex(write.prev, write.next);
          const json = JSON.stringify({ ...head, delta: visibleDelta(write.prev, write.next, user, write.changed, index) });
          if (Buffer.byteLength(json) <= DELTA_LIMIT) payload = json;
        } catch (error) {
          console.error('Done live update error:', error.message);
        }
        payloads.set(user.id, payload);
      }
      return payloads.get(user.id);
    };
    for (const stream of streams) emitRaw(stream, 'revision', payloadFor(stream));
  };
  const closeStreams = (userId) => {
    for (const stream of [...streams]) if (stream.user.id === userId) stream.res.end();
  };
  const heartbeat = setInterval(() => {
    for (const stream of streams) {
      try {
        stream.res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }
    // Drop locations nobody refreshed for a while (tab in background, laptop asleep).
    const stale = Date.now() - 120000;
    for (const [id, entry] of presence) if (entry.at < stale) presence.delete(id);
  }, 25000);
  heartbeat.unref?.();
  const readWorkspace = () => {
    const row = db.prepare('SELECT * FROM workspace WHERE id=1').get();
    return row ? { data: JSON.parse(row.data), revision: row.revision } : null;
  };
  const cookie = (token, age) => `done_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const sessionToken = (req) => /(?:^|;\s*)done_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const seen = new Map();
  const authenticate = (req) => {
    const token = sessionToken(req);
    if (!token) return null;
    const user = publicUser(
      db
        .prepare(
          'SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>? AND users.disabled=0',
        )
        .get(hash(token), Date.now()),
    );
    // "Last active" for the people list, written at most once a minute per member.
    if (user && Date.now() - (seen.get(user.id) ?? 0) > 60000) {
      seen.set(user.id, Date.now());
      db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(Date.now(), user.id);
    }
    return user;
  };
  const startSession = (user, res) => {
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', cookie(token, 7 * 86400));
  };
  async function body(req, limit = 10 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) fail(413, 'Request too large');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString() || '{}');
    } catch {
      fail(400, 'Invalid JSON');
    }
  }
  const send = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  /** File uploads whose body is the file itself rather than JSON. They keep the header and origin checks. */
  const rawUpload = (req, path) =>
    (req.method === 'PUT' && path.startsWith('/api/blobs/') && /^application\/octet-stream\s*(;|$)/i.test(req.headers['content-type'] ?? '')) ||
    (req.method === 'POST' && path === '/api/uploads');
  const blobIdOf = (path, prefix) => {
    let id = '';
    try {
      id = decodeURIComponent(path.slice(prefix.length));
    } catch {
      /* rejected below */
    }
    if (!validBlobId(id)) fail(400, 'Invalid file id');
    return id;
  };
  /** A percent-encoded header value (file names are not limited to ASCII), or null. */
  const headerText = (value) => {
    try {
      return typeof value === 'string' ? decodeURIComponent(value) : null;
    } catch {
      return null;
    }
  };
  const tooLarge = (res, limit) => send(res, 413, { error: 'File is too large', maxMb: Math.floor(limit / MB) });
  /** Streams a stored file with its length; a HEAD request gets the headers only. */
  async function sendBlob(req, res, id, headers) {
    const blob = await blobs.read(id);
    if (!blob) fail(404, 'File not found');
    res.writeHead(200, { ...headers, 'content-length': String(blob.size) });
    if (req.method === 'HEAD' || blob.buffer) {
      await blob.handle?.close();
      res.end(req.method === 'HEAD' ? undefined : blob.buffer);
      return true;
    }
    try {
      await pipeline(blob.handle.createReadStream(), res);
    } catch {
      // The browser went away in the middle of the download.
      res.destroy();
    }
    return true;
  }
  // Projects, and which pages link to each editor upload, rebuilt only when the workspace revision changes.
  let uploadIndex = { revision: -1, projects: new Set(), refs: new Map() };
  const currentUploadIndex = () => {
    const row = db.prepare('SELECT revision FROM workspace WHERE id=1').get();
    if (row && row.revision !== uploadIndex.revision) {
      const data = readWorkspace().data;
      uploadIndex = { revision: row.revision, projects: new Set(Object.keys(data.projects ?? {})), refs: uploadReferences(data) };
    }
    return uploadIndex;
  };
  /** An upload is visible to whoever can read the project it was added in, or a page, task or brief that shows it. */
  const canReadUpload = (user, meta) => {
    const index = currentUploadIndex();
    const readable = (scope) => (scope ? index.projects.has(scope) && canReadProject(user, scope) : canReadProject(user, undefined));
    return readable(meta.scope ?? '') || [...(index.refs.get(meta.id) ?? [])].some(readable);
  };
  // Projects deleted since access was given are dropped instead of failing the whole change.
  const projectsInput = (value) => {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) fail(400, 'Invalid project access');
    const projects = readWorkspace()?.data.projects ?? {};
    return JSON.stringify([...new Set(value)].filter((id) => projects[id]));
  };
  const LEVEL_INPUT = ['viewer', 'commenter', 'editor'];
  const levelsInput = (value) => {
    if (value === null || value === undefined) return '{}';
    if (typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid project access');
    const projects = readWorkspace()?.data.projects ?? {};
    const out = {};
    for (const [id, level] of Object.entries(value)) {
      if (!LEVEL_INPUT.includes(level)) fail(400, 'Invalid project access');
      if (projects[id]) out[id] = level;
    }
    return JSON.stringify(out);
  };
  /** Who may give a role: owners give any role, administrators only editor and viewer. */
  const canAssignRole = (actor, role) => ROLE_INPUT.includes(role) && (actor.role === 'owner' || ['editor', 'viewer'].includes(role));
  /** Who may manage an account: owners manage everyone but themselves, administrators manage editors and viewers. */
  const canManage = (actor, target) =>
    target.id !== actor.id && (actor.role === 'owner' || (actor.role === 'admin' && ['editor', 'viewer'].includes(target.role)));
  const activeOwners = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND disabled=0").get().n;
  const langOf = (input) => (input?.lang === 'en' ? 'en' : 'ru');
  /** The name people see in the workspace (it can change after registration). */
  const displayName = (row) => readWorkspace()?.data.people?.[row.id]?.name || row.name;
  const inviteLink = (token, email) => mail.link(`invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`);
  /** A one-time link to set a new password. Only its hash is stored, and older links of the person stop working. */
  const createResetToken = (userId, lifetime) => {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires<?').run(userId, now);
    db.prepare('INSERT INTO password_resets(token_hash,user_id,expires,created_at) VALUES(?,?,?,?)').run(hash(token), userId, now + lifetime, now);
    return { token, expires: now + lifetime, url: mail.link(`reset=${token}`) };
  };
  /** The active account a reset link belongs to, or undefined when the link is unknown, used or expired. */
  const findReset = (token) =>
    typeof token === 'string' && token.length > 0 && token.length <= 128
      ? db
          .prepare(
            'SELECT users.* FROM password_resets JOIN users ON users.id=password_resets.user_id WHERE password_resets.token_hash=? AND password_resets.expires>? AND users.disabled=0',
          )
          .get(hash(token), Date.now())
      : undefined;
  /** Tells a member's open tabs to reload their access right away. */
  const notifyAccess = (userId) => {
    const fresh = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
    for (const stream of streams) {
      if (stream.user.id !== userId) continue;
      if (fresh) stream.user = fresh;
      emit(stream, 'access', { at: Date.now() });
    }
  };
  async function authenticatedBody(req, limit) {
    const input = await body(req, limit);
    if (!authenticate(req)) fail(401, 'Sign in to continue');
    return input;
  }
  async function handler(req, res, next) {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (
      !path.startsWith('/api/auth/') &&
      !path.startsWith('/api/admin/') &&
      !path.startsWith('/api/projects/') &&
      !['/api/workspace', '/api/events', '/api/presence', '/api/members', '/api/uploads'].includes(path) &&
      !path.startsWith('/api/blobs/') &&
      !path.startsWith('/api/uploads/')
    ) {
      next?.();
      return false;
    }
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.origin;
        const allowedOrigin = process.env.DONE_ORIGIN;
        if (
          req.headers['x-done-client'] !== 'web' ||
          req.headers['sec-fetch-site'] === 'cross-site' ||
          (origin && (allowedOrigin ? origin !== allowedOrigin : new URL(origin).host !== req.headers.host))
        )
          fail(403, 'Invalid request origin');
        if (!req.headers['content-type']?.startsWith('application/json') && !rawUpload(req, path)) fail(415, 'JSON required');
      }
      let user = authenticate(req);
      if (path === '/api/auth/session' && req.method === 'GET')
        return send(res, 200, { user, setup: !db.prepare('SELECT id FROM users LIMIT 1').get(), mail: mail.configured });
      // A token proves possession of the invitation; email query parameters are never trusted.
      if (path === '/api/auth/invitation' && req.method === 'POST') {
        if (!invitationLookups(`${req.socket.remoteAddress}`)) fail(429, 'Too many attempts. Try again in 15 minutes.');
        const input = await body(req, 4096);
        if (typeof input.token !== 'string' || input.token.length > 256) fail(410, 'This invitation is invalid or has expired');
        const invitation = db
          .prepare(
            'SELECT invites.*, users.name AS inviter FROM invites LEFT JOIN users ON users.id=invites.created_by WHERE invites.token=? AND invites.expires>?',
          )
          .get(hash(input.token), Date.now());
        if (!invitation || db.prepare('SELECT id FROM users WHERE email=?').get(invitation.email))
          fail(410, 'This invitation is invalid or has expired');
        return send(res, 200, {
          email: invitation.email,
          workspace: readWorkspace()?.data.workspace?.name || 'Done',
          inviter: invitation.inviter,
          role: normalizeRole(invitation.role),
          expires: invitation.expires,
        });
      }
      if (['/api/auth/register', '/api/auth/login'].includes(path) && req.method === 'POST') {
        const input = await body(req);
        const email = String(input.email ?? '')
          .trim()
          .toLowerCase();
        const key = `${req.socket.remoteAddress}`;
        const limit = attempts.get(key);
        if (limit && limit.reset > Date.now() && limit.count >= 15) fail(429, 'Too many attempts. Try again in 15 minutes.');
        if (!limit || limit.reset <= Date.now()) attempts.set(key, { count: 1, reset: Date.now() + 900000 });
        else limit.count++;
        if (attempts.size > 10000) for (const [k, v] of attempts) if (v.reset < Date.now()) attempts.delete(k);
        const password = typeof input.password === 'string' ? input.password : '';
        if (password.length > 256 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, 'Enter a valid email and password');
        if (path.endsWith('/login')) {
          const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
          const [salt, expected] = (row?.password ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
          const actual = await derive(password, salt, 64);
          if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !row || row.disabled) fail(401, 'Incorrect email or password');
          const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
          if (fresh.disabled || fresh.password !== row.password) fail(401, 'Incorrect email or password');
          user = publicUser(fresh);
          audit(user.id, 'account.login');
        } else {
          if (password.length < 12) fail(400, 'Use at least 12 characters for the password');
          const name = String(input.name ?? '')
            .trim()
            .slice(0, 100);
          if (!name) fail(400, 'Enter your name');
          const salt = randomBytes(16).toString('hex');
          const encoded = `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
          // Recheck setup/invite after asynchronous password hashing to prevent concurrent owner creation.
          const setup = !db.prepare('SELECT id FROM users LIMIT 1').get();
          const invite = input.invite
            ? db.prepare('SELECT * FROM invites WHERE token=? AND email=? AND expires>?').get(hash(String(input.invite)), email, Date.now())
            : null;
          if (!setup && !invite) fail(403, 'An invitation is required');
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Account already exists');
          const id = randomUUID();
          const current = setup ? null : readWorkspace();
          // A copy, so the live update can tell teammates what changed.
          let data = setup ? sharedState(input.data) : { ...current.data, people: { ...current.data.people } };
          validateState(data);
          const color = PERSON_COLORS[Object.keys(data.people).length % PERSON_COLORS.length];
          data.people[id] = { id, name, email, color: setup ? 'blue' : color };
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare(
              'INSERT INTO users(id,email,name,password,role,project_ids,project_roles,can_create_projects,disabled,created_at) VALUES(?,?,?,?,?,?,?,?,0,?)',
            ).run(
              id,
              email,
              name,
              encoded,
              setup ? 'owner' : normalizeRole(invite.role),
              setup ? null : invite.project_ids,
              setup ? '{}' : (invite.project_roles ?? '{}'),
              setup ? 1 : (invite.can_create_projects ?? 1),
              new Date().toISOString(),
            );
            if (setup) db.prepare('INSERT INTO workspace VALUES(1,?,1)').run(JSON.stringify(data));
            else db.prepare('UPDATE workspace SET data=?,revision=revision+1 WHERE id=1').run(JSON.stringify(data));
            if (invite) db.prepare('DELETE FROM invites WHERE token=?').run(invite.token);
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
          user = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
          audit(id, 'account.created', email);
          if (!setup)
            broadcastRevision(current.revision + 1, id, undefined, { prev: current.data, next: data, changed: { records: { people: [id] } } });
        }
        startSession(user, res);
        return send(res, 200, { user });
      }
      if (path === '/api/auth/reset/request' && req.method === 'POST') {
        // Always the same answer, right away, so nobody can find out which addresses have accounts.
        const input = await body(req, 4096);
        if (!resetRequestsByIp(`${req.socket.remoteAddress}`)) fail(429, 'Too many attempts. Try again in 15 minutes.');
        const email = String(input.email ?? '')
          .trim()
          .toLowerCase();
        if (!EMAIL.test(email) || email.length > 254) fail(400, 'Enter a valid email');
        const lang = langOf(input);
        // Past the limit for an address nothing more is sent, but the answer stays the same.
        if (resetRequestsByEmail(email) && mail.configured)
          later(async () => {
            const row = db.prepare('SELECT * FROM users WHERE email=? AND disabled=0').get(email);
            if (!row) return;
            const { url } = createResetToken(row.id, HOUR);
            audit(row.id, 'password.reset.requested', email);
            await mail.send({ to: email, ...resetEmail({ lang, name: displayName(row), email, link: url, hours: 1 }) });
          });
        return send(res, 200, { ok: true });
      }
      if (path === '/api/auth/reset/check' && req.method === 'POST') {
        const input = await body(req, 4096);
        if (!resetLinksByIp(`${req.socket.remoteAddress}`)) fail(429, 'Too many attempts. Try again in 15 minutes.');
        const row = findReset(input.token);
        if (!row) fail(410, 'This link is invalid or has expired');
        return send(res, 200, { email: row.email, name: displayName(row) });
      }
      if (path === '/api/auth/reset' && req.method === 'POST') {
        const input = await body(req, 4096);
        if (!resetLinksByIp(`${req.socket.remoteAddress}`)) fail(429, 'Too many attempts. Try again in 15 minutes.');
        const password = typeof input.password === 'string' ? input.password : '';
        if (password.length < 12 || password.length > 256) fail(400, 'Use 12–256 characters for the password');
        const row = findReset(input.token);
        if (!row) fail(410, 'This link is invalid or has expired');
        const salt = randomBytes(16).toString('hex');
        const encoded = `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
        db.exec('BEGIN IMMEDIATE');
        try {
          // The link is used up here, so a second request with it at the same time finds nothing.
          const used = db.prepare('DELETE FROM password_resets WHERE token_hash=? AND expires>?').run(hash(input.token), Date.now());
          const active = db.prepare('SELECT id FROM users WHERE id=? AND disabled=0').get(row.id);
          if (!used.changes || !active) fail(410, 'This link is invalid or has expired');
          db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, row.id);
          // Everyone signed in with the old password is signed out, and other reset links stop working.
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
          db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.id);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        closeStreams(row.id);
        // This browser may still hold another session; the new one replaces it.
        const previous = sessionToken(req);
        if (previous) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(previous));
        audit(row.id, 'password.reset');
        user = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(row.id));
        startSession(user, res);
        return send(res, 200, { user });
      }
      if (!user) fail(401, 'Sign in to continue');
      if (path === '/api/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(hash(sessionToken(req) || ''));
        res.setHeader('Set-Cookie', cookie('', 0));
        closeStreams(user.id);
        return send(res, 200, { ok: true });
      }
      if (path === '/api/auth/password' && req.method === 'POST') {
        const input = await authenticatedBody(req);
        const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        const [salt, encoded] = row.password.split(':');
        if (
          typeof input.current !== 'string' ||
          input.current.length > 256 ||
          !timingSafeEqual(await derive(input.current, salt, 64), Buffer.from(encoded, 'hex'))
        )
          fail(401, 'Current password is incorrect');
        if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 256) fail(400, 'Use 12–256 characters');
        const newSalt = randomBytes(16).toString('hex');
        db.prepare('UPDATE users SET password=? WHERE id=?').run(
          `${newSalt}:${(await derive(input.password, newSalt, 64)).toString('hex')}`,
          user.id,
        );
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
        startSession(user, res);
        audit(user.id, 'password.changed');
        return send(res, 200, { ok: true });
      }
      if (path === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        const stream = { res, user };
        streams.add(stream);
        emit(stream, 'revision', { revision: readWorkspace()?.revision ?? 0 });
        broadcastPresence();
        req.on('close', () => {
          streams.delete(stream);
          if (![...streams].some((s) => s.user.id === user.id)) presence.delete(user.id);
          broadcastPresence();
        });
        return true;
      }
      if (path === '/api/members' && req.method === 'GET') {
        // The directory every member sees: who is in the workspace and their role, without project access.
        const rows = db.prepare('SELECT * FROM users WHERE disabled=0 ORDER BY created_at').all().map(publicUser);
        return send(res, 200, {
          members: rows.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, lastSeen: m.lastSeen, createdAt: m.createdAt })),
        });
      }
      if (path === '/api/presence' && req.method === 'POST') {
        const input = await authenticatedBody(req, 4096);
        const location = typeof input.path === 'string' && input.path.startsWith('/') ? input.path.slice(0, 200) : '';
        const previous = presence.get(user.id);
        presence.set(user.id, { path: location, at: Date.now() });
        if (previous?.path !== location) broadcastPresence();
        return send(res, 200, { ok: true });
      }
      if (path === '/api/workspace') {
        if (req.method === 'PUT' && normalizeRole(user.role) === 'viewer') fail(403, 'Read-only access');
        let workspace = readWorkspace();
        if (req.method === 'GET') return send(res, 200, { data: visibleState(workspace.data, user), revision: workspace.revision, user });
        if (req.method === 'PUT' || req.method === 'PATCH') {
          const input = await authenticatedBody(req);
          workspace = readWorkspace();
          let merged;
          const info = {};
          if (req.method === 'PUT') {
            // Full snapshots can only be saved on top of the revision they were loaded from.
            if (input.revision !== workspace.revision) fail(409, 'Workspace changed. Reload before saving.');
            merged = mergeState(workspace.data, sharedState(input.data), user, info);
          } else {
            // Change sets merge field by field, so concurrent edits by teammates are kept.
            merged = applyChanges(workspace.data, input.changes, user, info);
          }
          // Someone limited to some projects keeps access to the projects they create.
          const grantCreated = info.createdProjects?.size && user.projectIds !== null && !isAdmin(user);
          let events = [];
          try {
            events = contentEvents(workspace.data, merged, info.changed, user.id);
          } catch (error) {
            // The log must never cost anyone their work.
            console.error('Done audit error:', error.message);
          }
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('UPDATE workspace SET data=?,revision=revision+1 WHERE id=1').run(JSON.stringify(merged));
            if (grantCreated) {
              const ids = [...new Set([...user.projectIds, ...info.createdProjects])];
              db.prepare('UPDATE users SET project_ids=? WHERE id=?').run(JSON.stringify(ids), user.id);
            }
            auditContent(user.id, events);
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
          const revision = workspace.revision + 1;
          const tab = typeof req.headers['x-done-tab'] === 'string' ? req.headers['x-done-tab'].slice(0, 64) : undefined;
          broadcastRevision(revision, user.id, tab, info.changed && { prev: workspace.data, next: merged, changed: info.changed });
          // Their open tabs learn about the new project access.
          if (grantCreated) notifyAccess(user.id);
          return send(res, 200, { revision });
        }
      }
      if (path.startsWith('/api/projects/') && path.endsWith('/access')) {
        const projectId = decodeURIComponent(path.split('/')[3] ?? '');
        const project = readWorkspace()?.data.projects[projectId];
        if (!project || !canReadProject(user, projectId)) fail(404, 'Project not found');
        const rows = db.prepare('SELECT * FROM users WHERE disabled=0 ORDER BY created_at').all().map(publicUser);
        const listAccess = () =>
          rows
            .map((m) => ({ id: m.id, name: m.name, role: m.role, level: projectLevel(m, projectId), allProjects: m.projectIds === null }))
            .filter((m) => m.level);
        if (req.method === 'GET') return send(res, 200, { members: listAccess() });
        if (req.method === 'PUT') {
          if (!isAdmin(user)) fail(403, 'Administrator access required');
          const input = await authenticatedBody(req);
          const target = rows.find((m) => m.id === input.userId);
          if (!target) fail(404, 'Member not found');
          if (isAdmin(target)) fail(400, 'Administrators have access to every project');
          if (!canManage(user, target)) fail(403, 'Cannot change this account');
          const level = input.level ?? null;
          if (level !== null && !LEVEL_INPUT.includes(level)) fail(400, 'Invalid access level');
          if (level === 'editor' && target.role === 'viewer') fail(400, 'Viewers cannot edit');
          const roles = { ...target.projectRoles };
          let ids = target.projectIds;
          if (level === null) {
            if (ids === null) fail(400, 'This member has access to all projects');
            ids = ids.filter((id) => id !== projectId);
            delete roles[projectId];
          } else {
            if (ids !== null && !ids.includes(projectId)) ids = [...ids, projectId];
            if (level === (target.role === 'viewer' ? 'viewer' : 'editor')) delete roles[projectId];
            else roles[projectId] = level;
          }
          db.prepare('UPDATE users SET project_ids=?,project_roles=? WHERE id=?').run(
            ids === null ? null : JSON.stringify(ids),
            JSON.stringify(roles),
            target.id,
          );
          audit(user.id, 'project.access', `${target.email} · ${project.name} · ${level ?? 'removed'}`);
          notifyAccess(target.id);
          const refreshed = db.prepare('SELECT * FROM users WHERE id=?').get(target.id);
          rows.splice(rows.indexOf(target), 1, publicUser(refreshed));
          return send(res, 200, { members: listAccess() });
        }
      }
      if (path.startsWith('/api/blobs/')) {
        const id = blobIdOf(path, '/api/blobs/');
        const files = readWorkspace().data.files;
        const file = Object.hasOwn(files, id) ? files[id] : undefined;
        if (!file || !canReadProject(user, file.projectId)) fail(404, 'File not found');
        if (req.method === 'GET' || req.method === 'HEAD') {
          // Editor uploads are only served by /api/uploads, with their own access rules.
          if (blobs.meta(id)?.kind === 'upload') fail(404, 'File not found');
          return await sendBlob(req, res, id, {
            'content-type': cleanMime(file.mime),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'content-disposition': 'attachment',
            'content-security-policy': "default-src 'none'; sandbox",
          });
        }
        if (req.method === 'PUT') {
          if (!canWriteProject(user, file.projectId)) fail(403, 'Read-only access');
          if (blobs.meta(id)?.kind === 'upload') fail(409, 'This file id is taken');
          const meta = { kind: 'file', mime: file.mime || 'application/octet-stream', scope: file.projectId ?? '', owner: user.id };
          // The session and the file record must still be there once the last byte has arrived.
          const stillAllowed = () => {
            const current = authenticate(req);
            if (!current) fail(401, 'Sign in to continue');
            const latest = readWorkspace().data.files;
            if (!Object.hasOwn(latest, id) || !canWriteProject(current, latest[id].projectId)) fail(403, 'Read-only access');
          };
          try {
            if (rawUpload(req, path)) await blobs.write(id, req, { ...meta, limit: maxUpload, beforeCommit: stillAllowed });
            else {
              // Browsers opened before the update still send base64 inside JSON.
              const input = await authenticatedBody(req, 30 * MB);
              if (typeof input.base64 !== 'string') fail(400, 'Invalid file');
              const bytes = Buffer.from(input.base64, 'base64');
              if (bytes.length > maxUpload) fail(413, 'File is too large');
              stillAllowed();
              blobs.putBuffer(id, bytes, meta);
            }
          } catch (e) {
            if (e.status === 413) return tooLarge(res, maxUpload);
            throw e;
          }
          return send(res, 200, { ok: true });
        }
      }
      // Images and files inserted into a page, task or project brief (the editor's uploads).
      if (path === '/api/uploads' && req.method === 'POST') {
        // scope: the project of the page, task or brief being edited, or "workspace" for pages outside projects.
        const scope = new URL(req.url || '/', 'http://localhost').searchParams.get('scope');
        if (!scope) fail(400, 'Choose where the file belongs');
        const projectId = scope === 'workspace' ? undefined : scope;
        if (projectId !== undefined && (!currentUploadIndex().projects.has(projectId) || !canReadProject(user, projectId)))
          fail(404, 'Project not found');
        if (!canWriteProject(user, projectId)) fail(403, 'Read-only access');
        let id;
        do id = `u${randomBytes(18).toString('base64url')}`;
        while (blobs.meta(id));
        try {
          await blobs.write(id, req, {
            kind: 'upload',
            mime: req.headers['content-type'],
            scope: projectId ?? '',
            owner: user.id,
            name: cleanFileName(headerText(req.headers['x-done-file-name'])),
            limit: editorUpload,
            beforeCommit: () => {
              const current = authenticate(req);
              if (!current || !canWriteProject(current, projectId)) fail(403, 'Read-only access');
            },
          });
        } catch (e) {
          if (e.status === 413) return tooLarge(res, editorUpload);
          throw e;
        }
        return send(res, 201, { id, url: `/api/uploads/${id}` });
      }
      if (path.startsWith('/api/uploads/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const id = blobIdOf(path, '/api/uploads/');
        const meta = blobs.meta(id);
        if (!meta || meta.kind !== 'upload' || !canReadUpload(user, meta)) fail(404, 'File not found');
        const inline = INLINE_IMAGE_TYPES.includes(meta.mime);
        const headers = {
          // Only plain raster images are shown in place; SVG, HTML and everything else is a download.
          'content-type': inline ? meta.mime : servedMime(meta.mime),
          'content-disposition': contentDisposition(inline ? 'inline' : 'attachment', meta.name),
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
          'cross-origin-resource-policy': 'same-origin',
          // Uploads never change, so the browser revalidates cheaply; access is checked every time.
          'cache-control': 'private, no-cache',
          etag: `"${id}"`,
        };
        if (req.headers['if-none-match'] === headers.etag) {
          res.writeHead(304, { etag: headers.etag, 'cache-control': headers['cache-control'] });
          res.end();
          return true;
        }
        return await sendBlob(req, res, id, headers);
      }
      if (path.startsWith('/api/admin/')) {
        if (!isAdmin(user)) fail(403, 'Administrator access required');
        if (path === '/api/admin/members' && req.method === 'GET')
          return send(res, 200, {
            mail: { configured: mail.configured, ...(mail.configured ? { from: mail.from } : {}) },
            members: db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser),
            invites: db
              .prepare(
                'SELECT invites.email,invites.role,invites.project_ids,invites.project_roles,invites.can_create_projects,invites.expires,invites.created_at,users.name AS invited_by FROM invites LEFT JOIN users ON users.id=invites.created_by WHERE invites.expires>? ORDER BY invites.created_at DESC',
              )
              .all(Date.now())
              .map((i) => ({
                email: i.email,
                role: normalizeRole(i.role),
                projectIds: i.project_ids === null ? null : parse(i.project_ids, []),
                projectRoles: parse(i.project_roles, {}),
                canCreateProjects: !!i.can_create_projects,
                expires: i.expires,
                createdAt: i.created_at,
                invitedBy: i.invited_by,
              })),
          });
        if (path === '/api/admin/audit' && req.method === 'GET') {
          // Newest first, a page at a time: ?before=<id> continues after the last entry shown, ?kind=access|content filters.
          const query = new URL(req.url || '/', 'http://localhost').searchParams;
          const before = query.has('before') ? Number(query.get('before')) : null;
          const kind = query.get('kind');
          if (before !== null && !(Number.isSafeInteger(before) && before > 0)) fail(400, 'Invalid page');
          if (kind !== null && !['access', 'content'].includes(kind)) fail(400, 'Invalid filter');
          const where = [...(before !== null ? ['audit.id<?'] : []), ...(kind !== null ? ['audit.kind=?'] : [])];
          const rows = db
            .prepare(
              `SELECT audit.id,audit.actor,audit.action,audit.detail,audit.at,audit.kind,users.name FROM audit LEFT JOIN users ON users.id=audit.actor${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY audit.id DESC LIMIT ?`,
            )
            .all(...(before !== null ? [before] : []), ...(kind !== null ? [kind] : []), AUDIT_PAGE + 1);
          return send(res, 200, { events: rows.slice(0, AUDIT_PAGE), more: rows.length > AUDIT_PAGE });
        }
        if (path === '/api/admin/invites' && req.method === 'POST') {
          const input = await authenticatedBody(req);
          const role = normalizeRole(input.role);
          if (!canAssignRole(user, role)) fail(403, 'Invalid role');
          // One or many addresses: "a@x.com, b@x.com" or an array.
          const raw = Array.isArray(input.emails) ? input.emails : String(input.emails ?? input.email ?? '').split(/[\s,;]+/);
          const emails = [...new Set(raw.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
          if (!emails.length) fail(400, 'Enter a valid email');
          if (emails.length > 50) fail(400, 'Invite at most 50 people at once');
          const invalid = emails.filter((e) => !EMAIL.test(e) || e.length > 254);
          if (invalid.length) fail(400, `Enter a valid email: ${invalid.join(', ')}`);
          const admin = role === 'owner' || role === 'admin';
          const projectIds = admin ? null : projectsInput(input.projectIds);
          const projectRoles = admin ? '{}' : levelsInput(input.projectRoles);
          const canCreate = role === 'viewer' ? 0 : Number(input.canCreateProjects !== false);
          const invites = [];
          const skipped = [];
          const expires = Date.now() + 7 * 86400000;
          for (const email of emails) {
            if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
              skipped.push({ email, reason: 'exists' });
              continue;
            }
            const token = randomBytes(32).toString('base64url');
            db.prepare('DELETE FROM invites WHERE email=?').run(email);
            db.prepare(
              'INSERT INTO invites(token,email,role,project_ids,project_roles,can_create_projects,expires,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
            ).run(hash(token), email, role, projectIds, projectRoles, canCreate, expires, user.id, Date.now());
            audit(user.id, 'invite.created', `${email} · ${role}`);
            invites.push({ email, token, url: inviteLink(token, email) });
          }
          if (!invites.length && skipped.length) fail(409, 'Account already exists');
          // With email set up every address gets a letter; the links stay in the answer as a fallback.
          let delivery = { sent: [], failed: [] };
          if (mail.configured && invites.length) {
            const lang = langOf(input);
            const workspace = readWorkspace()?.data.workspace?.name;
            const inviter = displayName(user);
            delivery = await mail.sendAll(
              invites.map((i) => ({ to: i.email, ...inviteEmail({ lang, workspace, inviter, role, link: i.url, expires }) })),
            );
          }
          return send(res, 201, {
            invites,
            skipped,
            emailed: delivery.sent,
            failed: delivery.failed,
            ...(invites.length === 1 ? invites[0] : {}),
          });
        }
        if (path === '/api/admin/invites/resend' && req.method === 'POST') {
          // A new link for a pending invitation (the old one stops working), emailed when email is set up.
          const input = await authenticatedBody(req, 4096);
          const email = String(input.email ?? '')
            .trim()
            .toLowerCase();
          const invite = db.prepare('SELECT * FROM invites WHERE email=?').get(email);
          if (!invite) fail(404, 'Invitation not found');
          const role = normalizeRole(invite.role);
          if (!canAssignRole(user, role)) fail(403, 'Cannot change this invitation');
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
            db.prepare('DELETE FROM invites WHERE email=?').run(email);
            fail(409, 'Account already exists');
          }
          const token = randomBytes(32).toString('base64url');
          const expires = Date.now() + 7 * 86400000;
          db.prepare('UPDATE invites SET token=?,expires=?,created_at=?,created_by=? WHERE email=?').run(
            hash(token),
            expires,
            Date.now(),
            user.id,
            email,
          );
          audit(user.id, 'invite.renewed', `${email} · ${role}`);
          const url = inviteLink(token, email);
          const workspace = readWorkspace()?.data.workspace?.name;
          const emailed =
            mail.configured &&
            (await mail.send({
              to: email,
              ...inviteEmail({ lang: langOf(input), workspace, inviter: displayName(user), role, link: url, expires }),
            }));
          return send(res, 200, { email, token, url, expires, emailed });
        }
        if (/^\/api\/admin\/members\/[^/]+\/reset$/.test(path) && req.method === 'POST') {
          // A reset link made by an administrator: emailed when possible and always returned to copy.
          // Current sessions stay until the password is actually changed.
          const target = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(decodeURIComponent(path.split('/')[4])));
          if (!target) fail(404, 'Member not found');
          if (!canManage(user, target)) fail(403, 'Cannot change this account');
          if (target.disabled) fail(400, 'Restore access before resetting the password');
          const input = await authenticatedBody(req, 4096);
          const { token, url, expires } = createResetToken(target.id, 24 * HOUR);
          audit(user.id, 'password.reset.link', target.email);
          const emailed =
            mail.configured &&
            (await mail.send({
              to: target.email,
              ...resetEmail({ lang: langOf(input), name: displayName(target), email: target.email, link: url, hours: 24, admin: displayName(user) }),
            }));
          return send(res, 200, { token, url, expires, emailed });
        }
        if (path === '/api/admin/mail/test' && req.method === 'POST') {
          const input = await authenticatedBody(req, 4096);
          if (!mail.configured) fail(400, 'Email is not set up on the server');
          if (!mailTests(user.id)) fail(429, 'Too many test emails. Try again in 15 minutes.');
          const ok = await mail.send({ to: user.email, ...testEmail({ lang: langOf(input), link: `${mail.publicUrl}/` }) });
          if (!ok) fail(502, 'Could not send the email. Check the SMTP settings and the server log.');
          return send(res, 200, { ok: true, to: user.email });
        }
        if (path === '/api/admin/invites' && req.method === 'DELETE') {
          const input = await authenticatedBody(req);
          db.prepare('DELETE FROM invites WHERE email=?').run(String(input.email));
          audit(user.id, 'invite.revoked', String(input.email));
          return send(res, 200, { ok: true });
        }
        if (path.startsWith('/api/admin/members/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
          const id = path.split('/').at(-1);
          const target = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
          if (!target) fail(404, 'Member not found');
          if (!canManage(user, target)) fail(403, 'Cannot change this account');
          const input = await authenticatedBody(req);
          const leavesNoOwner = target.role === 'owner' && activeOwners() <= 1;
          if (req.method === 'DELETE') {
            if (leavesNoOwner) fail(400, 'The workspace needs at least one owner');
            const workspace = readWorkspace();
            const data = { ...workspace.data, people: { ...workspace.data.people } };
            // The person stays on past work, marked as no longer in the workspace.
            if (data.people[id]) data.people[id] = { ...data.people[id], removed: true };
            db.exec('BEGIN IMMEDIATE');
            try {
              db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
              db.prepare('DELETE FROM users WHERE id=?').run(id);
              db.prepare('UPDATE workspace SET data=?,revision=revision+1 WHERE id=1').run(JSON.stringify(data));
              db.exec('COMMIT');
            } catch (e) {
              db.exec('ROLLBACK');
              throw e;
            }
            closeStreams(id);
            presence.delete(id);
            audit(user.id, 'member.removed', target.email);
            broadcastRevision(workspace.revision + 1, user.id, undefined, {
              prev: workspace.data,
              next: data,
              changed: { records: { people: data.people[id] ? [id] : [] } },
            });
            return send(res, 200, { ok: true });
          }
          const role = input.role === undefined ? target.role : normalizeRole(input.role);
          if (role !== target.role && !canAssignRole(user, role)) fail(403, 'Invalid role');
          if (leavesNoOwner && (role !== 'owner' || input.disabled)) fail(400, 'The workspace needs at least one owner');
          const admin = role === 'owner' || role === 'admin';
          const projectIds = admin ? null : projectsInput(input.projectIds === undefined ? target.projectIds : input.projectIds);
          const projectRoles = admin ? '{}' : levelsInput(input.projectRoles === undefined ? target.projectRoles : input.projectRoles);
          const canCreate =
            role === 'viewer' ? 0 : Number(input.canCreateProjects === undefined ? target.canCreateProjects : !!input.canCreateProjects);
          const disabled = input.disabled === undefined ? target.disabled : !!input.disabled;
          db.prepare('UPDATE users SET role=?,project_ids=?,project_roles=?,can_create_projects=?,disabled=? WHERE id=?').run(
            role,
            projectIds,
            projectRoles,
            canCreate,
            Number(disabled),
            id,
          );
          if (disabled) {
            // Suspension signs the member out everywhere at once and cancels their reset links.
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
            db.prepare('DELETE FROM password_resets WHERE user_id=?').run(id);
            closeStreams(id);
          } else notifyAccess(id);
          audit(
            user.id,
            disabled && !target.disabled ? 'member.suspended' : !disabled && target.disabled ? 'member.restored' : 'member.updated',
            `${target.email} · ${role}`,
          );
          return send(res, 200, { member: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
        }
      }
      fail(404, 'Not found');
    } catch (error) {
      if (!error.status) console.error('Done API error:', error.message);
      send(res, error.status || 500, { error: error.status ? error.message : 'Server error' });
    }
    return true;
  }
  return {
    handler,
    authenticate,
    /** Runs the unused-file cleanup now (it also runs shortly after start and every 6 hours). */
    collectGarbage: (now) => blobs.collectGarbage(now),
    filesDir: blobs.dir,
    /** Resolves when background work started by requests (such as reset emails) is done. */
    idle: () => Promise.allSettled([...background]),
    close: () => {
      clearInterval(heartbeat);
      clearTimeout(firstCleanup);
      clearInterval(cleanupTimer);
      mail.close();
      for (const stream of streams) stream.res.end();
      streams.clear();
      db.close();
      blobs.close();
    },
  };
}
