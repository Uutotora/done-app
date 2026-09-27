import { COLLECTIONS } from '../../server/merge.mjs';

type Entry = { id: string; [key: string]: unknown };

/**
 * What changed for this member in one save by someone else, as the server sends it over the live stream
 * (visibleDelta in server/access.mjs). A record set to null is no longer visible (deleted, moved away or
 * access removed).
 */
export interface WorkspaceDelta {
  records?: Record<string, Record<string, Record<string, unknown> | null>>;
  workspace?: Record<string, unknown>;
  activity?: { add: Entry[]; remove: string[] };
  trash?: { add: Entry[]; remove: string[] };
}

/** A live 'revision' event. Older servers send only `revision`; `delta` is left out when it would be too large. */
export interface RevisionEvent {
  revision: number;
  baseRevision?: number;
  actorId?: string;
  tab?: string;
  delta?: WorkspaceDelta;
}

/**
 * Applies a delta to the last state received from the server. Collections and records the delta does not
 * touch keep their identity, so only what changed re-renders.
 */
export function applyDelta<T extends object>(state: T, delta: WorkspaceDelta): T {
  const source = state as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  for (const [key, records] of Object.entries(delta.records ?? {})) {
    if (!COLLECTIONS.includes(key) || !records || typeof records !== 'object') continue;
    const collection = { ...((source[key] as Record<string, unknown> | undefined) ?? {}) };
    for (const [id, record] of Object.entries(records)) {
      if (record === null) delete collection[id];
      else collection[id] = record;
    }
    next[key] = collection;
  }
  if (delta.workspace) next.workspace = delta.workspace;
  // New activity goes to the end (oldest first), new trash entries to the top (newest first), like on the server.
  if (delta.activity) next.activity = applyEntries(source.activity, delta.activity, false);
  if (delta.trash) next.trash = applyEntries(source.trash, delta.trash, true);
  return next as T;
}

function applyEntries(list: unknown, change: { add: Entry[]; remove: string[] }, first: boolean): Entry[] {
  const current = Array.isArray(list) ? (list as Entry[]) : [];
  const add = Array.isArray(change.add) ? change.add : [];
  const drop = new Set([...(Array.isArray(change.remove) ? change.remove : []), ...add.map((e) => e.id)]);
  const kept = current.filter((e) => !drop.has(e.id));
  return first ? [...add, ...kept] : [...kept, ...add];
}
