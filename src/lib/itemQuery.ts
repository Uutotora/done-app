import { HORIZONS, ITEM_TYPES, PRIORITIES, PRIORITY_RANK, STATUSES } from './constants';
import { riceScore } from './rice';
import type { Horizon, ID, Item, ItemStatus, ItemType, Person, Priority } from './types';
import { matches } from './utils';

export interface ItemFilter {
  status: ItemStatus[];
  type: ItemType[];
  priority: Priority[];
  assignee: (ID | 'none')[];
  tags: string[];
  search: string;
  hideDone: boolean;
}

export const EMPTY_FILTER: ItemFilter = { status: [], type: [], priority: [], assignee: [], tags: [], search: '', hideDone: false };

export type SortField = 'manual' | 'rice' | 'priority' | 'due' | 'updated' | 'created' | 'title';
export interface ItemSort {
  field: SortField;
  dir: 'asc' | 'desc';
}

export type GroupField = 'none' | 'status' | 'type' | 'horizon' | 'priority' | 'assignee';

export function activeFilterCount(f: ItemFilter): number {
  return f.status.length + f.type.length + f.priority.length + f.assignee.length + f.tags.length + (f.hideDone ? 1 : 0);
}

export function filterItems(items: Item[], f: ItemFilter): Item[] {
  return items.filter((i) => {
    if (f.status.length && !f.status.includes(i.status)) return false;
    if (f.type.length && !f.type.includes(i.type)) return false;
    if (f.priority.length && !f.priority.includes(i.priority)) return false;
    if (f.assignee.length && !f.assignee.includes(i.assigneeId ?? 'none')) return false;
    if (f.tags.length && !f.tags.some((t) => i.tags.includes(t))) return false;
    if (f.hideDone && (i.status === 'done' || i.status === 'canceled')) return false;
    if (f.search && !matches(`${i.title} ${i.tags.join(' ')} ${i.plane?.key ?? ''}`, f.search)) return false;
    return true;
  });
}

export function compareItems(a: Item, b: Item, sort: ItemSort): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const last = (v: string | undefined) => v ?? (sort.dir === 'asc' ? '￿' : '');
  switch (sort.field) {
    case 'rice': {
      const ra = riceScore(a.rice);
      const rb = riceScore(b.rice);
      // Unscored items always go last regardless of direction.
      if (ra == null && rb == null) return a.order - b.order;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return (ra - rb) * dir || a.order - b.order;
    }
    case 'priority':
      return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * dir || a.order - b.order;
    case 'due':
      if (!a.dueDate && !b.dueDate) return a.order - b.order;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate) * dir || a.order - b.order;
    case 'updated':
      return a.updatedAt.localeCompare(b.updatedAt) * dir;
    case 'created':
      return a.createdAt.localeCompare(b.createdAt) * dir;
    case 'title':
      return last(a.title).localeCompare(last(b.title)) * dir;
    default:
      return (a.order - b.order) * dir;
  }
}

export function sortItems(items: Item[], sort: ItemSort): Item[] {
  return [...items].sort((a, b) => compareItems(a, b, sort));
}

export interface ItemGroup {
  key: string;
  /** Value the group stands for; applied to items dropped or created in it. */
  patch: Partial<Item>;
  items: Item[];
}

/** Buckets items by a field, keeping empty buckets for fixed enums so boards keep their columns. */
export function groupItems(items: Item[], field: GroupField, people: Record<ID, Person> = {}, keepEmpty = false): ItemGroup[] {
  if (field === 'none') return [{ key: 'all', patch: {}, items }];
  const bucket = <T extends string>(
    values: readonly T[],
    get: (i: Item) => T | undefined,
    patch: (v: T | undefined) => Partial<Item>,
    noneKey?: string,
  ) => {
    const out: ItemGroup[] = values.map((v) => ({ key: v, patch: patch(v), items: items.filter((i) => get(i) === v) }));
    if (noneKey) out.push({ key: noneKey, patch: patch(undefined), items: items.filter((i) => get(i) === undefined) });
    return keepEmpty ? out : out.filter((g) => g.items.length);
  };
  switch (field) {
    case 'status':
      return bucket(
        STATUSES,
        (i) => i.status,
        (v) => ({ status: v as ItemStatus }),
      );
    case 'type':
      return bucket(
        ITEM_TYPES,
        (i) => i.type,
        (v) => ({ type: v as ItemType }),
      );
    case 'priority':
      return bucket(
        PRIORITIES,
        (i) => i.priority,
        (v) => ({ priority: v as Priority }),
      );
    case 'horizon':
      return bucket<Horizon>(
        HORIZONS,
        (i) => i.horizon,
        (v) => ({ horizon: v }),
        'none',
      );
    case 'assignee': {
      const ids = Object.keys(people);
      return bucket(
        ids,
        (i) => (i.assigneeId && people[i.assigneeId] ? i.assigneeId : undefined),
        (v) => ({ assigneeId: v }),
        'none',
      );
    }
  }
}

/**
 * Turns a flat list into display rows: roots first, children nested under
 * their parents when the parent is visible, otherwise shown at the top level.
 */
export function treeRows(items: Item[], expanded: (id: ID) => boolean): { item: Item; depth: number; childCount: number }[] {
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<ID, Item[]>();
  for (const it of items) {
    if (it.parentId && ids.has(it.parentId)) {
      const list = kids.get(it.parentId) ?? [];
      list.push(it);
      kids.set(it.parentId, list);
    }
  }
  const out: { item: Item; depth: number; childCount: number }[] = [];
  const walk = (it: Item, depth: number) => {
    const children = kids.get(it.id) ?? [];
    out.push({ item: it, depth, childCount: children.length });
    if (children.length && expanded(it.id)) children.forEach((c) => walk(c, depth + 1));
  };
  items.filter((i) => !i.parentId || !ids.has(i.parentId)).forEach((i) => walk(i, 0));
  return out;
}
