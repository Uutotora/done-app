import { COLLECTIONS, applyRecord, diffShared, mergeFields, same } from './merge.mjs';

/**
 * Roles of the workspace, strongest first:
 * - owner ("super admin"): everything, including managing administrators and other owners;
 * - admin: members, access, groups, trash and every project;
 * - editor: works in the projects shared with them, may create projects when allowed;
 * - viewer: reads the projects shared with them, may comment where allowed.
 * Older databases call editors "member".
 */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'];
/** What a person can do inside one project, weakest first. */
export const LEVELS = ['viewer', 'commenter', 'editor', 'full'];
const rank = (level) => (level ? LEVELS.indexOf(level) : -1);
export const normalizeRole = (role) => (role === 'member' ? 'editor' : role);

export const isAdmin = (user) => user.role === 'owner' || user.role === 'admin';
export const canReadProject = (user, id) => isAdmin(user) || user.projectIds === null || (id ? user.projectIds.includes(id) : false);

/** The access level of a user in a project, or null without access. Workspace pages use an undefined project. */
export function projectLevel(user, id) {
  if (isAdmin(user)) return 'full';
  if (!canReadProject(user, id)) return null;
  const set = id ? user.projectRoles?.[id] : undefined;
  const base = normalizeRole(user.role) === 'viewer' ? 'viewer' : 'editor';
  const level = set && ['viewer', 'commenter', 'editor'].includes(set) ? set : base;
  // Viewers never edit, even if a project was shared with them as editors before their role changed.
  return normalizeRole(user.role) === 'viewer' && rank(level) > rank('commenter') ? 'commenter' : level;
}
export const canWriteProject = (user, id) => rank(projectLevel(user, id)) >= rank('editor');
export const canCommentProject = (user, id) => rank(projectLevel(user, id)) >= rank('commenter');
export const canCreateProjects = (user) => isAdmin(user) || (normalizeRole(user.role) === 'editor' && user.canCreateProjects !== false);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const error = (status, message) => Object.assign(new Error(message), { status });
const BAD_IDS = ['__proto__', 'prototype', 'constructor'];
const PROJECT_SCOPED = ['projects', 'items', 'docs', 'files', 'maps', 'sprints'];
const ITEM_STATUSES = ['idea', 'backlog', 'planned', 'in_progress', 'in_review', 'done', 'canceled'];
const ITEM_TYPES = ['initiative', 'epic', 'feature', 'task', 'bug', 'milestone'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];
const SPRINT_STATUSES = ['planned', 'active', 'completed'];
const NOTIFICATION_LIMIT = 400;

/** Workspaces saved by older versions lack collections added later. */
export function normalizeState(state) {
  if (!record(state)) return state;
  for (const key of COLLECTIONS) state[key] ??= {};
  state.activity ??= [];
  state.trash ??= [];
  return state;
}

/** Project a record belongs to, used for read and write checks. Workspace-level records return undefined. */
function scopeOf(key, id, entity, state) {
  if (key === 'projects' || key === 'maps') return id;
  if (key === 'comments') {
    const target = entity.targetKind === 'item' ? state.items?.[entity.targetId] : state.docs?.[entity.targetId];
    return target?.projectId;
  }
  return entity.projectId;
}

/** Groups a member sees: all of them for administrators, otherwise the groups of the projects they can read. */
export function visibleGroupIds(state, user) {
  if (isAdmin(user)) return new Set(Object.keys(state.groups ?? {}));
  const ids = new Set();
  for (const p of Object.values(state.projects ?? {})) if (p.groupId && canReadProject(user, p.id)) ids.add(p.groupId);
  return ids;
}

/**
 * Whether `user` may read record `id` of collection `key` in `state`. The single source of the read rules:
 * visibleState and the live deltas both use it. `groups` is visibleGroupIds(state, user), passed in to avoid
 * recomputing it for every group.
 */
export function canSeeRecord(state, user, key, id, groups) {
  const collection = state?.[key];
  const entity = collection && Object.hasOwn(collection, id) ? collection[id] : undefined;
  if (!record(entity)) return false;
  switch (key) {
    case 'projects':
      return canReadProject(user, id);
    case 'items':
    case 'sprints':
      return canSeeRecord(state, user, 'projects', entity.projectId);
    // Maps are keyed by their project id and carry no projectId field.
    case 'maps':
      return canSeeRecord(state, user, 'projects', id);
    case 'docs':
    case 'files':
      return canReadProject(user, entity.projectId);
    case 'groups':
      return isAdmin(user) || (groups ?? visibleGroupIds(state, user)).has(id);
    case 'comments':
      return canSeeRecord(state, user, entity.targetKind === 'item' ? 'items' : 'docs', entity.targetId);
    case 'notifications':
      return entity.recipientId === user.id && (!entity.projectId || canSeeRecord(state, user, 'projects', entity.projectId));
    case 'people':
      return true;
    default:
      // Collections without a rule of their own follow their project, if they have one.
      return entity.projectId === undefined || canReadProject(user, entity.projectId);
  }
}

/** A readable record the way `user` receives it: dependency links to tasks they cannot see are left out. */
export function exposeRecord(state, user, key, id) {
  const entity = state[key][id];
  if (key !== 'items') return entity;
  return { ...entity, dependsOn: entity.dependsOn?.filter((dep) => canSeeRecord(state, user, 'items', dep)) };
}

export function visibleState(state, user) {
  if (!state) return null;
  normalizeState(state);
  const groups = visibleGroupIds(state, user);
  const out = { ...state };
  for (const key of COLLECTIONS) {
    out[key] = {};
    for (const id of Object.keys(state[key])) if (canSeeRecord(state, user, key, id, groups)) out[key][id] = exposeRecord(state, user, key, id);
  }
  return {
    ...out,
    activity: state.activity.filter((a) => canSeeRecord(state, user, 'items', a.itemId)),
    trash: isAdmin(user) ? state.trash : [],
    meId: user.id,
    onboarded: true,
  };
}

/**
 * Lookups shared by every member's delta of one write: which comments, dependent tasks, notifications and
 * activity hang off a record whose visibility changed. Built lazily, once per write.
 */
export function deltaIndex(prev, next) {
  const lazy = (build) => {
    let value;
    return () => (value ??= build());
  };
  const group = (entries) => {
    const map = new Map();
    for (const [key, value] of entries) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    }
    return map;
  };
  const comments = lazy(() =>
    group(
      [prev, next].flatMap((s) => Object.values(s.comments ?? {}).map((c) => [`${c.targetKind === 'item' ? 'item' : 'doc'}:${c.targetId}`, c.id])),
    ),
  );
  const dependents = lazy(() => group(Object.values(next.items ?? {}).flatMap((i) => (i.dependsOn ?? []).map((dep) => [dep, i.id]))));
  const notifications = lazy(() =>
    group(
      [prev, next].flatMap((s) =>
        Object.values(s.notifications ?? {})
          .filter((n) => n.projectId)
          .map((n) => [`${n.recipientId}:${n.projectId}`, n.id]),
      ),
    ),
  );
  const activity = lazy(() => group((next.activity ?? []).map((a) => [a.itemId, a])));
  const none = new Set();
  return {
    commentsOn: (kind, id) => comments().get(`${kind}:${id}`) ?? none,
    dependentsOf: (id) => dependents().get(id) ?? none,
    notificationsFor: (userId, projectId) => notifications().get(`${userId}:${projectId}`) ?? none,
    activityOf: (itemId) => activity().get(itemId) ?? none,
  };
}

/**
 * What one member receives after a write moved the workspace from `prev` to `next`, consistent with
 * visibleState: { records?: { [collection]: { [id]: record | null } }, workspace?, activity?: { add, remove },
 * trash?: { add, remove } }. A record is sent as the member now sees it, or as null when they saw it before
 * and no longer do; records they could see neither before nor after are never mentioned. `changed` is
 * info.changed from applyChanges. Returns an empty object when nothing visible changed.
 */
export function visibleDelta(prev, next, user, changed, index = deltaIndex(prev, next)) {
  const lazyGroups = (state) => {
    let value;
    return () => (value ??= visibleGroupIds(state, user));
  };
  const groupsBefore = lazyGroups(prev);
  const groupsAfter = lazyGroups(next);
  const records = {};
  const seen = new Set();
  // Tasks, pages and projects that appeared (true) or disappeared (false) for this member.
  const flipped = { items: new Map(), docs: new Map(), projects: new Map() };
  const put = (key, id) => {
    const mark = `${key}:${id}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    const before = canSeeRecord(prev, user, key, id, key === 'groups' ? groupsBefore() : undefined);
    const after = canSeeRecord(next, user, key, id, key === 'groups' ? groupsAfter() : undefined);
    if (after) (records[key] ??= {})[id] = exposeRecord(next, user, key, id);
    else if (before) (records[key] ??= {})[id] = null;
    if (before !== after) flipped[key]?.set(id, after);
  };
  for (const [key, ids] of Object.entries(changed.records ?? {})) for (const id of ids) put(key, id);
  // Groups follow the projects a member can read.
  if (!isAdmin(user) && (changed.records?.projects || changed.records?.groups)) {
    const before = groupsBefore();
    const after = groupsAfter();
    for (const id of new Set([...before, ...after])) if (before.has(id) !== after.has(id)) put('groups', id);
  }
  for (const id of flipped.items.keys()) {
    for (const dependent of index.dependentsOf(id)) put('items', dependent);
    for (const comment of index.commentsOn('item', id)) put('comments', comment);
  }
  for (const id of flipped.docs.keys()) for (const comment of index.commentsOn('doc', id)) put('comments', comment);
  for (const id of flipped.projects.keys()) for (const n of index.notificationsFor(user.id, id)) put('notifications', n);

  const delta = {};
  if (Object.keys(records).length) delta.records = records;
  if (changed.workspace) delta.workspace = next.workspace;
  // Activity is visible with its task: new entries, plus the history of tasks that just appeared.
  const add = [];
  const remove = [];
  const added = new Set((changed.activity?.add ?? []).map((a) => a.id));
  for (const [id, visible] of flipped.items) {
    if (visible) for (const a of index.activityOf(id)) if (!added.has(a.id)) add.push(a);
  }
  for (const a of changed.activity?.add ?? []) if (canSeeRecord(next, user, 'items', a.itemId)) add.push(a);
  const gone = new Set(changed.activity?.remove ?? []);
  const hidden = new Set([...flipped.items].filter(([, visible]) => !visible).map(([id]) => id));
  if (gone.size || hidden.size) {
    for (const a of prev.activity ?? []) {
      if ((gone.has(a.id) || hidden.has(a.itemId)) && canSeeRecord(prev, user, 'items', a.itemId)) remove.push(a.id);
    }
  }
  if (add.length || remove.length) delta.activity = { add, remove };
  if (changed.trash && isAdmin(user)) delta.trash = changed.trash;
  return delta;
}

export function validateState(state) {
  if (!record(state)) throw error(400, 'Invalid workspace');
  normalizeState(state);
  for (const key of COLLECTIONS) {
    if (!record(state[key])) throw error(400, `Invalid ${key}`);
    for (const [id, entity] of Object.entries(state[key])) {
      if (!record(entity) || BAD_IDS.includes(id) || (key !== 'maps' && entity.id !== id)) throw error(400, `Invalid ${key} record`);
    }
  }
  for (const item of Object.values(state.items)) {
    if (
      !state.projects[item.projectId] ||
      typeof item.title !== 'string' ||
      !Array.isArray(item.tags) ||
      !ITEM_STATUSES.includes(item.status) ||
      !ITEM_TYPES.includes(item.type) ||
      !PRIORITIES.includes(item.priority) ||
      (item.dependsOn !== undefined && (!Array.isArray(item.dependsOn) || item.dependsOn.some((id) => typeof id !== 'string'))) ||
      (item.sprintId !== undefined && typeof item.sprintId !== 'string')
    )
      throw error(400, 'Invalid task');
  }
  for (const sprint of Object.values(state.sprints)) {
    if (!state.projects[sprint.projectId] || typeof sprint.name !== 'string' || !SPRINT_STATUSES.includes(sprint.status))
      throw error(400, 'Invalid sprint');
  }
  for (const n of Object.values(state.notifications)) {
    if (typeof n.recipientId !== 'string' || typeof n.actorId !== 'string' || typeof n.kind !== 'string' || typeof n.targetId !== 'string')
      throw error(400, 'Invalid notification');
  }
}

/**
 * Applies a client change set on top of the current server state, record by
 * record and field by field, after checking every touched record against the
 * member's role and project access. Hidden records can never be read or written.
 *
 * `info.changed` then describes what really changed, for live updates and the audit log:
 * { records: { [collection]: id[] }, workspace?: true, activity?: { add, remove }, trash?: { add, remove } },
 * where `add` holds new entries and `remove` the ids of entries that are gone.
 */
export function applyChanges(current, changes, user, info = {}) {
  if (!record(changes) || (changes.records !== undefined && !record(changes.records))) throw error(400, 'Invalid changes');
  // Projects created in this change set: their creator may fill them even without prior access.
  const created = new Set();
  info.createdProjects = created;
  const touched = {};
  const touch = (key, id) => (touched[key] ??= new Set()).add(id);
  const writable = (projectId) => canWriteProject(user, projectId) || (!!projectId && created.has(projectId));
  const commentable = (projectId) => canCommentProject(user, projectId) || (!!projectId && created.has(projectId));
  normalizeState(current);
  const visible = visibleState(current, user);
  const next = structuredClone(current);
  const denied = () => {
    throw error(403, 'Insufficient permissions');
  };
  for (const key of COLLECTIONS) {
    const records = changes.records?.[key];
    if (records === undefined) continue;
    if (!record(records)) throw error(400, 'Invalid changes');
    for (const [id, change] of Object.entries(records)) {
      const before = change?.before ?? null;
      const after = change?.after ?? null;
      if (BAD_IDS.includes(id) || !record(change) || (before !== null && !record(before)) || (after !== null && !record(after)))
        throw error(400, 'Invalid changes');
      if (after && key !== 'maps' && after.id !== id) throw error(400, 'Invalid changes');
      const existing = current[key][id];
      if (existing && !visible[key][id]) denied();
      if (key === 'groups' && !isAdmin(user)) denied();
      if (key === 'people' && !isAdmin(user) && id !== user.id) denied();
      if (key === 'projects' && !existing && after) {
        if (!canCreateProjects(user)) denied();
        created.add(id);
      }
      // Deleting a whole project is for administrators and for whoever created it.
      if (key === 'projects' && existing && !after && !isAdmin(user) && existing.createdBy !== user.id) denied();
      if (PROJECT_SCOPED.includes(key)) {
        for (const entity of [existing, after].filter(Boolean)) {
          if (!writable(scopeOf(key, id, entity, current))) denied();
        }
      }
      if (key === 'comments') {
        for (const entity of [existing, after].filter(Boolean)) {
          if (!commentable(scopeOf(key, id, entity, next)) && !commentable(scopeOf(key, id, entity, current))) denied();
        }
        const targetOf = (c, state) => (c.targetKind === 'item' ? state.items[c.targetId] : state.docs[c.targetId]);
        if (!isAdmin(user)) {
          // New comments are posted as yourself, unless a deleted task or page is restored together with its thread.
          if (!existing && after && after.authorId !== user.id && (targetOf(after, current) || !targetOf(after, next))) denied();
          // Only the author edits a comment; others may remove it only together with its task or page.
          if (existing && existing.authorId !== user.id && (after ? !same(existing, after) : !!targetOf(existing, next))) denied();
        }
      }
      if (key === 'notifications') {
        // Anyone may notify a teammate, but only as themselves; only the recipient can read or archive it.
        if (
          !existing &&
          after &&
          (after.actorId !== user.id || (after.projectId && !canReadProject(user, after.projectId) && !created.has(after.projectId)))
        )
          denied();
        if (existing && existing.recipientId !== user.id) denied();
      }
      applyRecord(next[key], id, { before, after });
      touch(key, id);
      if (key === 'items' && next.items[id] && current.items[id]) {
        // Keep dependency links to tasks the member cannot see.
        const hidden = (current.items[id].dependsOn ?? []).filter((dep) => current.items[dep] && !visible.items[dep]);
        if (hidden.length) next.items[id] = { ...next.items[id], dependsOn: [...new Set([...(next.items[id].dependsOn ?? []), ...hidden])] };
      }
    }
  }
  if (changes.workspace) {
    if (!record(changes.workspace.before) || !record(changes.workspace.after)) throw error(400, 'Invalid changes');
    if (!same(changes.workspace.before, changes.workspace.after)) {
      if (!isAdmin(user)) denied();
      next.workspace = mergeFields(current.workspace ?? {}, changes.workspace.before, changes.workspace.after);
    }
  }
  if (changes.activity !== undefined) {
    if (!Array.isArray(changes.activity)) throw error(400, 'Invalid changes');
    const known = new Set(next.activity.map((a) => a.id));
    const accepted = changes.activity.filter(
      (a) =>
        record(a) &&
        typeof a.id === 'string' &&
        !known.has(a.id) &&
        (a.actorId === user.id || a.actorId === 'plane') &&
        next.items[a.itemId] &&
        writable(next.items[a.itemId].projectId),
    );
    next.activity = [...next.activity, ...accepted].slice(-3000);
  }
  if (changes.trash && isAdmin(user)) {
    const { add = [], remove = [] } = changes.trash;
    if (!Array.isArray(add) || !Array.isArray(remove)) throw error(400, 'Invalid changes');
    const drop = new Set(remove);
    const known = new Set(next.trash.map((e) => e.id));
    next.trash = [
      ...add.filter((e) => record(e) && typeof e.id === 'string' && !known.has(e.id)),
      ...next.trash.filter((e) => !drop.has(e.id)),
    ].slice(0, 200);
  }
  pruneOrphans(next, touch);
  validateState(next);
  const changed = { records: {} };
  for (const [key, ids] of Object.entries(touched)) {
    const real = [...ids].filter((id) => !same(current[key][id], next[key][id]));
    if (real.length) changed.records[key] = real;
  }
  if (!same(current.workspace, next.workspace)) changed.workspace = true;
  for (const key of ['activity', 'trash']) {
    if (changes[key] === undefined) continue;
    const diff = diffEntries(current[key], next[key]);
    if (diff.add.length || diff.remove.length) changed[key] = diff;
  }
  info.changed = changed;
  return next;
}

/** New entries and ids of removed ones between two lists of { id } entries. */
function diffEntries(before, after) {
  const was = new Set(before.map((e) => e.id));
  const is = new Set(after.map((e) => e.id));
  return { add: after.filter((e) => !was.has(e.id)), remove: [...was].filter((id) => !is.has(id)) };
}

/**
 * A task saved into a project someone else deleted a moment ago has nowhere to
 * live. Drop such records instead of rejecting the whole save.
 */
function pruneOrphans(state, touch = () => {}) {
  for (const key of ['items', 'sprints']) {
    for (const [id, entity] of Object.entries(state[key])) {
      if (state.projects[entity.projectId]) continue;
      delete state[key][id];
      touch(key, id);
    }
  }
  for (const id of Object.keys(state.maps)) {
    if (state.projects[id]) continue;
    delete state.maps[id];
    touch('maps', id);
  }
  for (const [id, item] of Object.entries(state.items)) {
    if (item.parentId && !state.items[item.parentId]) state.items[id] = { ...item, parentId: undefined };
    if (item.sprintId && !state.sprints[item.sprintId]) state.items[id] = { ...state.items[id], sprintId: undefined };
    if (state.items[id] !== item) touch('items', id);
  }
  // Keep each member's inbox bounded.
  const byRecipient = new Map();
  for (const n of Object.values(state.notifications)) {
    const list = byRecipient.get(n.recipientId) ?? [];
    list.push(n);
    byRecipient.set(n.recipientId, list);
  }
  for (const list of byRecipient.values()) {
    if (list.length <= NOTIFICATION_LIMIT) continue;
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    for (const n of list.slice(NOTIFICATION_LIMIT)) {
      delete state.notifications[n.id];
      touch('notifications', n.id);
    }
  }
}

/** Full-snapshot save (legacy PUT): diff against what the member can see, then apply like a patch. */
export function mergeState(current, incoming, user, info = {}) {
  if (normalizeRole(user.role) === 'viewer') throw error(403, 'Read-only access');
  validateState(incoming);
  normalizeState(current);
  const changes = diffShared(visibleState(current, user), sharedState(incoming));
  info.changed = { records: {} };
  return changes ? applyChanges(current, changes, user, info) : structuredClone(current);
}

export function sharedState(data) {
  const { plane, ai, prefs, meId, ...state } = data;
  return { ...state, onboarded: true };
}
