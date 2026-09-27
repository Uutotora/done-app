import type { CsvCell } from './csv';
import type { TFunction, TKey } from './i18n';
import { filterItems, groupItems, sortItems, treeRows, type GroupField, type ItemFilter, type ItemGroup, type ItemSort } from './itemQuery';
import { riceScore } from './rice';
import type { ID, Item, Person, Project, Sprint } from './types';

/**
 * Turns items into export tables (CSV today) with the same human-readable
 * values the views show: labels in the UI language, names instead of ids,
 * dates as yyyy-MM-dd. Views only decide which rows and columns to pass.
 */

export type ItemColumn =
  | 'title'
  | 'type'
  | 'parent'
  | 'project'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'start'
  | 'due'
  | 'sprint'
  | 'rice'
  | 'estimate'
  | 'tags'
  | 'horizon'
  | 'plane'
  | 'id';

export interface ItemExportContext {
  t: TFunction;
  items: Record<ID, Item>;
  people: Record<ID, Person>;
  sprints: Record<ID, Sprint>;
  projects: Record<ID, Project>;
}

export interface ExportRow {
  item: Item;
  /** Label of the group the row is shown in, when the view is grouped. */
  group?: string;
}

const LABEL: Record<Exclude<ItemColumn, 'id'>, TKey> = {
  title: 'prop.title',
  type: 'prop.type',
  parent: 'prop.parent',
  project: 'prop.project',
  status: 'prop.status',
  priority: 'prop.priority',
  assignee: 'prop.assignee',
  start: 'prop.start',
  due: 'prop.due',
  sprint: 'prop.sprint',
  rice: 'prop.rice',
  estimate: 'prop.estimate',
  tags: 'prop.tags',
  horizon: 'prop.horizon',
  plane: 'prop.plane',
};

export function columnLabel(col: ItemColumn, t: TFunction): string {
  return col === 'id' ? 'ID' : t(LABEL[col]);
}

const isoDate = (s?: string): string => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '');
const titleOf = (item: Item | undefined, t: TFunction): string => item?.title.trim() || t('common.untitled');

export function itemCell(item: Item, col: ItemColumn, ctx: ItemExportContext): CsvCell {
  const { t } = ctx;
  switch (col) {
    case 'title':
      return titleOf(item, t);
    case 'type':
      return t(`type.${item.type}` as TKey);
    case 'parent':
      return item.parentId && ctx.items[item.parentId] ? titleOf(ctx.items[item.parentId], t) : '';
    case 'project': {
      const project = ctx.projects[item.projectId];
      return project ? project.name.trim() || t('project.untitled') : '';
    }
    case 'status':
      return t(`status.${item.status}` as TKey);
    case 'priority':
      // The views leave "no priority" blank, so the export does too.
      return item.priority && item.priority !== 'none' ? t(`priority.${item.priority}` as TKey) : '';
    case 'assignee':
      return (item.assigneeId && ctx.people[item.assigneeId]?.name) || '';
    case 'start':
      return isoDate(item.startDate);
    case 'due':
      return isoDate(item.dueDate);
    case 'sprint':
      return (item.sprintId && ctx.sprints[item.sprintId]?.name) || '';
    case 'rice':
      return riceScore(item.rice) ?? '';
    case 'estimate':
      return typeof item.estimate === 'number' && Number.isFinite(item.estimate) ? item.estimate : '';
    case 'tags':
      return (item.tags ?? []).join(', ');
    case 'horizon':
      return item.horizon ? t(`horizon.${item.horizon}` as TKey) : '';
    case 'plane':
      return item.plane?.key ?? '';
    case 'id':
      return item.id;
  }
}

/** Header plus one line per row; with `withGroup` the group label comes first. */
export function itemTable(rows: ExportRow[], columns: ItemColumn[], ctx: ItemExportContext, withGroup = false): CsvCell[][] {
  const header: CsvCell[] = [...(withGroup ? [ctx.t('export.group')] : []), ...columns.map((c) => columnLabel(c, ctx.t))];
  return [header, ...rows.map((r) => [...(withGroup ? [r.group ?? ''] : []), ...columns.map((c) => itemCell(r.item, c, ctx))])];
}

/** Human label of a group key produced by groupItems(). */
export function groupLabel(field: GroupField, key: string, ctx: ItemExportContext): string {
  const { t } = ctx;
  switch (field) {
    case 'none':
      return '';
    case 'status':
      return t(`status.${key}` as TKey);
    case 'type':
      return t(`type.${key}` as TKey);
    case 'priority':
      return t(`priority.${key}` as TKey);
    case 'horizon':
      return key === 'none' ? t('horizon.unsorted') : t(`horizon.${key}` as TKey);
    case 'assignee':
      return key === 'none' ? t('prop.unassigned') : (ctx.people[key]?.name ?? '');
    case 'sprint':
      return key === 'none' ? t('sprint.none') : (ctx.sprints[key]?.name ?? '');
  }
}

/**
 * Flattens groups in display order. With `tree`, sub-items follow their
 * parent like in the backlog table, all expanded.
 */
export function groupedRows(groups: ItemGroup[], field: GroupField, ctx: ItemExportContext, tree = true): ExportRow[] {
  return groups.flatMap((g) => {
    const group = field === 'none' ? undefined : groupLabel(field, g.key, ctx);
    const items = tree ? treeRows(g.items, () => true).map((r) => r.item) : g.items;
    return items.map((item) => ({ item, group }));
  });
}

export interface RowQuery {
  filter: ItemFilter;
  sort: ItemSort;
  group: GroupField;
}

/**
 * The rows a backlog-style view shows, in display order: filtered (search
 * included), sorted, grouped. `sprints` are the project's sprints in display
 * order, as groupItems() expects.
 */
export function queryRows(items: Item[], query: RowQuery, ctx: ItemExportContext, sprints: Sprint[] = [], tree = true): ExportRow[] {
  const visible = sortItems(filterItems(items, query.filter), query.sort);
  return groupedRows(groupItems(visible, query.group, ctx.people, false, sprints), query.group, ctx, tree);
}

/**
 * Only the selected rows, in display order. Selected items hidden by the
 * current filter still count (bulk actions apply to them too) and go last.
 */
export function pickRows(rows: ExportRow[], ids: Iterable<ID>, items: Record<ID, Item>): ExportRow[] {
  const wanted = new Set(ids);
  const out = rows.filter((r) => wanted.has(r.item.id));
  const seen = new Set(out.map((r) => r.item.id));
  for (const id of wanted) if (!seen.has(id) && items[id]) out.push({ item: items[id] });
  return out;
}

export type BacklogColumn = 'status' | 'priority' | 'assignee' | 'due' | 'sprint' | 'rice' | 'estimate' | 'tags' | 'horizon' | 'plane';

/** Backlog export columns: title, type and parent, then the visible columns in order, then the id. */
export function backlogColumns(visible: BacklogColumn[]): ItemColumn[] {
  return ['title', 'type', 'parent', ...visible.flatMap<ItemColumn>((c) => (c === 'due' ? ['start', 'due'] : [c])), 'id'];
}

export const MY_WORK_COLUMNS: ItemColumn[] = ['title', 'type', 'project', 'status', 'priority', 'assignee', 'start', 'due', 'id'];

export const BOARD_COLUMNS: ItemColumn[] = [
  'title',
  'type',
  'parent',
  'status',
  'priority',
  'assignee',
  'start',
  'due',
  'sprint',
  'estimate',
  'tags',
  'plane',
  'id',
];
