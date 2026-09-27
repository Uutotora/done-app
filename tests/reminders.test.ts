import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyData, useData } from '@/lib/store';
import { OVERDUE_WINDOW_DAYS, msUntilNextDay, planReminders, reminderId } from '@/lib/reminders';
import { notificationHeadline, reminderLabel } from '@/lib/inbox';
import type { AppNotification, DataState, Item } from '@/lib/types';
// @ts-expect-error shared Node server
import { applyChanges, validateState, visibleState } from '../server/access.mjs';

const TODAY = '2026-09-26';
const NOW = '2026-09-26T09:00:00.000Z';
const ts = '2026-09-01T00:00:00.000Z';

function state(): DataState {
  const data = createEmptyData('en', 'Me');
  data.onboarded = true;
  data.people.other = { id: 'other', name: 'Other', color: 'green' };
  data.projects = {
    p1: { id: 'p1', name: 'Launch', icon: '🚀', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts },
    old: { id: 'old', name: 'Old', icon: '📦', color: 'gray', status: 'completed', order: 2, archived: true, createdAt: ts, updatedAt: ts },
  };
  return data;
}

function task(data: DataState, id: string, patch: Partial<Item> = {}): Item {
  const item: Item = {
    id,
    projectId: 'p1',
    type: 'task',
    title: id,
    status: 'in_progress',
    priority: 'none',
    tags: [],
    order: 1,
    assigneeId: data.meId,
    createdAt: ts,
    updatedAt: ts,
    ...patch,
  };
  data.items[id] = item;
  return item;
}

const plan = (data: DataState, today = TODAY, enabled = true) => planReminders(data, today, NOW, enabled);
const store = (data: DataState, list: AppNotification[]) => {
  for (const n of list) data.notifications[n.id] = n;
};

describe('due date reminders', () => {
  it('reminds about my open tasks due today, once', () => {
    const data = state();
    task(data, 'a', { dueDate: TODAY });
    task(data, 'later', { dueDate: '2026-09-30' });
    task(data, 'theirs', { dueDate: TODAY, assigneeId: 'other' });
    task(data, 'unassigned', { dueDate: TODAY, assigneeId: undefined });
    task(data, 'nodate');
    const { add, read } = plan(data);
    expect(read).toEqual([]);
    expect(add).toHaveLength(1);
    expect(add[0]).toEqual({
      id: reminderId('due', 'a', TODAY, data.meId),
      recipientId: data.meId,
      actorId: data.meId,
      kind: 'due',
      targetKind: 'item',
      targetId: 'a',
      projectId: 'p1',
      text: TODAY,
      createdAt: NOW,
    });
    // The id is bound to the task, its due date and the member, so other tabs and devices agree on it.
    expect(add[0].id).toBe(`nt_due_a_${TODAY}_${data.meId}`);
  });

  it(`reminds about overdue tasks only within the last ${OVERDUE_WINDOW_DAYS} days`, () => {
    const data = state();
    task(data, 'yesterday', { dueDate: '2026-09-25' });
    task(data, 'edge', { dueDate: '2026-09-12' });
    task(data, 'ancient', { dueDate: '2026-09-11' });
    const add = plan(data).add;
    expect(add.map((n) => [n.targetId, n.kind, n.text])).toEqual([
      ['yesterday', 'overdue', '2026-09-25'],
      ['edge', 'overdue', '2026-09-12'],
    ]);
  });

  it('skips finished tasks, archived or missing projects and invalid dates', () => {
    const data = state();
    task(data, 'done', { dueDate: TODAY, status: 'done' });
    task(data, 'canceled', { dueDate: '2026-09-20', status: 'canceled' });
    task(data, 'archived', { dueDate: TODAY, projectId: 'old' });
    task(data, 'orphan', { dueDate: TODAY, projectId: 'gone' });
    task(data, 'garbage', { dueDate: 'soon' });
    expect(plan(data).add).toEqual([]);
  });

  it('never creates a reminder that exists, even when it was read or archived', () => {
    const data = state();
    task(data, 'a', { dueDate: TODAY });
    task(data, 'b', { dueDate: '2026-09-24' });
    const first = plan(data).add;
    expect(first).toHaveLength(2);
    store(data, [
      { ...first[0], readAt: NOW },
      { ...first[1], readAt: NOW, archivedAt: NOW },
    ]);
    expect(plan(data)).toEqual({ add: [], read: [] });
  });

  it('gives a new due date its own reminder and retires the old one', () => {
    const data = state();
    task(data, 'a', { dueDate: '2026-09-24' });
    store(data, plan(data).add);
    const oldId = reminderId('overdue', 'a', '2026-09-24', data.meId);
    expect(data.notifications[oldId]).toBeDefined();

    data.items.a = { ...data.items.a, dueDate: TODAY };
    const { add, read } = plan(data);
    expect(add.map((n) => n.id)).toEqual([reminderId('due', 'a', TODAY, data.meId)]);
    expect(read).toEqual([oldId]);
  });

  it('turns yesterday’s “due today” into an “overdue” reminder', () => {
    const data = state();
    task(data, 'a', { dueDate: '2026-09-25' });
    store(data, plan(data, '2026-09-25').add);
    const { add, read } = plan(data);
    expect(add.map((n) => n.kind)).toEqual(['overdue']);
    expect(read).toEqual([reminderId('due', 'a', '2026-09-25', data.meId)]);
  });

  it('marks reminders read once the task is done, moved to later or reassigned', () => {
    const data = state();
    task(data, 'done', { dueDate: TODAY });
    task(data, 'later', { dueDate: '2026-09-23' });
    task(data, 'passed', { dueDate: TODAY });
    task(data, 'kept', { dueDate: TODAY });
    store(data, plan(data).add);
    data.items.done = { ...data.items.done, status: 'done' };
    data.items.later = { ...data.items.later, dueDate: '2026-10-01' };
    data.items.passed = { ...data.items.passed, assigneeId: 'other' };
    const { add, read } = plan(data);
    expect(add).toEqual([]);
    expect(read.sort()).toEqual(
      [
        reminderId('due', 'done', TODAY, data.meId),
        reminderId('overdue', 'later', '2026-09-23', data.meId),
        reminderId('due', 'passed', TODAY, data.meId),
      ].sort(),
    );
  });

  it('creates nothing when reminders are turned off, but still clears finished ones', () => {
    const data = state();
    task(data, 'a', { dueDate: TODAY });
    store(data, plan(data).add);
    task(data, 'b', { dueDate: TODAY });
    data.items.a = { ...data.items.a, status: 'done' };
    expect(plan(data, TODAY, false)).toEqual({ add: [], read: [reminderId('due', 'a', TODAY, data.meId)] });
  });

  it('leaves other notifications and other people’s reminders alone', () => {
    const data = state();
    task(data, 'a', { dueDate: TODAY, status: 'done' });
    store(data, [
      { id: 'n1', recipientId: data.meId, actorId: 'other', kind: 'assigned', targetKind: 'item', targetId: 'a', createdAt: ts },
      { ...plan({ ...data, meId: 'other', items: { a: { ...data.items.a, assigneeId: 'other', status: 'in_progress' } } }).add[0] },
    ]);
    expect(plan(data).read).toEqual([]);
  });

  it('waits until a few seconds after the next local midnight', () => {
    const now = new Date(2026, 8, 26, 23, 59, 0);
    expect(msUntilNextDay(now)).toBe(65_000);
    expect(msUntilNextDay(new Date(2026, 8, 26, 12, 0, 0))).toBe(12 * 3600_000 + 5000);
  });
});

describe('reminders in the store and the inbox', () => {
  const s = () => useData.getState();
  beforeEach(() => {
    const data = state();
    task(data, 'a', { dueDate: TODAY });
    task(data, 'b', { dueDate: '2026-09-20' });
    s().replaceAll(data);
  });

  it('stores only the member’s own reminders, once, and marks stale ones read', () => {
    const { add } = plan(s());
    const foreign: AppNotification = { ...add[0], id: 'nt_due_x', recipientId: 'other' };
    const fake: AppNotification = { ...add[0], id: 'nt_fake', kind: 'assigned' };
    s().addReminders([...add, foreign, fake]);
    const mine = Object.values(s().notifications);
    expect(mine.map((n) => n.id).sort()).toEqual(add.map((n) => n.id).sort());
    const before = s().notifications;
    s().addReminders(add);
    expect(s().notifications).toBe(before);

    s().updateItem('a', { status: 'done' });
    const { read } = plan(s());
    expect(read).toEqual([add[0].id]);
    s().addReminders([], read);
    expect(s().notifications[add[0].id].readAt).toBeTruthy();
    expect(s().notifications[add[1].id].readAt).toBeUndefined();
  });

  it('shows reminders without a teammate, with the due date for overdue tasks', () => {
    const [due, overdue] = plan(s()).add;
    expect(reminderLabel(due, 'en', TODAY)).toEqual({ title: 'Due today' });
    expect(reminderLabel(due, 'en', '2026-09-27')).toEqual({ title: 'Was due 26 Sep' });
    expect(reminderLabel(overdue, 'en', TODAY)).toEqual({ title: 'Overdue', detail: 'was due 20 Sep' });
    expect(reminderLabel(overdue, 'ru', TODAY)).toEqual({ title: 'Просрочено', detail: 'срок был 20 сент' });
    expect(notificationHeadline(overdue, 'en')).toBe('Overdue · was due 20 Sep');
    // A malformed date never breaks the inbox.
    expect(reminderLabel({ ...overdue, text: 'soon' }, 'en')).toEqual({ title: 'Overdue', detail: undefined });
  });
});

describe('due date reminders on the server', () => {
  type Rec = Record<string, unknown>;
  type State = Record<string, Record<string, Rec>>;
  const me = { id: 'u1', role: 'editor', projectIds: null, projectRoles: {} };
  const other = { id: 'u2', role: 'editor', projectIds: ['p1'], projectRoles: {} };
  const base = (): State => {
    const data = createEmptyData('en');
    data.projects = {
      p1: { id: 'p1', name: 'P1', icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts },
      p2: { id: 'p2', name: 'P2', icon: '📁', color: 'blue', status: 'on_track', order: 2, createdAt: ts, updatedAt: ts },
    };
    return structuredClone(data) as unknown as State;
  };
  const reminder = (user: { id: string }, extra: Rec = {}): Rec & { id: string } => ({
    id: `nt_due_t1_2026-09-26_${user.id}`,
    recipientId: user.id,
    actorId: user.id,
    kind: 'due',
    targetKind: 'item',
    targetId: 't1',
    projectId: 'p1',
    text: '2026-09-26',
    createdAt: ts,
    ...extra,
  });
  const create = (n: Rec & { id: string }) => ({ records: { notifications: { [n.id]: { before: null, after: n } } } });
  const denied = 'Insufficient permissions';

  it('uses the same id on the server and in the browser', () => {
    expect(reminder(me).id).toBe(reminderId('due', 't1', '2026-09-26', me.id));
  });

  it('lets members write reminders for themselves only', () => {
    const own = reminder(me);
    expect(applyChanges(base(), create(own), me).notifications[own.id].kind).toBe('due');
    // Another member cannot plant a reminder for someone else, or take someone else's reminder id.
    expect(() => applyChanges(base(), create({ ...reminder(other), actorId: me.id }), me)).toThrow(denied);
    expect(() => applyChanges(base(), create({ ...reminder(me), id: `nt_due_t1_2026-09-26_${other.id}` }), me)).toThrow(denied);
    expect(() => applyChanges(base(), create({ ...reminder(me), kind: 'assigned', id: `nt_due_t1_2026-09-26_${other.id}` }), me)).toThrow(denied);
    // The id must match the task, the due date and the kind.
    expect(() => applyChanges(base(), create({ ...reminder(me), targetId: 't2' }), me)).toThrow(denied);
    expect(() => applyChanges(base(), create({ ...reminder(me), kind: 'overdue' }), me)).toThrow(denied);
    expect(() => applyChanges(base(), create({ ...reminder(me), id: `nt_due_x_t1_2026-09-26_${me.id}` }), me)).toThrow(denied);
    expect(() => applyChanges(base(), create({ ...reminder(me), text: 'tomorrow', id: `nt_due_t1_tomorrow_${me.id}` }), me)).toThrow(
      'Invalid notification',
    );
  });

  it('lets the recipient read and archive a reminder, but nobody else', () => {
    const state = base();
    const own = reminder(me);
    state.notifications = { [own.id]: own };
    const read = applyChanges(
      state,
      { records: { notifications: { [own.id]: { before: own, after: { ...own, readAt: ts, archivedAt: ts } } } } },
      me,
    );
    expect(read.notifications[own.id]).toMatchObject({ readAt: ts, archivedAt: ts });
    expect(() => applyChanges(state, { records: { notifications: { [own.id]: { before: own, after: { ...own, readAt: ts } } } } }, other)).toThrow(
      denied,
    );
  });

  it('never re-addresses an existing notification', () => {
    const state = base();
    const n1: Rec = { id: 'n1', recipientId: me.id, actorId: other.id, kind: 'assigned', targetKind: 'item', targetId: 't1', createdAt: ts };
    state.notifications = { n1 };
    expect(() => applyChanges(state, { records: { notifications: { n1: { before: n1, after: { ...n1, recipientId: other.id } } } } }, me)).toThrow(
      denied,
    );
    const read = applyChanges(state, { records: { notifications: { n1: { before: n1, after: { ...n1, readAt: ts } } } } }, me);
    expect(read.notifications.n1.readAt).toBe(ts);
  });

  it('keeps read and archived marks when two tabs write the same reminder', () => {
    const state = base();
    const own = reminder(me, { readAt: ts });
    state.notifications = { [own.id]: own };
    const again = applyChanges(state, create(reminder(me, { createdAt: '2026-09-26T10:00:00.000Z' })), me);
    expect(again.notifications[own.id]).toMatchObject({ readAt: ts, kind: 'due' });
  });

  it('lets a member rewrite their own reminder after its project went out of view', () => {
    const state = base();
    const hidden = reminder(other, { projectId: 'p2', readAt: ts });
    state.notifications = { [hidden.id]: hidden };
    // The task moved from p2 (no longer visible) to p1: the browser writes the reminder again.
    const next = applyChanges(state, create(reminder(other)), other);
    expect(next.notifications[hidden.id]).toMatchObject({ projectId: 'p1', readAt: ts });
  });

  it('shows each member only their own reminders', () => {
    const state = base();
    const mine = reminder(me);
    const theirs = reminder(other);
    state.notifications = { [mine.id]: mine, [theirs.id]: theirs };
    validateState(state);
    expect(Object.keys(visibleState(state, me).notifications)).toEqual([mine.id]);
    expect(Object.keys(visibleState(state, other).notifications)).toEqual([theirs.id]);
  });
});
