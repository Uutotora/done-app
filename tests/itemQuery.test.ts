import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, activeFilterCount, filterItems, groupItems, sortItems, treeRows } from '@/lib/itemQuery';
import type { Item } from '@/lib/types';

let n = 0;
function item(p: Partial<Item>): Item {
  n++;
  return {
    id: p.id ?? `i${n}`,
    projectId: 'p1',
    type: 'task',
    title: `Item ${n}`,
    status: 'backlog',
    priority: 'none',
    tags: [],
    order: n,
    createdAt: `2026-01-0${(n % 9) + 1}T00:00:00.000Z`,
    updatedAt: `2026-02-0${(n % 9) + 1}T00:00:00.000Z`,
    ...p,
  };
}

describe('filterItems', () => {
  const items = [
    item({ id: 'a', status: 'done', tags: ['growth'], assigneeId: 'u1', title: 'Phone sign-up' }),
    item({ id: 'b', status: 'in_progress', type: 'bug', priority: 'urgent', title: 'Crash on rotate' }),
    item({ id: 'c', status: 'canceled', type: 'feature', tags: ['growth', 'design'], title: 'Tour' }),
  ];

  it('returns everything for an empty filter', () => {
    expect(filterItems(items, EMPTY_FILTER)).toHaveLength(3);
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
  });

  it('combines property filters with AND and values with OR', () => {
    expect(filterItems(items, { ...EMPTY_FILTER, tags: ['growth'] }).map((i) => i.id)).toEqual(['a', 'c']);
    expect(filterItems(items, { ...EMPTY_FILTER, tags: ['growth'], type: ['feature'] }).map((i) => i.id)).toEqual(['c']);
    expect(filterItems(items, { ...EMPTY_FILTER, assignee: ['none'] }).map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('hides done and canceled items', () => {
    expect(filterItems(items, { ...EMPTY_FILTER, hideDone: true }).map((i) => i.id)).toEqual(['b']);
  });

  it('searches titles and tags, ignoring case', () => {
    expect(filterItems(items, { ...EMPTY_FILTER, search: 'CRASH' }).map((i) => i.id)).toEqual(['b']);
    expect(filterItems(items, { ...EMPTY_FILTER, search: 'design' }).map((i) => i.id)).toEqual(['c']);
  });
});

describe('sortItems', () => {
  const items = [
    item({ id: 'low', rice: { reach: 100, impact: 1, confidence: 50, effort: 1 }, priority: 'low', dueDate: '2026-03-01' }),
    item({ id: 'none', priority: 'urgent' }),
    item({ id: 'high', rice: { reach: 1000, impact: 2, confidence: 80, effort: 2 }, priority: 'medium', dueDate: '2026-01-15' }),
  ];

  it('puts unscored items last when sorting by RICE in any direction', () => {
    expect(sortItems(items, { field: 'rice', dir: 'desc' }).map((i) => i.id)).toEqual(['high', 'low', 'none']);
    expect(sortItems(items, { field: 'rice', dir: 'asc' }).map((i) => i.id)).toEqual(['low', 'high', 'none']);
  });

  it('sorts by priority rank and by due date with empty dates last', () => {
    expect(sortItems(items, { field: 'priority', dir: 'asc' }).map((i) => i.id)).toEqual(['none', 'high', 'low']);
    expect(sortItems(items, { field: 'due', dir: 'asc' }).map((i) => i.id)).toEqual(['high', 'low', 'none']);
  });
});

describe('groupItems', () => {
  it('keeps empty buckets for boards when asked', () => {
    const groups = groupItems([item({ status: 'done' })], 'status', {}, true);
    expect(groups.map((g) => g.key)).toEqual(['idea', 'backlog', 'planned', 'in_progress', 'in_review', 'done', 'canceled']);
    expect(groups.find((g) => g.key === 'done')!.items).toHaveLength(1);
    expect(groups.find((g) => g.key === 'planned')!.patch).toEqual({ status: 'planned' });
  });

  it('adds a "none" bucket for optional fields', () => {
    const groups = groupItems([item({ horizon: 'now' }), item({})], 'horizon');
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['now', 1],
      ['none', 1],
    ]);
    expect(groups[1].patch).toEqual({ horizon: undefined });
  });
});

describe('treeRows', () => {
  const parent = item({ id: 'p', type: 'epic' });
  const child = item({ id: 'c', parentId: 'p' });
  const grandchild = item({ id: 'g', parentId: 'c' });
  const orphan = item({ id: 'o', parentId: 'missing' });

  it('nests children under visible parents with depth', () => {
    const rows = treeRows([parent, child, grandchild, orphan], () => true);
    expect(rows.map((r) => [r.item.id, r.depth, r.childCount])).toEqual([
      ['p', 0, 1],
      ['c', 1, 1],
      ['g', 2, 0],
      ['o', 0, 0],
    ]);
  });

  it('hides children of collapsed rows', () => {
    const rows = treeRows([parent, child, grandchild], (id) => id !== 'p');
    expect(rows.map((r) => r.item.id)).toEqual(['p']);
  });

  it('shows children at the top level when their parent is filtered out', () => {
    expect(treeRows([child, grandchild], () => true).map((r) => [r.item.id, r.depth])).toEqual([
      ['c', 0],
      ['g', 1],
    ]);
  });
});
