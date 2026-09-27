import { uncheckBlocks } from './blocks';
import type { ID, ISODate, Item, Recurrence, RecurrenceFreq } from './types';

/*
 * Recurring tasks. A task with a repeat rule gets a fresh open copy when it is done; the copy
 * takes over the rule, so reopening the finished task never creates a second copy.
 *
 * Dates are plain `yyyy-MM-dd` strings. The math works on calendar days in UTC, so time zones
 * and daylight saving never shift a due date.
 */

export const RECURRENCE_FREQS: RecurrenceFreq[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
export const MAX_INTERVAL = 365;

/** Choices of the "Repeat" picker, in menu order. */
export const RECURRENCE_PRESETS = [
  { key: 'daily', rule: { freq: 'daily', interval: 1 } },
  { key: 'weekdays', rule: { freq: 'weekdays', interval: 1 } },
  { key: 'weekly', rule: { freq: 'weekly', interval: 1 } },
  { key: 'biweekly', rule: { freq: 'weekly', interval: 2 } },
  { key: 'monthly', rule: { freq: 'monthly', interval: 1 } },
  { key: 'yearly', rule: { freq: 'yearly', interval: 1 } },
] as const satisfies readonly { key: string; rule: Recurrence }[];

export type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number]['key'];

/** Preset matching a rule, `custom` for other intervals (e.g. every 3 days) and `none` without a rule. */
export function presetOf(rule?: Recurrence): RecurrencePreset | 'custom' | 'none' {
  const r = normalizeRecurrence(rule);
  if (!r) return 'none';
  return RECURRENCE_PRESETS.find((p) => p.rule.freq === r.freq && p.rule.interval === r.interval)?.key ?? 'custom';
}

/** A valid rule or undefined. Intervals are whole numbers in 1..365; only month-based rules keep a day. */
export function normalizeRecurrence(rule: unknown): Recurrence | undefined {
  if (!rule || typeof rule !== 'object') return undefined;
  const r = rule as Partial<Recurrence>;
  if (!RECURRENCE_FREQS.includes(r.freq as RecurrenceFreq)) return undefined;
  const freq = r.freq as RecurrenceFreq;
  const interval = freq === 'weekdays' ? 1 : Math.min(MAX_INTERVAL, Math.max(1, Math.round(Number(r.interval)) || 1));
  const out: Recurrence = { freq, interval };
  if ((freq === 'monthly' || freq === 'yearly') && Number.isInteger(r.day) && r.day! >= 1 && r.day! <= 31) out.day = r.day;
  return out;
}

/** The rule as it is stored on a task due on `due`: month-based rules remember the day of month. */
export function anchoredRecurrence(rule: unknown, due: ISODate): Recurrence | undefined {
  const r = normalizeRecurrence(rule);
  if (!r) return undefined;
  return r.freq === 'monthly' || r.freq === 'yearly' ? { ...r, day: parts(due).d } : r;
}

/* ---------------------------------- Dates ---------------------------------- */

const DAY = 86400000;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function parts(date: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}
const iso = (y: number, m: number, d: number): ISODate => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const fromUtc = (ms: number): ISODate => {
  const dt = new Date(ms);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};
const utc = (date: ISODate) => {
  const { y, m, d } = parts(date);
  return Date.UTC(y, m - 1, d);
};

export function addDaysISO(date: ISODate, days: number): ISODate {
  const { y, m, d } = parts(date);
  return fromUtc(Date.UTC(y, m - 1, d + days));
}

/** Calendar days from `a` to `b`. */
export function daysBetweenISO(a: ISODate, b: ISODate): number {
  return Math.round((utc(b) - utc(a)) / DAY);
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isWeekend = (date: ISODate) => [0, 6].includes(new Date(utc(date)).getUTCDay());

/** First Monday–Friday strictly after `date`. */
function nextWeekday(date: ISODate): ISODate {
  let next = addDaysISO(date, 1);
  while (isWeekend(next)) next = addDaysISO(next, 1);
  return next;
}

/**
 * Day of month a monthly or yearly series lands on.
 *
 * Clamping: a month shorter than that day uses its last day instead, so a series on the 31st goes
 * Jan 31 → Feb 28 (Feb 29 in leap years) → Mar 31 → Apr 30, and a yearly series on Feb 29 falls on
 * Feb 28 in common years. The rule keeps the original day (`day`), which is how the series finds its
 * way back to the 31st after a short month. A due date moved by hand to another day wins over it:
 * the day is only used when the current due date is the last day of its month and falls short of it.
 */
export function anchorDay(date: ISODate, rule: Recurrence): number {
  const { y, m, d } = parts(date);
  return rule.day && rule.day > d && d === daysInMonth(y, m) ? rule.day : d;
}

function addMonths(date: ISODate, months: number, day: number): ISODate {
  const { y, m } = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return iso(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

/** The occurrence right after `date`. */
export function nextOccurrence(date: ISODate, rule: Recurrence): ISODate {
  const r = normalizeRecurrence(rule);
  if (!r) return addDaysISO(date, 1);
  switch (r.freq) {
    case 'daily':
      return addDaysISO(date, r.interval);
    case 'weekly':
      return addDaysISO(date, 7 * r.interval);
    case 'weekdays':
      return nextWeekday(date);
    case 'monthly':
      return addMonths(date, r.interval, anchorDay(date, r));
    case 'yearly':
      return addMonths(date, 12 * r.interval, anchorDay(date, r));
  }
}

/**
 * Due date of the next instance: the first occurrence after the previous due date that is not in
 * the past. A task finished late therefore does not leave a trail of overdue copies behind it.
 */
export function nextDueDate(prev: ISODate, rule: Recurrence, today: ISODate): ISODate {
  const r = normalizeRecurrence(rule);
  if (!r) return prev >= today ? addDaysISO(prev, 1) : today;
  if (r.freq === 'daily' || r.freq === 'weekly') {
    const step = r.freq === 'daily' ? r.interval : 7 * r.interval;
    const k = Math.max(1, Math.ceil(daysBetweenISO(prev, today) / step));
    return addDaysISO(prev, k * step);
  }
  if (r.freq === 'weekdays') return nextWeekday(prev >= today ? prev : addDaysISO(today, -1));
  const months = r.freq === 'monthly' ? r.interval : 12 * r.interval;
  // Every step counts from the previous due date, so clamping in one month never drifts the next ones.
  const day = anchorDay(prev, r);
  const p = parts(prev);
  const t = parts(today);
  let k = Math.max(1, Math.floor(((t.y - p.y) * 12 + (t.m - p.m)) / months));
  let next = addMonths(prev, k * months, day);
  while (next < today) next = addMonths(prev, ++k * months, day);
  return next;
}

/* -------------------------------- Instances -------------------------------- */

/** 53-bit string hash (cyrb53), used for ids that every tab derives the same way. */
function hash53(input: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const stableId = (input: string) => `${hash53(input, 1)}${hash53(input, 2)}`;

/**
 * Id of the instance that follows task `id` on `due`. Two tabs completing the same task at once
 * derive the same id, so the server merges their copies into one record instead of two.
 */
export function recurringItemId(id: ID, due: ISODate): ID {
  return `it_${stableId(`${id}|${due}`)}`;
}

/** Id of the "created" activity entry of a recurring instance, stable for the same reason. */
export function recurringActivityId(itemId: ID): ID {
  return `ac_${stableId(`${itemId}|created`)}`;
}

/**
 * The next open instance of a recurring task that was just completed, or undefined for a
 * one-off task. It copies the work itself (title, type, priority, assignee, tags, estimate,
 * horizon, description with checklists unticked, parent, project) but not the links that
 * belonged to this round: dependencies, sprint, Plane issue and completion time.
 */
export function nextInstance(item: Item, today: ISODate, ts: string): Item | undefined {
  const rule = normalizeRecurrence(item.recurrence);
  if (!rule) return undefined;
  const base = item.dueDate ?? today;
  const due = nextDueDate(base, rule, today);
  const next: Item = {
    id: recurringItemId(item.id, due),
    projectId: item.projectId,
    type: item.type,
    title: item.title,
    status: 'planned',
    priority: item.priority,
    tags: [...item.tags],
    dueDate: due,
    // Right above the finished one in a manually sorted list.
    order: item.order - 0.5,
    recurrence: rule.freq === 'monthly' || rule.freq === 'yearly' ? { ...rule, day: anchorDay(base, rule) } : rule,
    createdAt: ts,
    updatedAt: ts,
  };
  if (item.startDate) next.startDate = addDaysISO(item.startDate, daysBetweenISO(base, due));
  if (item.horizon) next.horizon = item.horizon;
  if (item.assigneeId) next.assigneeId = item.assigneeId;
  if (item.estimate != null) next.estimate = item.estimate;
  if (item.parentId) next.parentId = item.parentId;
  if (item.createdBy) next.createdBy = item.createdBy;
  if (item.content) next.content = uncheckBlocks(item.content);
  return next;
}
