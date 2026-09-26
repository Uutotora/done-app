import { COLLECTIONS, applyRecord, diffShared, mergeFields, same } from './merge.mjs';

export const isAdmin = (user) => user.role === 'owner' || user.role === 'admin';
export const canReadProject = (user, id) => isAdmin(user) || user.projectIds === null || (id ? user.projectIds.includes(id) : false);
export const canWriteProject = (user, id) => user.role !== 'viewer' && canReadProject(user, id);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const select = (source, predicate) => Object.fromEntries(Object.entries(source ?? {}).filter(([id, value]) => predicate(value, id)));
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

export function visibleState(state, user) {
  if (!state) return null;
  normalizeState(state);
  const projects = select(state.projects, (p) => canReadProject(user, p.id));
  const items = select(state.items, (i) => !!projects[i.projectId]);
  const docs = select(state.docs, (d) => canReadProject(user, d.projectId));
  const files = select(state.files, (f) => canReadProject(user, f.projectId));
  return {
    ...state,
    projects,
    items: Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...item, dependsOn: item.dependsOn?.filter((dep) => !!items[dep]) }])),
    docs,
    files,
    groups: select(state.groups, (g) => isAdmin(user) || Object.values(projects).some((p) => p.groupId === g.id)),
    // Maps are keyed by their project id and carry no projectId field.
    maps: select(state.maps, (_m, id) => !!projects[id]),
    sprints: select(state.sprints, (s) => !!projects[s.projectId]),
    comments: select(state.comments, (c) => (c.targetKind === 'item' ? !!items[c.targetId] : !!docs[c.targetId])),
    notifications: select(state.notifications, (n) => n.recipientId === user.id && (!n.projectId || !!projects[n.projectId])),
    activity: (state.activity ?? []).filter((a) => !!items[a.itemId]),
    trash: isAdmin(user) ? state.trash : [],
    meId: user.id,
    onboarded: true,
  };
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
 */
export function applyChanges(current, changes, user) {
  if (!record(changes) || (changes.records !== undefined && !record(changes.records))) throw error(400, 'Invalid changes');
  if (user.role === 'viewer') {
    // Viewers only keep their own inbox: read and archive notifications addressed to them.
    if (Object.keys(changes.records ?? {}).some((key) => key !== 'notifications') || changes.workspace) throw error(403, 'Read-only access');
    for (const change of Object.values(changes.records?.notifications ?? {})) if (!change?.before || !change?.after) throw error(403, 'Read-only access');
    changes = { records: changes.records ?? {} };
  }
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
      if (PROJECT_SCOPED.includes(key)) {
        if (key === 'projects' && !existing && after && !isAdmin(user) && user.projectIds !== null) denied();
        for (const entity of [existing, after].filter(Boolean)) {
          if (!canWriteProject(user, scopeOf(key, id, entity, current))) denied();
        }
      }
      if (key === 'comments') {
        for (const entity of [existing, after].filter(Boolean)) {
          if (!canWriteProject(user, scopeOf(key, id, entity, next)) && !canWriteProject(user, scopeOf(key, id, entity, current))) denied();
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
        if (!existing && after && (after.actorId !== user.id || (after.projectId && !canReadProject(user, after.projectId)))) denied();
        if (existing && existing.recipientId !== user.id) denied();
      }
      applyRecord(next[key], id, { before, after });
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
        canWriteProject(user, next.items[a.itemId].projectId),
    );
    next.activity = [...next.activity, ...accepted].slice(-3000);
  }
  if (changes.trash && isAdmin(user)) {
    const { add = [], remove = [] } = changes.trash;
    if (!Array.isArray(add) || !Array.isArray(remove)) throw error(400, 'Invalid changes');
    const drop = new Set(remove);
    const known = new Set(next.trash.map((e) => e.id));
    next.trash = [...add.filter((e) => record(e) && typeof e.id === 'string' && !known.has(e.id)), ...next.trash.filter((e) => !drop.has(e.id))].slice(
      0,
      200,
    );
  }
  pruneOrphans(next);
  validateState(next);
  return next;
}

/**
 * A task saved into a project someone else deleted a moment ago has nowhere to
 * live. Drop such records instead of rejecting the whole save.
 */
function pruneOrphans(state) {
  for (const key of ['items', 'sprints']) {
    for (const [id, entity] of Object.entries(state[key])) if (!state.projects[entity.projectId]) delete state[key][id];
  }
  for (const id of Object.keys(state.maps)) if (!state.projects[id]) delete state.maps[id];
  for (const [id, item] of Object.entries(state.items)) {
    if (item.parentId && !state.items[item.parentId]) state.items[id] = { ...item, parentId: undefined };
    if (item.sprintId && !state.sprints[item.sprintId]) state.items[id] = { ...state.items[id], sprintId: undefined };
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
    for (const n of list.slice(NOTIFICATION_LIMIT)) delete state.notifications[n.id];
  }
}

/** Full-snapshot save (legacy PUT): diff against what the member can see, then apply like a patch. */
export function mergeState(current, incoming, user) {
  if (user.role === 'viewer') throw error(403, 'Read-only access');
  validateState(incoming);
  normalizeState(current);
  const changes = diffShared(visibleState(current, user), sharedState(incoming));
  return changes ? applyChanges(current, changes, user) : structuredClone(current);
}

export function sharedState(data) {
  const { plane, ai, prefs, meId, ...state } = data;
  return { ...state, onboarded: true };
}
