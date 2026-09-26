export const isAdmin = (user) => user.role === 'owner' || user.role === 'admin';
export const canReadProject = (user, id) => isAdmin(user) || user.projectIds === null || (id ? user.projectIds.includes(id) : false);
export const canWriteProject = (user, id) => user.role !== 'viewer' && canReadProject(user, id);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const select = (source, predicate) => Object.fromEntries(Object.entries(source ?? {}).filter(([, value]) => predicate(value)));

export function visibleState(state, user) {
  if (!state) return null;
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
    maps: select(state.maps, (m) => !!projects[m.projectId]),
    comments: select(state.comments, (c) => (c.targetKind === 'item' ? !!items[c.targetId] : !!docs[c.targetId])),
    activity: (state.activity ?? []).filter((a) => !!items[a.itemId]),
    trash: isAdmin(user) ? state.trash : [],
    meId: user.id,
    onboarded: true,
  };
}

export function validateState(state) {
  if (!record(state)) throw Object.assign(new Error('Invalid workspace'), { status: 400 });
  for (const key of ['projects', 'items', 'docs', 'files', 'maps', 'groups', 'people', 'comments']) {
    if (!record(state[key])) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
    for (const [id, entity] of Object.entries(state[key])) {
      if (!record(entity) || ['__proto__', 'prototype', 'constructor'].includes(id) || (key !== 'maps' && entity.id !== id))
        throw Object.assign(new Error(`Invalid ${key} record`), { status: 400 });
    }
  }
  for (const item of Object.values(state.items)) {
    if (
      !state.projects[item.projectId] ||
      typeof item.title !== 'string' ||
      !Array.isArray(item.tags) ||
      !['idea', 'backlog', 'planned', 'in_progress', 'in_review', 'done', 'canceled'].includes(item.status) ||
      !['initiative', 'epic', 'feature', 'task', 'bug', 'milestone'].includes(item.type) ||
      !['urgent', 'high', 'medium', 'low', 'none'].includes(item.priority) ||
      (item.dependsOn !== undefined && (!Array.isArray(item.dependsOn) || item.dependsOn.some((id) => typeof id !== 'string')))
    )
      throw Object.assign(new Error('Invalid task'), { status: 400 });
  }
}

/** Merge only records the actor may see; hidden projects can never be overwritten. */
export function mergeState(current, incoming, user) {
  validateState(incoming);
  if (user.role === 'viewer') throw Object.assign(new Error('Read-only access'), { status: 403 });
  const visible = visibleState(current, user);
  const next = structuredClone(current);
  const denied = () => {
    throw Object.assign(new Error('Insufficient permissions'), { status: 403 });
  };
  for (const key of ['projects', 'items', 'docs', 'files', 'maps', 'groups', 'people', 'comments']) {
    for (const id of new Set([...Object.keys(visible[key]), ...Object.keys(incoming[key])])) {
      const before = visible[key][id];
      const after = incoming[key][id];
      if (same(before, after)) continue;
      if (!before && current[key][id]) denied();
      if (key === 'groups' && !isAdmin(user)) denied();
      if (key === 'people' && !isAdmin(user) && id !== user.id) denied();
      if (['projects', 'items', 'docs', 'files', 'maps'].includes(key)) {
        if (key === 'projects' && !before && !isAdmin(user) && user.projectIds !== null) denied();
        for (const entity of [before, after].filter(Boolean)) {
          if (!canWriteProject(user, key === 'projects' ? entity.id : entity.projectId)) denied();
        }
      }
      if (key === 'comments') {
        for (const c of [before, after].filter(Boolean)) {
          const target =
            c.targetKind === 'item'
              ? (incoming.items[c.targetId] ?? current.items[c.targetId])
              : (incoming.docs[c.targetId] ?? current.docs[c.targetId]);
          if (!target || !canWriteProject(user, target.projectId)) denied();
        }
      }
      if (after) {
        // Preserve dependency links to hidden projects when editing a visible task.
        next[key][id] =
          key === 'items'
            ? {
                ...after,
                dependsOn: [
                  ...new Set([
                    ...(after.dependsOn ?? []),
                    ...(current.items[id]?.dependsOn ?? []).filter((dep) => current.items[dep] && !visible.items[dep]),
                  ]),
                ],
              }
            : after;
      } else delete next[key][id];
    }
  }
  if (!same(current.workspace, incoming.workspace)) {
    if (!isAdmin(user)) denied();
    next.workspace = incoming.workspace;
  }
  if (isAdmin(user)) next.trash = Array.isArray(incoming.trash) ? incoming.trash : [];
  // Do not accept client-supplied credentials, identity, or workspace roles.
  next.activity = [
    ...(current.activity ?? []).filter((a) => !visible.items[a.itemId]),
    ...(incoming.activity ?? []).filter((a) => !!incoming.items[a.itemId]),
  ].slice(-3000);
  validateState(next);
  return next;
}

export function sharedState(data) {
  const { plane, ai, prefs, meId, ...state } = data;
  return { ...state, onboarded: true };
}
