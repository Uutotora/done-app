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

/**
 * Comment reactions ({ emoji: [person ids in reaction order] }) merged person by person:
 * what the client removed leaves, what it added joins, and reactions it never saw stay.
 * Two teammates reacting at the same time keep both reactions. Returns undefined when nothing is left.
 */
export function mergeReactions(current, before, after) {
  const map = (value) => (isRecord(value) ? value : {});
  const list = (value) => (Array.isArray(value) ? value : []);
  const [now, was, next] = [map(current), map(before), map(after)];
  const entries = [];
  for (const emoji of new Set([...Object.keys(now), ...Object.keys(next), ...Object.keys(was)])) {
    const removed = new Set(list(was[emoji]).filter((id) => !list(next[emoji]).includes(id)));
    const merged = [...new Set(list(now[emoji]))].filter((id) => !removed.has(id));
    for (const id of list(next[emoji])) if (!list(was[emoji]).includes(id) && !merged.includes(id)) merged.push(id);
    if (merged.length) entries.push([emoji, merged]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Fields merged by their own rule instead of "the client's value wins": (current, before, after) => value, undefined deletes. */
const FIELD_MERGERS = { content: mergeBlocks, brief: mergeBlocks, reactions: mergeReactions };

/** Three-way merge of one record: fields changed by the client win, everything else keeps the current value. */
export function mergeFields(current, before, after) {
  const out = { ...current };
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (same(before[field], after[field])) continue;
    const value = Object.hasOwn(FIELD_MERGERS, field) ? FIELD_MERGERS[field](current[field], before[field], after[field]) : after[field];
    if (value === undefined) delete out[field];
    else out[field] = value;
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

/* ------------------------------------------------------------------------------------------------
 * Rich text (BlockNote documents: arrays of { id, type, props, content, children }) is merged block
 * by block, so two people editing different paragraphs of one page both keep their text. Edits to
 * the same paragraph still resolve to the last save of that paragraph.
 * ---------------------------------------------------------------------------------------------- */

/** Deep equality of JSON values that ignores key order and undefined fields. */
function equalJson(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((value, i) => equalJson(value, b[i]));
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => equalJson(a[key], b[key]));
}

/** Whether two blocks have the same own content (type, props, text), children aside. */
function sameOwn(a, b) {
  const { children: _a, ...ownA } = a;
  const { children: _b, ...ownB } = b;
  return equalJson(ownA, ownB);
}

/**
 * Indexes a block tree: id → { block, parent } and parent id (null for the top level) → child ids
 * in order. Returns null unless every entry is a block with a unique string id.
 */
function indexBlocks(list) {
  if (!Array.isArray(list)) return null;
  const nodes = new Map();
  const kids = new Map();
  const walk = (blocks, parent) => {
    const ids = [];
    for (const block of blocks) {
      if (!isRecord(block) || typeof block.id !== 'string' || !block.id || nodes.has(block.id)) return false;
      if (block.children !== undefined && !Array.isArray(block.children)) return false;
      nodes.set(block.id, { block, parent });
      ids.push(block.id);
      if (block.children?.length && !walk(block.children, block.id)) return false;
    }
    kids.set(parent, ids);
    return true;
  };
  return walk(list, null) ? { nodes, kids } : null;
}

/** Puts `source[index]` right after the nearest block before it in `source` that is already in `seq`, or first. */
function insertAfterAnchor(seq, source, index) {
  for (let i = index - 1; i >= 0; i--) {
    const at = seq.indexOf(source[i]);
    if (at >= 0) return void seq.splice(at + 1, 0, source[index]);
  }
  seq.unshift(source[index]);
}

/**
 * Three-way merge of a block document. `before` is what the client started from, `after` what it
 * saves and `current` what the server has now, maybe with teammates' edits:
 * - blocks the client did not touch keep the current version, blocks it changed take its version;
 * - blocks it deleted are removed; a block someone else removed comes back only if the client edited it
 *   (or something kept lives inside it);
 * - blocks it inserted go right after the nearest preceding block (per `after`) that still exists, or
 *   first; blocks inserted by others stay where they are;
 * - children merge by the same rules; a block the client moved to another parent keeps teammates' text;
 * - if the client reordered blocks it knew about, they follow the client's order and blocks added by
 *   others stay after their neighbours.
 * Anything that is not a list of blocks with ids falls back to "the client's version wins".
 */
export function mergeBlocks(current, before, after) {
  if (!Array.isArray(after)) return after;
  const A = indexBlocks(after);
  const B = indexBlocks(before ?? []);
  const C = indexBlocks(current ?? []);
  if (!A || !B || !C) return after;

  // Which blocks stay, whose version of their own content wins and under which parent they live.
  // `placedByClient` marks blocks positioned as in `after` rather than as in `current`.
  const keep = new Map();
  for (const id of new Set([...A.nodes.keys(), ...B.nodes.keys(), ...C.nodes.keys()])) {
    const a = A.nodes.get(id);
    const b = B.nodes.get(id);
    const c = C.nodes.get(id);
    if (b && !a) continue;
    if (!b) {
      keep.set(id, a ? { own: a.block, parent: a.parent, placedByClient: true } : { own: c.block, parent: c.parent, placedByClient: false });
      continue;
    }
    const edited = !sameOwn(b.block, a.block);
    const moved = b.parent !== a.parent;
    if (!c && !edited && !moved) continue;
    keep.set(id, { own: edited || !c ? a.block : c.block, parent: moved || !c ? a.parent : c.parent, placedByClient: moved || !c });
  }
  // A removed block stays when something that is kept lives inside it.
  for (const entry of [...keep.values()]) {
    let parent = entry.parent;
    while (parent !== null && !keep.has(parent)) {
      const a = A.nodes.get(parent);
      const source = a ?? C.nodes.get(parent);
      keep.set(parent, { own: source.block, parent: source.parent, placedByClient: !!a });
      parent = source.parent;
    }
  }
  // Two people nesting blocks into each other can form a loop: the client's placement wins there.
  for (const id of keep.keys()) {
    for (let looped = true; looped;) {
      looped = false;
      const path = [];
      for (let node = id; node !== null; node = keep.get(node).parent) {
        const start = path.indexOf(node);
        if (start < 0) {
          path.push(node);
          continue;
        }
        for (const member of path.slice(start)) {
          const entry = keep.get(member);
          if (entry.placedByClient) continue;
          const a = A.nodes.get(member);
          entry.parent = a && (a.parent === null || keep.has(a.parent)) ? a.parent : null;
          entry.placedByClient = true;
        }
        looped = true;
        break;
      }
    }
  }

  const members = new Map();
  for (const [id, entry] of keep) {
    if (!members.has(entry.parent)) members.set(entry.parent, new Set());
    members.get(entry.parent).add(id);
  }
  const order = (parent) => {
    const mine = members.get(parent);
    if (!mine) return [];
    const inA = A.kids.get(parent) ?? [];
    const inB = B.kids.get(parent) ?? [];
    const inC = C.kids.get(parent) ?? [];
    const [setA, setB, setC] = [new Set(inA), new Set(inB), new Set(inC)];
    // Blocks the client kept under this parent and that are still here.
    const known = (id) => mine.has(id) && setA.has(id) && setB.has(id) && setC.has(id);
    const reordered = !same(
      inB.filter((id) => setA.has(id)),
      inA.filter((id) => setB.has(id)),
    );
    let seq;
    if (!reordered) seq = inC.filter((id) => known(id) || (mine.has(id) && !setA.has(id)));
    else {
      seq = inA.filter(known);
      inC.forEach((id, i) => mine.has(id) && !setA.has(id) && insertAfterAnchor(seq, inC, i));
    }
    inA.forEach((id, i) => mine.has(id) && !seq.includes(id) && insertAfterAnchor(seq, inA, i));
    for (const id of mine) if (!seq.includes(id)) seq.push(id);
    return seq;
  };
  const build = (parent) =>
    order(parent).map((id) => {
      const own = keep.get(id).own;
      const block = { ...own };
      const children = build(id);
      if (children.length || Array.isArray(own.children)) block.children = children;
      else delete block.children;
      return block;
    });
  return build(null);
}
