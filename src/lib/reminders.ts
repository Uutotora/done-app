import { useEffect } from 'react';
import { useData } from './store';
import { useAuth } from './auth';
import { daysBetween, todayISO } from './dates';
import { nowIso } from './utils';
import { isReminder } from './inbox';
import type { AppNotification, DataState, ID, ISODate } from './types';

/**
 * Due date reminders ("Due today", "Overdue") in the inbox.
 *
 * Each member's browser writes reminders for their own open tasks. Ids are
 * derived from the task, its due date and the member, so several tabs and
 * devices never create the same reminder twice, and a reminder that was read
 * or archived is not created again. A new due date gets its own reminders.
 */

export type ReminderKind = 'due' | 'overdue';
/** Overdue reminders are only created for tasks due within this many days, so nobody is flooded on first use. */
export const OVERDUE_WINDOW_DAYS = 14;
/** How often an open tab checks due dates, besides focus, midnight and task changes. */
export const REMINDER_INTERVAL_MS = 15 * 60 * 1000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stable id of a reminder. The server only accepts it from the member it ends with. */
export function reminderId(kind: ReminderKind, itemId: ID, dueDate: ISODate, recipientId: ID): ID {
  return `nt_${kind}_${itemId}_${dueDate}_${recipientId}`;
}

export interface ReminderPlan {
  /** New reminders to store. */
  add: AppNotification[];
  /** Unread reminders that no longer apply: the task is done, moved, reassigned or superseded. */
  read: ID[];
}

type ReminderState = Pick<DataState, 'meId' | 'items' | 'projects' | 'notifications'>;

/** Pure core: which reminders the current member should get today and which ones are stale. */
export function planReminders(s: ReminderState, today: ISODate, now: string, enabled = true): ReminderPlan {
  const add: AppNotification[] = [];
  const read: ID[] = [];
  const open = (id: ID) => {
    const item = s.items[id];
    if (!item || item.assigneeId !== s.meId || item.status === 'done' || item.status === 'canceled') return undefined;
    const project = s.projects[item.projectId];
    if (!project || project.archived || !item.dueDate || !DATE.test(item.dueDate)) return undefined;
    return item;
  };
  if (enabled) {
    for (const id of Object.keys(s.items)) {
      const item = open(id);
      if (!item?.dueDate || item.dueDate > today) continue;
      const kind: ReminderKind = item.dueDate === today ? 'due' : 'overdue';
      if (kind === 'overdue' && daysBetween(item.dueDate, today) > OVERDUE_WINDOW_DAYS) continue;
      const nid = reminderId(kind, item.id, item.dueDate, s.meId);
      if (s.notifications[nid]) continue;
      add.push({
        id: nid,
        recipientId: s.meId,
        actorId: s.meId,
        kind,
        targetKind: 'item',
        targetId: item.id,
        projectId: item.projectId,
        text: item.dueDate,
        createdAt: now,
      });
    }
  }
  for (const n of Object.values(s.notifications)) {
    if (!isReminder(n) || n.recipientId !== s.meId || n.readAt || n.archivedAt) continue;
    const item = n.targetKind === 'item' ? open(n.targetId) : undefined;
    const stale =
      !item ||
      item.dueDate !== n.text ||
      item.dueDate! > today ||
      // Yesterday's "due today" is replaced by an "overdue" reminder.
      (n.kind === 'due' && item.dueDate! < today);
    if (stale) read.push(n.id);
  }
  return { add, read };
}

/** Milliseconds until a few seconds after the next local midnight. */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Checks due dates now and stores what changed. */
export function runReminders(today = todayISO()): void {
  const mode = useAuth.getState().mode;
  if (mode !== 'signedIn' && mode !== 'local') return;
  const s = useData.getState();
  if (!s.onboarded || !s.meId) return;
  const plan = planReminders(s, today, nowIso(), s.prefs.reminders !== false);
  if (plan.add.length || plan.read.length) s.addReminders(plan.add, plan.read);
}

/**
 * Keeps reminders up to date while the app is open: after the data is loaded,
 * every 15 minutes, when the tab comes back, just after midnight and shortly
 * after tasks change (so completing a task clears its reminder right away).
 * Mounted once in the app shell.
 */
export function useReminders(): void {
  useEffect(() => {
    let soon: ReturnType<typeof setTimeout> | undefined;
    let midnight: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      clearTimeout(soon);
      soon = setTimeout(() => runReminders(), delay);
    };
    const armMidnight = () => {
      midnight = setTimeout(() => {
        runReminders();
        armMidnight();
      }, msUntilNextDay(new Date()));
    };
    const onReturn = () => {
      if (document.visibilityState === 'visible') schedule(400);
    };
    const unsubscribe = useData.subscribe((next, prev) => {
      if (next.items !== prev.items || next.projects !== prev.projects || next.prefs.reminders !== prev.prefs.reminders) schedule(1500);
    });
    const interval = setInterval(() => runReminders(), REMINDER_INTERVAL_MS);
    schedule(800);
    armMidnight();
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      unsubscribe();
      clearTimeout(soon);
      clearTimeout(midnight);
      clearInterval(interval);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, []);
}
