import { uncheckBlocks } from './blocks';
import { normalizeRecurrence } from './recurrence';
import type { ID, Item, ItemStatus, ItemTemplate, ItemType, Person } from './types';

/** Same limit as the server check (server/access.mjs). */
export const TEMPLATE_SUBTASK_LIMIT = 50;
const TITLE_LIMIT = 500;

/** Statuses worth starting a new task in; a template never starts tasks as done or in progress. */
const START_STATUSES: ItemStatus[] = ['idea', 'backlog', 'planned'];

/** Type of a sub-task created under a parent of the given type, as in the side peek. */
export const childType = (type: ItemType): ItemType => (type === 'initiative' ? 'epic' : type === 'epic' ? 'feature' : 'task');

/** Trims sub-task titles, drops empty ones and keeps the rule valid, so every template saves cleanly. */
export function sanitizeTemplate<T extends Partial<ItemTemplate>>(tpl: T): T {
  const out: Partial<ItemTemplate> = { ...tpl };
  if (out.subtasks !== undefined) {
    const titles = Array.isArray(out.subtasks) ? out.subtasks : [];
    out.subtasks = titles
      .map((title) => String(title ?? '').trim().slice(0, TITLE_LIMIT))
      .filter(Boolean)
      .slice(0, TEMPLATE_SUBTASK_LIMIT);
  }
  if (out.recurrence !== undefined) out.recurrence = normalizeRecurrence(out.recurrence);
  if (out.recurrence === undefined) delete out.recurrence;
  if (out.tags !== undefined) out.tags = Array.isArray(out.tags) ? out.tags.filter((tag) => typeof tag === 'string') : [];
  return out as T;
}

/** Templates offered in a project: its own first, then the ones shared by every project. */
export function templatesFor(templates: Record<ID, ItemTemplate>, projectId?: ID): ItemTemplate[] {
  const byName = (a: ItemTemplate, b: ItemTemplate) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt);
  const list = Object.values(templates ?? {});
  return [
    ...(projectId ? list.filter((t) => t.projectId === projectId).sort(byName) : []),
    ...list.filter((t) => !t.projectId).sort(byName),
  ];
}

/** Task fields a template fills in. People who left the workspace are not assigned. */
export function itemFromTemplate(tpl: ItemTemplate, people: Record<ID, Person> = {}): Partial<Item> {
  const assignee = tpl.assigneeId ? people[tpl.assigneeId] : undefined;
  const out: Partial<Item> = {
    type: tpl.type,
    priority: tpl.priority,
    tags: [...(tpl.tags ?? [])],
  };
  if (tpl.status && START_STATUSES.includes(tpl.status)) out.status = tpl.status;
  if (tpl.estimate != null) out.estimate = tpl.estimate;
  if (assignee && !assignee.removed && !assignee.access?.suspended) out.assigneeId = assignee.id;
  if (tpl.horizon) out.horizon = tpl.horizon;
  const rule = normalizeRecurrence(tpl.recurrence);
  if (rule) out.recurrence = rule;
  if (tpl.content?.length) out.content = uncheckBlocks(tpl.content);
  return out;
}

/** A template built from a task: its fields, description and the titles of its direct sub-tasks. */
export function templateFromItem(item: Item, children: Item[], name: string): Omit<ItemTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  const tpl: Omit<ItemTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
    projectId: item.projectId,
    name: name.trim() || item.title,
    type: item.type,
    priority: item.priority,
    tags: [...item.tags],
  };
  if (START_STATUSES.includes(item.status)) tpl.status = item.status;
  if (item.estimate != null) tpl.estimate = item.estimate;
  if (item.assigneeId) tpl.assigneeId = item.assigneeId;
  if (item.horizon) tpl.horizon = item.horizon;
  const rule = normalizeRecurrence(item.recurrence);
  if (rule) tpl.recurrence = { freq: rule.freq, interval: rule.interval };
  if (item.content?.length) tpl.content = uncheckBlocks(item.content);
  const titles = [...children].sort((a, b) => a.order - b.order).map((c) => c.title);
  if (titles.length) tpl.subtasks = titles;
  return sanitizeTemplate(tpl);
}
