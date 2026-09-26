import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyData, useData } from '@/lib/store';
import { burndown, sprintStats } from '@/lib/sprints';
import { filterItems, groupItems, EMPTY_FILTER } from '@/lib/itemQuery';
import { shiftISO, todayISO } from '@/lib/dates';

const s = () => useData.getState();
let teammate = '';
let project = '';

beforeEach(() => {
  const data = createEmptyData('en', 'Tester');
  data.onboarded = true;
  s().replaceAll(data);
  teammate = s().addPerson({ name: 'Mia Chen', color: 'green' });
  project = s().createProject({ name: 'App' });
});

describe('sprints', () => {
  it('runs a sprint and carries unfinished work into the next one', () => {
    const sprint = s().createSprint(project);
    const done = s().createItem({ projectId: project, title: 'Done', sprintId: sprint, status: 'in_progress' });
    const open = s().createItem({ projectId: project, title: 'Open', sprintId: sprint, status: 'planned' });
    s().startSprint(sprint);
    expect(s().sprints[sprint].status).toBe('active');
    // Only one sprint per project can run at a time.
    const second = s().createSprint(project);
    s().startSprint(second);
    expect(s().sprints[second].status).toBe('planned');

    s().updateItem(done, { status: 'done' });
    const next = s().completeSprint(sprint, 'next');
    expect(next).toBe(second);
    expect(s().sprints[sprint]).toMatchObject({ status: 'completed', completedCount: 1 });
    expect(s().items[open].sprintId).toBe(second);
    expect(s().items[done].sprintId).toBe(sprint);
  });

  it('returns unfinished work to the backlog and drops sprint links across projects', () => {
    const sprint = s().createSprint(project);
    const other = s().createProject({ name: 'Other' });
    const item = s().createItem({ projectId: project, title: 'Task', sprintId: sprint });
    s().startSprint(sprint);
    s().completeSprint(sprint, 'backlog');
    expect(s().items[item].sprintId).toBeUndefined();

    const fresh = s().createSprint(project);
    s().updateItem(item, { sprintId: fresh });
    s().updateItem(item, { projectId: other });
    expect(s().items[item].sprintId).toBeUndefined();
    // A sprint of another project is refused.
    s().updateItem(item, { sprintId: fresh });
    expect(s().items[item].sprintId).toBeUndefined();
  });

  it('computes progress and a burndown that ends at zero ideal work', () => {
    const start = shiftISO(todayISO(), -2);
    const sprint = s().createSprint(project, { startDate: start, endDate: shiftISO(start, 9) });
    s().createItem({ projectId: project, title: 'A', sprintId: sprint, estimate: 3, status: 'done' });
    s().createItem({ projectId: project, title: 'B', sprintId: sprint, estimate: 5 });
    const items = Object.values(s().items);
    const stats = sprintStats(s().sprints[sprint], items.filter((i) => i.sprintId === sprint));
    expect(stats.points).toEqual({ total: 8, done: 3 });
    const chart = burndown(s().sprints[sprint], items.filter((i) => i.sprintId === sprint));
    expect(chart.unit).toBe('points');
    expect(chart.points).toHaveLength(10);
    expect(chart.points.at(-1)!.ideal).toBe(0);
    expect(chart.points[2].actual).toBe(5);
    expect(chart.points[3].actual).toBeUndefined();
  });

  it('filters and groups items by sprint', () => {
    const sprint = s().createSprint(project);
    const a = s().createItem({ projectId: project, title: 'A', sprintId: sprint });
    const b = s().createItem({ projectId: project, title: 'B' });
    const items = Object.values(s().items);
    expect(filterItems(items, { ...EMPTY_FILTER, sprint: ['none'] }).map((i) => i.id)).toEqual([b]);
    const groups = groupItems(items, 'sprint', {}, true, Object.values(s().sprints));
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      [sprint, [a]],
      ['none', [b]],
    ]);
    // Saved views from before sprints existed have no sprint filter at all.
    const { sprint: _omit, ...legacy } = EMPTY_FILTER;
    expect(filterItems(items, legacy)).toHaveLength(2);
  });
});

describe('inbox notifications', () => {
  it('notifies teammates about assignments, mentions and replies, never the actor', () => {
    const item = s().createItem({ projectId: project, title: 'Spec', assigneeId: teammate });
    const mine = () => Object.values(s().notifications);
    expect(mine()).toEqual([expect.objectContaining({ kind: 'assigned', recipientId: teammate, targetId: item, actorId: s().meId })]);

    s().addComment('item', item, '@Mia Chen please review', [teammate]);
    expect(mine().filter((n) => n.kind === 'mention')).toHaveLength(1);
    // The mentioned assignee is not notified twice about the same comment.
    expect(mine().filter((n) => n.kind === 'comment')).toHaveLength(0);

    s().updateItem(item, { assigneeId: s().meId });
    expect(mine().filter((n) => n.recipientId === s().meId)).toHaveLength(0);
  });

  it('lets the recipient mark and archive only their own notifications', () => {
    const item = s().createItem({ projectId: project, title: 'Spec', assigneeId: teammate });
    const [n] = Object.values(s().notifications);
    s().markNotifications([n.id], true);
    expect(s().notifications[n.id].readAt).toBeUndefined();
    // Pretend the teammate is signed in on this device.
    useData.setState({ meId: teammate });
    s().markNotifications([n.id], true);
    expect(s().notifications[n.id].readAt).toBeDefined();
    s().archiveNotifications([n.id], true);
    expect(s().notifications[n.id].archivedAt).toBeDefined();
    expect(s().items[item].createdBy).not.toBe(teammate);
  });
});
