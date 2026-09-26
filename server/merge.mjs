// Record-level sync shared by the browser and the server.
//
// A client describes what it changed since the last state it received from the
// server as { before, after } pairs per record. The server (and the client when
// it rebases on top of fresh data) applies only the fields that differ between
// `before` and `after`, so two people editing different fields of the same task
// never overwrite each other, and edits to different records never conflict.

/** Collections of records keyed by id that are shared between members. */
export const COLLECTIONS = ['projects', 'items', 'docs', 'files', 'maps', 'groups', 'people', 'comments', 'sprints', 'notifications'];

export const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** Three-way merge of one record: fields changed by the client win, everything else keeps the current value. */
export function mergeFields(current, before, after) {
  const out = { ...current };
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[field], after[field])) continue;
    if (after[field] === undefined) delete out[field];
    else out[field] = after[field];
  }
  return out;
}

/**
 * Describes how `next` differs from `base`. Records are compared by reference
 * first, which is cheap because the store never mutates records in place.
 * Returns null when nothing changed.
 */
export function diffShared(base, next) {
  const changes = { records: {} };
  let changed = false;
  for (const key of COLLECTIONS) {
    const a = base?.[key] ?? {};
    const b = next?.[key] ?? {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[id] === b[id] || same(a[id], b[id])) continue;
      (changes.records[key] ??= {})[id] = { before: a[id] ?? null, after: b[id] ?? null };
      changed = true;
    }
  }
  if (!same(base?.workspace, next?.workspace)) {
    changes.workspace = { before: base?.workspace ?? {}, after: next?.workspace ?? {} };
    changed = true;
  }
  const knownActivity = new Set((base?.activity ?? []).map((a) => a.id));
  const activity = (next?.activity ?? []).filter((a) => !knownActivity.has(a.id));
  if (activity.length) {
    changes.activity = activity;
    changed = true;
  }
  const baseTrash = new Set((base?.trash ?? []).map((e) => e.id));
  const nextTrash = new Set((next?.trash ?? []).map((e) => e.id));
  const add = (next?.trash ?? []).filter((e) => !baseTrash.has(e.id));
  const remove = [...baseTrash].filter((id) => !nextTrash.has(id));
  if (add.length || remove.length) {
    changes.trash = { add, remove };
    changed = true;
  }
  return changed ? changes : null;
}

/**
 * Applies one record change to `collection` (mutated in place).
 * A record deleted by someone else stays deleted even if this client edited it.
 */
export function applyRecord(collection, id, change) {
  const before = change.before ?? null;
  const after = change.after ?? null;
  const current = collection[id];
  if (!after) {
    delete collection[id];
    return;
  }
  if (!before) {
    collection[id] = current && isRecord(current) ? mergeFields(current, {}, after) : after;
    return;
  }
  if (!current) return;
  collection[id] = mergeFields(current, before, after);
}

/** Applies a whole change set without permission checks. Used by the client to rebase unsaved edits. */
export function applyShared(state, changes) {
  const next = { ...state };
  for (const key of COLLECTIONS) {
    const records = changes.records?.[key];
    if (!records) continue;
    next[key] = { ...(state[key] ?? {}) };
    for (const [id, change] of Object.entries(records)) applyRecord(next[key], id, change);
  }
  if (changes.workspace) next.workspace = mergeFields(state.workspace ?? {}, changes.workspace.before, changes.workspace.after);
  if (changes.activity?.length) {
    const known = new Set((state.activity ?? []).map((a) => a.id));
    next.activity = [...(state.activity ?? []), ...changes.activity.filter((a) => !known.has(a.id))].slice(-3000);
  }
  if (changes.trash) {
    const remove = new Set(changes.trash.remove);
    const known = new Set((state.trash ?? []).map((e) => e.id));
    next.trash = [...changes.trash.add.filter((e) => !known.has(e.id)), ...(state.trash ?? []).filter((e) => !remove.has(e.id))];
  }
  return next;
}
