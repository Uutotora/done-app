import type { ID, Item, MapEdge, MapNode, Project } from './types';
import { uid } from './utils';

const NODE_W = 240;
const GAP_X = 36;
const LEVEL_H = 190;

interface TreeNode {
  node: MapNode;
  children: TreeNode[];
  width: number;
}

/**
 * Builds a tidy top-down tree: project goal → initiatives → epics → features.
 * Milestones hang off the goal on the right. Tasks and bugs stay out of the map
 * to keep it strategic.
 */
export function generateProjectMap(project: Project, items: Item[]): { nodes: MapNode[]; edges: MapEdge[] } {
  const strategic = items.filter((i) => i.projectId === project.id && ['initiative', 'epic', 'feature'].includes(i.type));
  const byParent = new Map<ID | undefined, Item[]>();
  const ids = new Set(strategic.map((i) => i.id));
  for (const it of strategic) {
    const parent = it.parentId && ids.has(it.parentId) ? it.parentId : undefined;
    const list = byParent.get(parent) ?? [];
    list.push(it);
    byParent.set(parent, list);
  }
  const rank = { initiative: 0, epic: 1, feature: 2 } as Record<string, number>;
  for (const list of byParent.values()) list.sort((a, b) => rank[a.type] - rank[b.type] || a.order - b.order);

  const build = (item: Item, depth: number): TreeNode => {
    const kids = depth < 3 ? (byParent.get(item.id) ?? []).map((c) => build(c, depth + 1)) : [];
    const width = Math.max(NODE_W, kids.reduce((s, k) => s + k.width, 0) + GAP_X * Math.max(0, kids.length - 1));
    return { node: { id: uid('n'), kind: 'item', itemId: item.id, x: 0, y: 0 }, children: kids, width };
  };

  const rootKids = (byParent.get(undefined) ?? []).map((i) => build(i, 1));
  const rootWidth = Math.max(NODE_W, rootKids.reduce((s, k) => s + k.width, 0) + GAP_X * Math.max(0, rootKids.length - 1));
  const root: TreeNode = {
    node: { id: uid('n'), kind: 'goal', text: project.summary || project.name, x: 0, y: 0 },
    children: rootKids,
    width: rootWidth,
  };

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const place = (t: TreeNode, left: number, depth: number) => {
    t.node.x = Math.round(left + t.width / 2 - NODE_W / 2);
    t.node.y = depth * LEVEL_H;
    nodes.push(t.node);
    let cursor = left + (t.width - (t.children.reduce((s, k) => s + k.width, 0) + GAP_X * Math.max(0, t.children.length - 1))) / 2;
    for (const c of t.children) {
      edges.push({ id: uid('e'), source: t.node.id, target: c.node.id });
      place(c, cursor, depth + 1);
      cursor += c.width + GAP_X;
    }
  };
  place(root, 0, 0);

  const milestones = items
    .filter((i) => i.projectId === project.id && i.type === 'milestone')
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  milestones.forEach((m, idx) => {
    const n: MapNode = { id: uid('n'), kind: 'item', itemId: m.id, x: rootWidth + 120, y: idx * 110 - 20 };
    nodes.push(n);
    edges.push({ id: uid('e'), source: root.node.id, target: n.id, label: '' });
  });

  return { nodes, edges };
}
