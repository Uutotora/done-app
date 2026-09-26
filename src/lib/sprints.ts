import { useMemo } from 'react';
import { useData } from './store';
import { daysBetween, shiftISO, todayISO } from './dates';
import type { ID, Item, Sprint } from './types';

const STATUS_RANK: Record<Sprint['status'], number> = { active: 0, planned: 1, completed: 2 };

/** Active sprint first, then upcoming by start date, then finished ones, newest first. */
export function sortSprints(list: Sprint[]): Sprint[] {
  return [...list].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.status === 'completed' ? b.endDate.localeCompare(a.endDate) : a.startDate.localeCompare(b.startDate)),
  );
}

export function useProjectSprints(projectId?: ID): Sprint[] {
  const sprints = useData((s) => s.sprints);
  return useMemo(() => sortSprints(Object.values(sprints).filter((sp) => sp.projectId === projectId)), [sprints, projectId]);
}

const counts = (i: Item) => i.type !== 'initiative' && i.type !== 'milestone' && i.status !== 'canceled';
const isDone = (i: Item) => i.status === 'done';

export interface SprintStats {
  total: number;
  done: number;
  /** Story points, when every item in the sprint is estimated; otherwise counts are used. */
  points?: { total: number; done: number };
  daysTotal: number;
  daysLeft: number;
  ratio: number;
}

export function sprintItems(sprintId: ID, items: Record<ID, Item> | Item[]): Item[] {
  return Object.values(items).filter((i) => i.sprintId === sprintId && counts(i));
}

export function sprintStats(sprint: Sprint, items: Item[], today = todayISO()): SprintStats {
  const list = items.filter(counts);
  const done = list.filter(isDone);
  const estimated = list.length > 0 && list.every((i) => i.estimate != null);
  const points = estimated
    ? { total: list.reduce((s, i) => s + (i.estimate ?? 0), 0), done: done.reduce((s, i) => s + (i.estimate ?? 0), 0) }
    : undefined;
  const daysTotal = Math.max(1, daysBetween(sprint.startDate, sprint.endDate) + 1);
  const daysLeft = sprint.status === 'completed' ? 0 : Math.max(0, daysBetween(today, sprint.endDate) + (today <= sprint.endDate ? 1 : 0));
  const ratio = points ? (points.total ? points.done / points.total : 0) : list.length ? done.length / list.length : 0;
  return { total: list.length, done: done.length, points, daysTotal, daysLeft, ratio };
}

export interface BurndownPoint {
  date: string;
  ideal: number;
  /** Remaining work at the end of the day; undefined for days that have not happened yet. */
  actual?: number;
}

/** Remaining work per day of the sprint: ideal straight line against what was actually completed. */
export function burndown(sprint: Sprint, items: Item[], today = todayISO()): { points: BurndownPoint[]; unit: 'points' | 'items'; scope: number } {
  const list = items.filter(counts);
  const estimated = list.length > 0 && list.every((i) => i.estimate != null);
  const weight = (i: Item) => (estimated ? (i.estimate ?? 0) : 1);
  const scope = list.reduce((s, i) => s + weight(i), 0);
  const days = Math.max(1, daysBetween(sprint.startDate, sprint.endDate) + 1);
  const last = sprint.status === 'completed' && sprint.completedAt ? sprint.completedAt.slice(0, 10) : today;
  const points: BurndownPoint[] = [];
  for (let d = 0; d < days; d++) {
    const date = shiftISO(sprint.startDate, d);
    const ideal = scope - (scope * (d + 1)) / days;
    let actual: number | undefined;
    if (date <= last) {
      const burned = list.filter((i) => isDone(i) && i.completedAt && i.completedAt.slice(0, 10) <= date).reduce((s, i) => s + weight(i), 0);
      actual = scope - burned;
    }
    points.push({ date, ideal: Math.max(0, ideal), actual });
  }
  return { points, unit: estimated ? 'points' : 'items', scope };
}

/** Items finished per completed sprint, oldest first, for the velocity chart and capacity hints. */
export function velocity(sprints: Sprint[]): { sprint: Sprint; done: number }[] {
  return sprints
    .filter((sp) => sp.status === 'completed')
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .map((sprint) => ({ sprint, done: sprint.completedCount ?? 0 }));
}

export function averageVelocity(sprints: Sprint[], last = 3): number | undefined {
  const v = velocity(sprints).slice(-last);
  return v.length ? Math.round(v.reduce((s, x) => s + x.done, 0) / v.length) : undefined;
}
