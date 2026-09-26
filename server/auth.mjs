import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canReadProject, canWriteProject, isAdmin, mergeState, sharedState, validateState, visibleState } from './access.mjs';
const derive = promisify(scrypt);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const publicUser = (row) =>
  row && {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    projectIds: row.project_ids === null ? null : JSON.parse(row.project_ids),
    disabled: !!row.disabled,
  };

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
  const attempts = new Map();
  const audit = (user, action, detail = '') =>
    db.prepare('INSERT INTO audit(actor,action,detail,at) VALUES(?,?,?,?)').run(user, action, detail, new Date().toISOString());
  const readWorkspace = () => {
    const row = db.prepare('SELECT * FROM workspace WHERE id=1').get();
    return row ? { data: JSON.parse(row.data), revision: row.revision } : null;
  };
  const cookie = (token, age) => `done_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const sessionToken = (req) => /(?:^|;\s*)done_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const authenticate = (req) => {
    const token = sessionToken(req);
    if (!token) return null;
    return publicUser(
      db
        .prepare(
          'SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>? AND users.disabled=0',
        )
        .get(hash(token), Date.now()),
    );
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
  const projectsInput = (value) => {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !readWorkspace()?.data.projects[v])) fail(400, 'Invalid project access');
    return JSON.stringify([...new Set(value)]);
  };
  async function authenticatedBody(req, limit) {
    const input = await body(req, limit);
    if (!authenticate(req)) fail(401, 'Sign in to continue');
    return input;
  }
  async function handler(req, res, next) {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (!path.startsWith('/api/auth/') && !path.startsWith('/api/admin/') && path !== '/api/workspace' && !path.startsWith('/api/blobs/')) {
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
          data.people[id] = { id, name, email, color: 'blue' };
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,0,?)').run(
              id,
              email,
              name,
              encoded,
              setup ? 'owner' : invite.role,
              setup ? null : invite.project_ids,
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
        }
        startSession(user, res);
        return send(res, 200, { user });
      }
      if (!user) fail(401, 'Sign in to continue');
      if (path === '/api/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(hash(sessionToken(req) || ''));
        res.setHeader('Set-Cookie', cookie('', 0));
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
      if (path === '/api/workspace') {
        if (req.method === 'PUT' && user.role === 'viewer') fail(403, 'Read-only access');
        let workspace = readWorkspace();
        if (req.method === 'GET') return send(res, 200, { data: visibleState(workspace.data, user), revision: workspace.revision, user });
        if (req.method === 'PUT') {
          const input = await authenticatedBody(req);
          workspace = readWorkspace();
          if (input.revision !== workspace.revision) fail(409, 'Workspace changed. Reload before saving.');
          const merged = mergeState(workspace.data, sharedState(input.data), user);
          db.prepare('UPDATE workspace SET data=?,revision=revision+1 WHERE id=1').run(JSON.stringify(merged));
          return send(res, 200, { revision: workspace.revision + 1 });
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
            invites: db.prepare('SELECT email,role,expires FROM invites WHERE expires>?').all(Date.now()),
          });
        if (path === '/api/admin/audit' && req.method === 'GET')
          return send(res, 200, {
            events: db
              .prepare('SELECT audit.*, users.name FROM audit LEFT JOIN users ON users.id=audit.actor ORDER BY audit.id DESC LIMIT 100')
              .all(),
          });
        if (path === '/api/admin/invites' && req.method === 'POST') {
          const input = await authenticatedBody(req);
          if (!['admin', 'member', 'viewer'].includes(input.role) || (input.role === 'admin' && user.role !== 'owner')) fail(403, 'Invalid role');
          const email = String(input.email ?? '')
            .trim()
            .toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email');
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Account already exists');
          const projectIds = input.role === 'admin' ? null : projectsInput(input.projectIds);
          const token = randomBytes(32).toString('base64url');
          db.prepare('DELETE FROM invites WHERE email=?').run(email);
          db.prepare('INSERT INTO invites VALUES(?,?,?,?,?,?)').run(hash(token), email, input.role, projectIds, Date.now() + 7 * 86400000, user.id);
          audit(user.id, 'invite.created', `${email} · ${input.role}`);
          return send(res, 201, { token, email });
        }
        if (path === '/api/admin/invites' && req.method === 'DELETE') {
          const input = await authenticatedBody(req);
          db.prepare('DELETE FROM invites WHERE email=?').run(String(input.email));
          audit(user.id, 'invite.revoked', String(input.email));
          return send(res, 200, { ok: true });
        }
        if (path.startsWith('/api/admin/members/') && req.method === 'PATCH') {
          const id = path.split('/').at(-1);
          const target = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
          if (!target) fail(404, 'Member not found');
          if (target.id === user.id || target.role === 'owner' || (target.role === 'admin' && user.role !== 'owner'))
            fail(403, 'Cannot change this account');
          const input = await authenticatedBody(req);
          const role = input.role ?? target.role;
          if (!['admin', 'member', 'viewer'].includes(role) || (role === 'admin' && user.role !== 'owner')) fail(403, 'Invalid role');
          const access = role === 'admin' ? null : projectsInput(input.projectIds === undefined ? target.projectIds : input.projectIds);
          db.prepare('UPDATE users SET role=?,project_ids=?,disabled=? WHERE id=?').run(
            role,
            access,
            input.disabled === undefined ? Number(target.disabled) : Number(!!input.disabled),
            id,
          );
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
          audit(user.id, 'member.updated', `${target.email} · ${role}`);
          return send(res, 200, { ok: true });
        }
      }
      fail(404, 'Not found');
    } catch (error) {
      if (!error.status) console.error('Done API error:', error.message);
      send(res, error.status || 500, { error: error.status ? error.message : 'Server error' });
    }
    return true;
  }
  return { handler, authenticate, close: () => db.close() };
}
