import { useMemo } from 'react';
import { useData } from './store';
import { STATUS_META } from './constants';
import type { ID, Item, Project, Ref } from './types';

/** Projects in sidebar order: by group, then by position inside the group; ungrouped last. */
export function useProjectsList(): Project[] {
  const projects = useData((s) => s.projects);
  const groups = useData((s) => s.groups);
  return useMemo(() => {
    const rank = (p: Project) => (p.groupId && groups[p.groupId] ? groups[p.groupId].order : Number.MAX_SAFE_INTEGER);
    return Object.values(projects)
      .filter((p) => !p.archived)
      .sort((a, b) => rank(a) - rank(b) || a.order - b.order);
  }, [projects, groups]);
}

export function useItems(projectId?: ID): Item[] {
  const items = useData((s) => s.items);
  return useMemo(() => {
    const all = Object.values(items);
    return projectId ? all.filter((i) => i.projectId === projectId) : all;
  }, [items, projectId]);
}

export function useMe() {
  const meId = useData((s) => s.meId);
  const people = useData((s) => s.people);
  return people[meId];
}

export function isClosed(i: Item): boolean {
  return STATUS_META[i.status].group === 'closed';
}

export function progressOf(items: Item[]): { done: number; total: number; ratio: number } {
  const relevant = items.filter((i) => i.status !== 'canceled' && i.type !== 'milestone' && i.type !== 'initiative');
  const done = relevant.filter((i) => i.status === 'done').length;
  return { done, total: relevant.length, ratio: relevant.length ? done / relevant.length : 0 };
}

/** Collects every descendant of an item (for initiative/epic progress). */
export function descendantsOf(id: ID, items: Item[]): Item[] {
  const out: Item[] = [];
  const queue = [id];
  const visited = new Set<ID>([id]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const it of items) {
      if (it.parentId === cur && !visited.has(it.id)) {
        visited.add(it.id);
        out.push(it);
        queue.push(it.id);
      }
    }
  }
  return out;
}

export function refTitle(ref: Ref, s = useData.getState()): { title: string; icon?: string } | undefined {
  if (ref.kind === 'project') {
    const p = s.projects[ref.id];
    return p && { title: p.name, icon: p.icon };
  }
  const d = s.docs[ref.id];
  return d && { title: d.title, icon: d.icon ?? '📄' };
}

export function refPath(ref: Ref): string {
  if (ref.kind === 'project') return `/p/${ref.id}`;
  return `/docs/${ref.id}`;
}
