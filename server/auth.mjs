import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyChanges,
  canReadProject,
  canWriteProject,
  isAdmin,
  mergeState,
  normalizeRole,
  projectLevel,
  sharedState,
  validateState,
  visibleState,
} from './access.mjs';
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

export function createAuthApi({
  filename = process.env.DONE_DB_PATH || resolve('.data/done.sqlite'),
  secure = process.env.DONE_SECURE_COOKIES === 'true',
} = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, project_ids TEXT, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, project_ids TEXT, expires INTEGER NOT NULL, created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);`);
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
  const attempts = new Map();
  const audit = (user, action, detail = '') =>
    db.prepare('INSERT INTO audit(actor,action,detail,at) VALUES(?,?,?,?)').run(user, action, detail, new Date().toISOString());
  // Live updates: every signed-in tab keeps one Server-Sent Events stream open.
  const streams = new Set();
  const presence = new Map();
  const emit = (stream, event, data) => {
    try {
      stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* the socket is closing */
    }
  };
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
  const broadcastRevision = (revision, actorId, tab) => {
    for (const stream of streams) emit(stream, 'revision', { revision, actorId, tab });
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
  /** Tells a member's open tabs to reload their access right away. */
  const notifyAccess = (userId) => {
    for (const stream of streams) if (stream.user.id === userId) emit(stream, 'access', { at: Date.now() });
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
      !['/api/workspace', '/api/events', '/api/presence', '/api/members'].includes(path) &&
      !path.startsWith('/api/blobs/')
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
        if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON required');
      }
      let user = authenticate(req);
      if (path === '/api/auth/session' && req.method === 'GET')
        return send(res, 200, { user, setup: !db.prepare('SELECT id FROM users LIMIT 1').get() });
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
          let data = setup ? sharedState(input.data) : readWorkspace().data;
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
          if (!setup) broadcastRevision(readWorkspace().revision, id);
        }
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
          if (req.method === 'PUT') {
            // Full snapshots can only be saved on top of the revision they were loaded from.
            if (input.revision !== workspace.revision) fail(409, 'Workspace changed. Reload before saving.');
            merged = mergeState(workspace.data, sharedState(input.data), user);
          } else {
            // Change sets merge field by field, so concurrent edits by teammates are kept.
            const info = {};
            merged = applyChanges(workspace.data, input.changes, user, info);
            // Someone limited to some projects keeps access to the projects they create.
            if (info.createdProjects?.size && user.projectIds !== null && !isAdmin(user)) {
              const ids = [...new Set([...user.projectIds, ...info.createdProjects])];
              db.prepare('UPDATE users SET project_ids=? WHERE id=?').run(JSON.stringify(ids), user.id);
              for (const pid of info.createdProjects) audit(user.id, 'project.created', merged.projects[pid]?.name ?? pid);
            }
          }
          db.prepare('UPDATE workspace SET data=?,revision=revision+1 WHERE id=1').run(JSON.stringify(merged));
          const revision = workspace.revision + 1;
          const tab = typeof req.headers['x-done-tab'] === 'string' ? req.headers['x-done-tab'].slice(0, 64) : undefined;
          broadcastRevision(revision, user.id, tab);
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
        const id = decodeURIComponent(path.slice('/api/blobs/'.length));
        const file = readWorkspace().data.files[id];
        if (!file || !canReadProject(user, file.projectId)) fail(404, 'File not found');
        if (req.method === 'GET') {
          const blob = db.prepare('SELECT * FROM blobs WHERE id=?').get(id);
          if (!blob) fail(404, 'File not found');
          res.writeHead(200, {
            'content-type': blob.mime,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'content-disposition': 'attachment',
          });
          res.end(blob.data);
          return;
        }
        if (req.method === 'PUT') {
          if (!canWriteProject(user, file.projectId)) fail(403, 'Read-only access');
          const input = await authenticatedBody(req, 30 * 1024 * 1024);
          if (typeof input.base64 !== 'string') fail(400, 'Invalid file');
          db.prepare('INSERT OR REPLACE INTO blobs VALUES(?,?,?)').run(
            id,
            file.mime || 'application/octet-stream',
            Buffer.from(input.base64, 'base64'),
          );
          return send(res, 200, { ok: true });
        }
      }
      if (path.startsWith('/api/admin/')) {
        if (!isAdmin(user)) fail(403, 'Administrator access required');
        if (path === '/api/admin/members' && req.method === 'GET')
          return send(res, 200, {
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
        if (path === '/api/admin/audit' && req.method === 'GET')
          return send(res, 200, {
            events: db
              .prepare('SELECT audit.*, users.name FROM audit LEFT JOIN users ON users.id=audit.actor ORDER BY audit.id DESC LIMIT 200')
              .all(),
          });
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
          for (const email of emails) {
            if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
              skipped.push({ email, reason: 'exists' });
              continue;
            }
            const token = randomBytes(32).toString('base64url');
            db.prepare('DELETE FROM invites WHERE email=?').run(email);
            db.prepare(
              'INSERT INTO invites(token,email,role,project_ids,project_roles,can_create_projects,expires,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
            ).run(hash(token), email, role, projectIds, projectRoles, canCreate, Date.now() + 7 * 86400000, user.id, Date.now());
            audit(user.id, 'invite.created', `${email} · ${role}`);
            invites.push({ email, token });
          }
          if (!invites.length && skipped.length) fail(409, 'Account already exists');
          return send(res, 201, { invites, skipped, ...(invites.length === 1 ? invites[0] : {}) });
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
            const data = workspace.data;
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
            broadcastRevision(workspace.revision + 1, user.id);
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
            // Suspension signs the member out everywhere at once.
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
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
    close: () => {
      clearInterval(heartbeat);
      for (const stream of streams) stream.res.end();
      streams.clear();
      db.close();
    },
  };
}
