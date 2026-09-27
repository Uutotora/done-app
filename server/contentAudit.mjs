// Content events for the security log, derived from one applied change set.
//
// The log answers "who created or removed what": projects, tasks, pages, files
// and sprints created or deleted, projects renamed or archived, pages renamed,
// someone else's comment removed, and trash restored or emptied. Everyday edits
// (status, dates, text, moving cards) stay out so the log remains readable.

const ACTIONS_LIMIT = 10;
const TRASH_TTL = 30 * 86400000;
/** The trash keeps this many entries; older ones fall out as new ones arrive (see applyChanges). */
const TRASH_LIMIT = 200;
/** Separator between parts of an audit detail, the same one access events use. */
const SEP = ' · ';

/** Content actions, as opposed to sign-ins, invitations and access changes. */
export const isContentAction = (action) => /^(project|task|doc|file|folder|link|sprint|comment|trash)\./.test(action) && action !== 'project.access';

const nodeKind = (node) => (node.kind === 'folder' ? 'folder' : node.kind === 'link' ? 'link' : 'file');

/**
 * Audit entries for a write that moved the workspace from `prev` to `next`.
 * `changed` is info.changed from applyChanges; `actorId` is who saved it.
 * Returns [{ action, detail, target?, rename? }]: `target` names the record ("doc:<id>")
 * and `rename` carries { from, to, suffix } so repeated renames can be folded into one entry
 * (the new detail of a folded entry is `${from} → ${to}${suffix}`, or `${to}${suffix}` for a creation).
 */
export function contentEvents(prev, next, changed, actorId) {
  const ids = (key) => changed?.records?.[key] ?? [];
  const was = (key, id) => prev[key]?.[id];
  const is = (key, id) => next[key]?.[id];
  const createdIds = (key) => ids(key).filter((id) => !was(key, id) && is(key, id));
  const deletedIds = (key) => ids(key).filter((id) => was(key, id) && !is(key, id));
  const keptIds = (key) => ids(key).filter((id) => was(key, id) && is(key, id));
  const projectName = (id) => (id ? ((next.projects?.[id] ?? prev.projects?.[id])?.name ?? '') : '');
  const inProject = (title, projectId) => [title ?? '', ...(projectId ? [projectName(projectId)] : [])].join(SEP);
  const events = [];

  // Records brought back from the trash are logged once, as the restore.
  const restored = new Set();
  const trashRemoved = new Set(changed?.trash?.remove ?? []);
  const removedEntries = (prev.trash ?? []).filter((e) => trashRemoved.has(e.id));
  const restoredEntries = [];
  const purgedEntries = [];
  for (const entry of removedEntries) {
    const snapshot = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : {};
    const records = Object.entries(snapshot).flatMap(([key, value]) =>
      value && typeof value === 'object' ? Object.keys(value).map((id) => [key, id]) : [],
    );
    if (records.some(([key, id]) => !was(key, id) && is(key, id))) {
      restoredEntries.push(entry);
      for (const [key, id] of records) restored.add(`${key}:${id}`);
    } else purgedEntries.push(entry);
  }
  const fresh = (key, id) => !restored.has(`${key}:${id}`);

  // Projects. Their tasks, pages, files and sprints come and go with them and are not listed one by one.
  const projectsCreated = new Set(createdIds('projects'));
  const projectsDeleted = new Set(deletedIds('projects'));
  for (const id of projectsCreated)
    if (fresh('projects', id)) events.push({ action: 'project.created', detail: is('projects', id).name ?? '', target: `project:${id}` });
  for (const id of projectsDeleted) events.push({ action: 'project.deleted', detail: was('projects', id).name ?? '', target: `project:${id}` });
  for (const id of keptIds('projects')) {
    const before = was('projects', id);
    const after = is('projects', id);
    if ((before.name ?? '') !== (after.name ?? ''))
      events.push({
        action: 'project.renamed',
        detail: `${before.name ?? ''} → ${after.name ?? ''}`,
        target: `project:${id}`,
        rename: { from: before.name ?? '', to: after.name ?? '', suffix: '' },
      });
    if (!!before.archived !== !!after.archived)
      events.push({ action: after.archived ? 'project.archived' : 'project.unarchived', detail: after.name ?? '', target: `project:${id}` });
  }
  const withProject = (entity) => !projectsCreated.has(entity.projectId) && !projectsDeleted.has(entity.projectId);

  // Tasks and sprints.
  for (const [key, type, title] of [
    ['items', 'task', 'title'],
    ['sprints', 'sprint', 'name'],
  ]) {
    for (const id of createdIds(key)) {
      const entity = is(key, id);
      if (fresh(key, id) && withProject(entity))
        events.push({ action: `${type}.created`, detail: inProject(entity[title], entity.projectId), target: `${type}:${id}` });
    }
    for (const id of deletedIds(key)) {
      const entity = was(key, id);
      if (withProject(entity))
        events.push({ action: `${type}.deleted`, detail: inProject(entity[title], entity.projectId), target: `${type}:${id}` });
    }
  }

  // Pages and files: nested pages and folder contents follow their parent.
  for (const [key, title] of [
    ['docs', 'title'],
    ['files', 'name'],
  ]) {
    const created = new Set(createdIds(key));
    const deleted = new Set(deletedIds(key));
    const type = (entity) => (key === 'docs' ? 'doc' : nodeKind(entity));
    for (const id of created) {
      const entity = is(key, id);
      if (fresh(key, id) && withProject(entity) && !created.has(entity.parentId))
        events.push({ action: `${type(entity)}.created`, detail: inProject(entity[title], entity.projectId), target: `${type(entity)}:${id}` });
    }
    for (const id of deleted) {
      const entity = was(key, id);
      if (withProject(entity) && !deleted.has(entity.parentId))
        events.push({ action: `${type(entity)}.deleted`, detail: inProject(entity[title], entity.projectId), target: `${type(entity)}:${id}` });
    }
  }
  for (const id of keptIds('docs')) {
    const before = was('docs', id);
    const after = is('docs', id);
    if ((before.title ?? '') === (after.title ?? '')) continue;
    const suffix = after.projectId ? `${SEP}${projectName(after.projectId)}` : '';
    events.push({
      action: 'doc.renamed',
      detail: `${before.title ?? ''} → ${after.title ?? ''}${suffix}`,
      target: `doc:${id}`,
      rename: { from: before.title ?? '', to: after.title ?? '', suffix },
    });
  }

  // Someone else's comment removed on its own, not together with its task or page.
  for (const id of deletedIds('comments')) {
    const comment = was('comments', id);
    if (comment.authorId === actorId) continue;
    const target = comment.targetKind === 'item' ? is('items', comment.targetId) : is('docs', comment.targetId);
    if (!target) continue;
    const author = (next.people?.[comment.authorId] ?? prev.people?.[comment.authorId])?.name ?? '';
    events.push({
      action: 'comment.removed',
      detail: [author, target.title ?? '', ...(target.projectId ? [projectName(target.projectId)] : [])].join(SEP),
      target: `comment:${id}`,
    });
  }

  // Trash: restores, permanent deletion and emptying. Entries past their 30 days are cleaned up automatically.
  for (const entry of restoredEntries) events.push({ action: 'trash.restored', detail: entry.title ?? '', target: `trash:${entry.id}` });
  // Neither are the oldest entries pushed out of a full trash by new deletions.
  const now = Date.now();
  const overflow = (changed?.trash?.add?.length ?? 0) > 0 && (next.trash ?? []).length >= TRASH_LIMIT;
  const manual = overflow ? [] : purgedEntries.filter((e) => !(now - Date.parse(e.deletedAt) > TRASH_TTL));
  if (manual.length && purgedEntries.length > 1 && !(next.trash ?? []).length)
    events.push({ action: 'trash.emptied', detail: String(purgedEntries.length) });
  else for (const entry of manual) events.push({ action: 'trash.purged', detail: entry.title ?? '', target: `trash:${entry.id}` });

  // A bulk action (import, mass delete) is summarised after the first few entries of each kind.
  const counts = new Map();
  const out = [];
  const extra = new Map();
  for (const event of events) {
    const n = (counts.get(event.action) ?? 0) + 1;
    counts.set(event.action, n);
    if (n <= ACTIONS_LIMIT) out.push(event);
    else extra.set(event.action, (extra.get(event.action) ?? 0) + 1);
  }
  for (const [action, n] of extra) out.push({ action: `${action}.more`, detail: String(n) });
  return out;
}
