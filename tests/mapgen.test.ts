import { describe, expect, it } from 'vitest';
import { generateProjectMap } from '@/lib/mapgen';
import type { Item, Project } from '@/lib/types';

const project: Project = {
  id: 'p',
  name: 'Mobile',
  icon: '📱',
  color: 'blue',
  status: 'on_track',
  order: 1,
  createdAt: '',
  updatedAt: '',
};

let n = 0;
const item = (p: Partial<Item>): Item => ({
  id: p.id ?? `i${++n}`,
  projectId: 'p',
  type: 'feature',
  title: 'x',
  status: 'backlog',
  priority: 'none',
  tags: [],
  order: n,
  createdAt: '',
  updatedAt: '',
  ...p,
});

describe('generateProjectMap', () => {
  const items = [
    item({ id: 'ini', type: 'initiative' }),
    item({ id: 'f1', parentId: 'ini' }),
    item({ id: 'f2', parentId: 'ini' }),
    item({ id: 'loose' }),
    item({ id: 't', type: 'task', parentId: 'f1' }),
    item({ id: 'm', type: 'milestone', dueDate: '2026-10-01' }),
  ];
  const map = generateProjectMap(project, items);

  it('creates a goal, strategic items and milestones, but not tasks', () => {
    const kinds = map.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'goal')).toHaveLength(1);
    const itemIds = map.nodes.filter((n) => n.kind === 'item').map((n) => n.itemId);
    expect(itemIds.sort()).toEqual(['f1', 'f2', 'ini', 'loose', 'm']);
  });

  it('links parents to children and does not overlap siblings', () => {
    const byItem = new Map(map.nodes.map((n) => [n.itemId ?? n.kind, n]));
    const ini = byItem.get('ini')!;
    const f1 = byItem.get('f1')!;
    const f2 = byItem.get('f2')!;
    expect(map.edges.some((e) => e.source === ini.id && e.target === f1.id)).toBe(true);
    expect(f1.y).toBe(f2.y);
    expect(Math.abs(f1.x - f2.x)).toBeGreaterThanOrEqual(240);
    expect(f1.y).toBeGreaterThan(ini.y);
  });
});
