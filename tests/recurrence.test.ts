import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchoredRecurrence, nextDueDate, nextInstance, nextOccurrence, normalizeRecurrence, presetOf, recurringItemId } from '@/lib/recurrence';
import { createEmptyData, dataSnapshot, onRecurrenceSpawn, useData } from '@/lib/store';
import type { Item, Recurrence } from '@/lib/types';

const daily: Recurrence = { freq: 'daily', interval: 1 };
const weekdays: Recurrence = { freq: 'weekdays', interval: 1 };
const weekly: Recurrence = { freq: 'weekly', interval: 1 };
const monthly: Recurrence = { freq: 'monthly', interval: 1 };
const yearly: Recurrence = { freq: 'yearly', interval: 1 };

describe('recurrence math', () => {
  it('adds days and weeks', () => {
    expect(nextOccurrence('2026-01-30', daily)).toBe('2026-01-31');
    expect(nextOccurrence('2026-12-31', daily)).toBe('2027-01-01');
    expect(nextOccurrence('2026-09-27', { freq: 'daily', interval: 3 })).toBe('2026-09-30');
    expect(nextOccurrence('2026-09-21', weekly)).toBe('2026-09-28');
    expect(nextOccurrence('2026-09-21', { freq: 'weekly', interval: 2 })).toBe('2026-10-05');
    // Daylight saving changes in March and October never shift the day.
    expect(nextOccurrence('2026-03-28', daily)).toBe('2026-03-29');
    expect(nextOccurrence('2026-10-24', weekly)).toBe('2026-10-31');
  });

  it('skips weekends for weekday series', () => {
    expect(nextOccurrence('2026-09-24', weekdays)).toBe('2026-09-25'); // Thu → Fri
    expect(nextOccurrence('2026-09-25', weekdays)).toBe('2026-09-28'); // Fri → Mon
    expect(nextOccurrence('2026-09-26', weekdays)).toBe('2026-09-28'); // Sat → Mon
    expect(nextOccurrence('2026-09-27', weekdays)).toBe('2026-09-28'); // Sun → Mon
  });

  it('clamps monthly series to short months and comes back to the original day', () => {
    const endOfMonth = anchoredRecurrence(monthly, '2026-01-31')!;
    expect(endOfMonth.day).toBe(31);
    expect(nextOccurrence('2026-01-31', endOfMonth)).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', endOfMonth)).toBe('2026-03-31');
    expect(nextOccurrence('2026-03-31', endOfMonth)).toBe('2026-04-30');
    expect(nextOccurrence('2026-04-30', endOfMonth)).toBe('2026-05-31');
    // Leap year.
    expect(nextOccurrence('2028-01-31', endOfMonth)).toBe('2028-02-29');
    // Without a remembered day the series simply follows the current due date.
    expect(nextOccurrence('2026-01-31', monthly)).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', monthly)).toBe('2026-03-28');
    expect(nextOccurrence('2026-11-15', { freq: 'monthly', interval: 3 })).toBe('2027-02-15');
  });

  it('keeps Feb 29 yearly series on Feb 28 in common years', () => {
    const leap = anchoredRecurrence(yearly, '2024-02-29')!;
    expect(nextOccurrence('2024-02-29', leap)).toBe('2025-02-28');
    expect(nextOccurrence('2025-02-28', leap)).toBe('2026-02-28');
    expect(nextOccurrence('2027-02-28', leap)).toBe('2028-02-29');
    expect(nextOccurrence('2026-05-10', { freq: 'yearly', interval: 2 })).toBe('2028-05-10');
  });

  it('catches up to today instead of leaving overdue copies', () => {
    const today = '2026-09-27';
    expect(nextDueDate('2026-09-20', daily, today)).toBe('2026-09-27');
    expect(nextDueDate('2026-09-27', daily, today)).toBe('2026-09-28');
    expect(nextDueDate('2026-09-20', { freq: 'daily', interval: 3 }, today)).toBe('2026-09-29');
    expect(nextDueDate('2026-09-01', weekly, today)).toBe('2026-09-29');
    expect(nextDueDate('2026-09-17', weekdays, today)).toBe('2026-09-28');
    expect(nextDueDate('2026-06-15', monthly, today)).toBe('2026-10-15');
    expect(nextDueDate('2026-06-30', monthly, today)).toBe('2026-09-30');
    expect(nextDueDate('2026-01-31', anchoredRecurrence(monthly, '2026-01-31')!, today)).toBe('2026-09-30');
    expect(nextDueDate('2020-02-29', anchoredRecurrence(yearly, '2020-02-29')!, today)).toBe('2027-02-28');
    // A due date in the future just moves one step on.
    expect(nextDueDate('2026-10-05', monthly, today)).toBe('2026-11-05');
    expect(nextDueDate('2026-10-02', weekdays, today)).toBe('2026-10-05');
  });

  it('normalizes rules and recognizes presets', () => {
    expect(normalizeRecurrence(undefined)).toBeUndefined();
    expect(normalizeRecurrence({ freq: 'hourly', interval: 1 })).toBeUndefined();
    expect(normalizeRecurrence({ freq: 'daily', interval: 0 })).toEqual({ freq: 'daily', interval: 1 });
    expect(normalizeRecurrence({ freq: 'weekly', interval: 9999 })).toEqual({ freq: 'weekly', interval: 365 });
    expect(normalizeRecurrence({ freq: 'daily', interval: 2, day: 5 })).toEqual({ freq: 'daily', interval: 2 });
    expect(presetOf(undefined)).toBe('none');
    expect(presetOf({ freq: 'weekly', interval: 2 })).toBe('biweekly');
    expect(presetOf({ freq: 'monthly', interval: 1, day: 31 })).toBe('monthly');
    expect(presetOf({ freq: 'daily', interval: 3 })).toBe('custom');
  });

  it('derives the same id for the same task and due date', () => {
    expect(recurringItemId('it_a', '2026-10-01')).toBe(recurringItemId('it_a', '2026-10-01'));
    expect(recurringItemId('it_a', '2026-10-01')).not.toBe(recurringItemId('it_a', '2026-10-08'));
    expect(recurringItemId('it_a', '2026-10-01')).not.toBe(recurringItemId('it_b', '2026-10-01'));
    expect(recurringItemId('it_a', '2026-10-01')).toMatch(/^it_[a-z0-9]+$/);
  });

  it('copies the work but not the links of the finished round', () => {
    const item: Item = {
      id: 'it_x',
      projectId: 'p',
      type: 'bug',
      title: 'Weekly report',
      status: 'done',
      priority: 'high',
      horizon: 'now',
      assigneeId: 'ann',
      startDate: '2026-09-18',
      dueDate: '2026-09-21',
      estimate: 3,
      tags: ['ops'],
      parentId: 'it_parent',
      dependsOn: ['it_dep'],
      sprintId: 'sp',
      plane: { issueId: 'x', sequenceId: 1, projectKey: 'P', stateGroup: 'completed', syncedAt: '' } as unknown as Item['plane'],
      order: 4,
      content: [{ type: 'checkListItem', props: { checked: true }, content: 'Send' }],
      recurrence: weekly,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      completedAt: '2026-09-27T10:00:00.000Z',
    };
    const next = nextInstance(item, '2026-09-27', 'now')!;
    expect(next).toMatchObject({
      id: recurringItemId('it_x', '2026-09-28'),
      projectId: 'p',
      type: 'bug',
      title: 'Weekly report',
      status: 'planned',
      priority: 'high',
      horizon: 'now',
      assigneeId: 'ann',
      estimate: 3,
      tags: ['ops'],
      parentId: 'it_parent',
      dueDate: '2026-09-28',
      startDate: '2026-09-25',
      recurrence: weekly,
    });
    expect(next.dependsOn).toBeUndefined();
    expect(next.sprintId).toBeUndefined();
    expect(next.plane).toBeUndefined();
    expect(next.completedAt).toBeUndefined();
    expect(next.content).toEqual([{ type: 'checkListItem', props: { checked: false }, content: 'Send' }]);
    expect(nextInstance({ ...item, recurrence: undefined }, '2026-09-27', 'now')).toBeUndefined();
  });
});

/* --------------------------------- Store --------------------------------- */

const s = () => useData.getState();
let projectId = '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  const data = createEmptyData('en', 'Tester');
  data.onboarded = true;
  s().replaceAll(data);
  projectId = s().createProject({ name: 'Ops' });
});

afterEach(() => {
  onRecurrenceSpawn(undefined);
  vi.useRealTimers();
});

const itemCount = () => Object.keys(s().items).length;

describe('recurring tasks in the store', () => {
  it('needs a due date: choosing a rule without one sets it to today', () => {
    const id = s().createItem({ projectId, title: 'Standup notes', recurrence: daily });
    expect(s().items[id].dueDate).toBe('2026-09-27');
    const other = s().createItem({ projectId, title: 'Invoices' });
    s().updateItem(other, { recurrence: { freq: 'monthly', interval: 1 } });
    expect(s().items[other]).toMatchObject({ dueDate: '2026-09-27', recurrence: { freq: 'monthly', interval: 1, day: 27 } });
    s().updateItem(other, { recurrence: undefined });
    expect(s().items[other].recurrence).toBeUndefined();
  });

  it('creates the next instance when a recurring task is done', () => {
    const created: Item[][] = [];
    onRecurrenceSpawn((list) => created.push(list));
    const id = s().createItem({ projectId, title: 'Weekly report', dueDate: '2026-09-21', startDate: '2026-09-20', recurrence: weekly });
    s().updateItem(id, { status: 'done' });

    const nextId = recurringItemId(id, '2026-09-28');
    const next = s().items[nextId];
    expect(next).toMatchObject({ title: 'Weekly report', status: 'planned', dueDate: '2026-09-28', startDate: '2026-09-27', recurrence: weekly });
    expect(s().items[id].recurrence).toBeUndefined();
    expect(s().items[id].status).toBe('done');
    expect(s().activity.some((a) => a.itemId === nextId && a.kind === 'created')).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].map((i) => i.id)).toEqual([nextId]);
  });

  it('repeats every task of a bulk status change', () => {
    const a = s().createItem({ projectId, title: 'A', dueDate: '2026-09-27', recurrence: daily });
    const b = s().createItem({ projectId, title: 'B', dueDate: '2026-09-25', recurrence: weekdays });
    const c = s().createItem({ projectId, title: 'C', dueDate: '2026-09-27' });
    const before = itemCount();
    s().updateItems([a, b, c], { status: 'done' });
    expect(itemCount()).toBe(before + 2);
    expect(s().items[recurringItemId(a, '2026-09-28')]?.title).toBe('A');
    expect(s().items[recurringItemId(b, '2026-09-28')]?.title).toBe('B');
  });

  it('does not repeat again when a done task is reopened and finished again', () => {
    const id = s().createItem({ projectId, title: 'Backup check', dueDate: '2026-09-27', recurrence: daily });
    s().updateItem(id, { status: 'done' });
    const afterFirst = itemCount();
    s().updateItem(id, { status: 'in_progress' });
    s().updateItem(id, { status: 'done' });
    expect(itemCount()).toBe(afterFirst);
  });

  it('converges on one instance when two tabs finish the same task', () => {
    const id = s().createItem({ projectId, title: 'Payroll', dueDate: '2026-09-27', recurrence: monthly });
    const snapshot = dataSnapshot();
    s().updateItem(id, { status: 'done' });
    const first = Object.keys(s().items).sort();
    // The other tab starts from the same state and finishes the same task.
    s().replaceAll(snapshot);
    s().updateItem(id, { status: 'done' });
    expect(Object.keys(s().items).sort()).toEqual(first);

    // An instance that arrived from another tab first is kept, not duplicated.
    s().replaceAll(snapshot);
    const nextId = recurringItemId(id, '2026-10-27');
    const remote = { ...s().items[id], id: nextId, status: 'planned' as const, dueDate: '2026-10-27', title: 'Payroll (remote)' };
    useData.setState({ items: { ...s().items, [nextId]: remote } });
    const count = itemCount();
    s().updateItem(id, { status: 'done' });
    expect(itemCount()).toBe(count);
    expect(s().items[nextId].title).toBe('Payroll (remote)');
    expect(s().items[id].recurrence).toBeUndefined();
  });

  it('re-anchors a monthly series when the due date is moved by hand', () => {
    const id = s().createItem({ projectId, title: 'Rent', dueDate: '2026-10-31', recurrence: monthly });
    expect(s().items[id].recurrence?.day).toBe(31);
    s().updateItem(id, { dueDate: '2026-10-15' });
    expect(s().items[id].recurrence?.day).toBe(15);
  });
});

describe('schema migration', () => {
  it('adds an empty template collection to state saved before templates existed', () => {
    const old = createEmptyData('en', 'Old') as unknown as Record<string, unknown>;
    delete old.templates;
    const migrate = useData.persist.getOptions().migrate!;
    const data = migrate(old, 4) as { templates: unknown };
    expect(data.templates).toEqual({});
  });
});
