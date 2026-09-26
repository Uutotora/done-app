import type { ID, Item, Person } from './types';
import { shiftISO, todayISO } from './dates';
import { PRIORITY_RANK } from './constants';

export const isFinished = (item: Item) => item.status === 'done' || item.status === 'canceled';
export const isWorkItem = (item: Item) => item.type !== 'initiative' && item.type !== 'milestone';

export function blockersOf(item: Item, items: Record<ID, Item>): Item[] {
  return (item.dependsOn ?? []).flatMap((id) => (items[id] && !isFinished(items[id]) ? [items[id]] : []));
}

/** Reject cycles, including indirect ones. Safe even with malformed imported graphs. */
export function canDependOn(itemId: ID, dependencyId: ID, items: Record<ID, Item>): boolean {
  if (itemId === dependencyId || !items[dependencyId]) return false;
  const seen = new Set<ID>();
  const queue = [dependencyId];
  while (queue.length) {
    const id = queue.pop()!;
    if (id === itemId) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(items[id]?.dependsOn ?? []));
  }
  return true;
}

export type WorkBucket = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'completed';
export const WORK_BUCKETS: WorkBucket[] = ['overdue', 'today', 'week', 'later', 'undated', 'completed'];
export function workBucket(item: Item, today = todayISO()): WorkBucket {
  if (isFinished(item)) return 'completed';
  if (!item.dueDate) return 'undated';
  if (item.dueDate < today) return 'overdue';
  if (item.dueDate === today) return 'today';
  if (item.dueDate <= shiftISO(today, 7)) return 'week';
  return 'later';
}

export function workSummary(items: Item[], allItems: Record<ID, Item>, today = todayISO()) {
  const work = items.filter(isWorkItem);
  const active = work.filter((i) => !isFinished(i));
  return {
    active,
    overdue: active.filter((i) => i.dueDate && i.dueDate < today),
    upcoming: active.filter((i) => i.dueDate && i.dueDate >= today && i.dueDate <= shiftISO(today, 7)),
    unassigned: active.filter((i) => !i.assigneeId),
    blocked: active.filter((i) => blockersOf(i, allItems).length > 0),
    done: work.filter((i) => i.status === 'done'),
  };
}

export function sortWork(items: Item[]): Item[] {
  return [...items].sort(
    (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order,
  );
}

export function teamWorkload(items: Item[], people: Record<ID, Person>, today = todayISO()) {
  const active = items.filter((i) => isWorkItem(i) && !isFinished(i));
  const ids = [...new Set(active.map((i) => i.assigneeId))];
  return ids
    .map((id) => {
      const assigned = active.filter((i) => i.assigneeId === id);
      return {
        id,
        person: id ? people[id] : undefined,
        count: assigned.length,
        overdue: assigned.filter((i) => i.dueDate && i.dueDate < today).length,
      };
    })
    .sort((a, b) => b.count - a.count);
}
