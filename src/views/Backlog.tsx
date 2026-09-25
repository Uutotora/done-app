import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bug,
  CalendarDays,
  ChevronRight,
  CircleDot,
  Compass,
  Flag,
  Gauge,
  GripVertical,
  Hash,
  Hourglass,
  List,
  PanelRightOpen,
  Plus,
  Send,
  Tag,
  Trash2,
  User,
  UserRound,
  X,
  Sparkles,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { useViewState } from '@/lib/viewState';
import { useHotkey } from '@/lib/hooks';
import { useItems } from '@/lib/selectors';
import { EMPTY_FILTER, filterItems, groupItems, sortItems, treeRows, type GroupField, type ItemFilter, type ItemSort } from '@/lib/itemQuery';
import { HORIZON_COLOR, PLANE_GROUP_COLOR, STATUS_META, PRIORITY_COLOR } from '@/lib/constants';
import { formatScore, riceScore } from '@/lib/rice';
import { formatRange, todayISO } from '@/lib/dates';
import { deleteItemsWithUndo, setItemStatus } from '@/lib/actions';
import { planeReady, pushItemsToPlane } from '@/lib/plane';
import type { ID, Item } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ViewBar, NewButton } from '@/components/ViewBar';
import { FilterButton, FilterPills, GroupButton, PropertiesButton, SearchToggle, SortButton } from '@/components/QueryControls';
import { Avatar, Chip, EmptyState } from '@/components/ui/bits';
import { ContextMenu, Tooltip } from '@/components/ui/Overlay';
import { HorizonPicker, PersonPicker, PriorityPicker, StatusPicker, TagChip, TagPicker, TypePicker } from '@/components/pickers/Pickers';
import { DatePicker } from '@/components/pickers/DatePicker';
import { RicePicker } from '@/components/pickers/RicePicker';
import { PriorityIcon, TypeIcon } from '@/components/pickers/icons';
import { itemMenuEntries } from '@/components/itemMenu';

type Preset = 'all' | 'mine' | 'prioritize' | 'bugs';
type Col = 'status' | 'priority' | 'assignee' | 'due' | 'rice' | 'estimate' | 'tags' | 'horizon' | 'plane';

interface BacklogSettings {
  filter: ItemFilter;
  sort: ItemSort;
  group: GroupField;
  hidden: Col[];
}

const COL_W: Record<Col, number> = {
  status: 148,
  priority: 132,
  assignee: 168,
  due: 136,
  rice: 88,
  estimate: 84,
  tags: 184,
  horizon: 118,
  plane: 112,
};
const GUTTER = 44;
const TITLE_W = 420;

export function BacklogView() {
  const t = useT();
  const { projectId } = useParams();
  const meId = useData((s) => s.meId);
  const openCreateItem = useUI((s) => s.openCreateItem);
  const [preset, setPreset] = useViewState<{ v: Preset }>(`backlog:${projectId}:preset`, { v: 'all' });

  const defaults: Record<Preset, BacklogSettings> = {
    all: { filter: { ...EMPTY_FILTER }, sort: { field: 'manual', dir: 'asc' }, group: 'none', hidden: ['estimate', 'horizon'] },
    mine: {
      filter: { ...EMPTY_FILTER, assignee: [meId], hideDone: true },
      sort: { field: 'due', dir: 'asc' },
      group: 'status',
      hidden: ['assignee', 'rice', 'horizon'],
    },
    prioritize: {
      filter: { ...EMPTY_FILTER, type: ['feature', 'epic'], hideDone: true },
      sort: { field: 'rice', dir: 'desc' },
      group: 'none',
      hidden: ['due', 'tags', 'plane'],
    },
    bugs: {
      filter: { ...EMPTY_FILTER, type: ['bug'] },
      sort: { field: 'priority', dir: 'asc' },
      group: 'status',
      hidden: ['rice', 'horizon', 'estimate'],
    },
  };
  const [settings, setSettings] = useViewState<BacklogSettings>(`backlog:${projectId}:${preset.v}`, defaults[preset.v]);
  const set = (patch: Partial<BacklogSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const tabs: { value: Preset; label: string; icon: ReactNode }[] = [
    { value: 'all', label: t('backlog.view.all'), icon: <List size={15} /> },
    { value: 'mine', label: t('backlog.view.mine'), icon: <UserRound size={15} /> },
    { value: 'prioritize', label: t('backlog.view.prioritize'), icon: <Sparkles size={15} /> },
    { value: 'bugs', label: t('backlog.view.bugs'), icon: <Bug size={15} /> },
  ];
  const columns: { key: Col; label: string; icon: ReactNode }[] = [
    { key: 'status', label: t('prop.status'), icon: <CircleDot size={14} /> },
    { key: 'priority', label: t('prop.priority'), icon: <Flag size={14} /> },
    { key: 'assignee', label: t('prop.assignee'), icon: <User size={14} /> },
    { key: 'due', label: t('prop.due'), icon: <CalendarDays size={14} /> },
    { key: 'rice', label: 'RICE', icon: <Gauge size={14} /> },
    { key: 'estimate', label: t('prop.estimate'), icon: <Hourglass size={14} /> },
    { key: 'tags', label: t('prop.tags'), icon: <Tag size={14} /> },
    { key: 'horizon', label: t('prop.horizon'), icon: <Compass size={14} /> },
    { key: 'plane', label: 'Plane', icon: <Hash size={14} /> },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewBar tabs={tabs} value={preset.v} onChange={(v) => setPreset({ v })}>
        <FilterButton filter={settings.filter} onChange={(filter) => set({ filter })} />
        <SortButton sort={settings.sort} onChange={(sort) => set({ sort })} />
        <GroupButton group={settings.group} onChange={(group) => set({ group })} />
        <SearchToggle value={settings.filter.search} onChange={(search) => set({ filter: { ...settings.filter, search } })} />
        <PropertiesButton columns={columns} hidden={settings.hidden} onChange={(hidden) => set({ hidden })} />
        <NewButton onClick={() => openCreateItem({ projectId, ...(preset.v === 'bugs' ? { type: 'bug' } : {}) })}>{t('common.new')}</NewButton>
      </ViewBar>
      <FilterPills filter={settings.filter} onChange={(filter) => set({ filter })} />
      <BacklogTable projectId={projectId!} settings={settings} columns={columns.filter((c) => !settings.hidden.includes(c.key))} />
    </div>
  );
}

/* ---------------------------------- Table ---------------------------------- */

function BacklogTable({
  projectId,
  settings,
  columns,
}: {
  projectId: ID;
  settings: BacklogSettings;
  columns: { key: Col; label: string; icon: ReactNode }[];
}) {
  const t = useT();
  const items = useItems(projectId);
  const people = useData((s) => s.people);
  const updateItem = useData((s) => s.updateItem);
  const reorderItems = useData((s) => s.reorderItems);
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [collapsedRows, setCollapsedRows] = useState<Set<ID>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [addingSub, setAddingSub] = useState<ID | null>(null);
  const [activeId, setActiveId] = useState<ID | null>(null);
  const lastClicked = useRef<ID | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useHotkey('escape', () => setSelected(new Set()), { enabled: selected.size > 0 });

  const visible = useMemo(() => sortItems(filterItems(items, settings.filter), settings.sort), [items, settings.filter, settings.sort]);
  const groups = useMemo(() => groupItems(visible, settings.group, people), [visible, settings.group, people]);
  const tree = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        rows: treeRows(g.items, (id) => !collapsedRows.has(id) || !!settings.filter.search),
      })),
    [groups, collapsedRows, settings.filter.search],
  );
  const flatIds = useMemo(() => tree.flatMap((g) => (collapsedGroups.has(g.key) ? [] : g.rows.map((r) => r.item.id))), [tree, collapsedGroups]);
  const canDrag = settings.sort.field === 'manual';
  const width = GUTTER + TITLE_W + columns.reduce((s, c) => s + COL_W[c.key], 0) + 40;

  const toggleSelect = (id: ID, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked.current) {
        const a = flatIds.indexOf(lastClicked.current);
        const b = flatIds.indexOf(id);
        if (a >= 0 && b >= 0) for (const x of flatIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClicked.current = id;
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const from = String(e.active.id);
    const to = e.over ? String(e.over.id) : null;
    if (!to || from === to) return;
    const order = [...flatIds];
    const fi = order.indexOf(from);
    const ti = order.indexOf(to);
    if (fi < 0 || ti < 0) return;
    order.splice(fi, 1);
    order.splice(ti, 0, from);
    // Keep items that are filtered out in their relative place at the end.
    const rest = items
      .filter((i) => !order.includes(i.id))
      .sort((a, b) => a.order - b.order)
      .map((i) => i.id);
    reorderItems([...order, ...rest]);
    if (settings.group !== 'none') {
      const target = groups.find((g) => g.items.some((i) => i.id === to));
      const source = groups.find((g) => g.items.some((i) => i.id === from));
      if (target && source && target.key !== source.key) updateItem(from, target.patch);
    }
  };

  if (items.length === 0) {
    return (
      <EmptyState icon="📋" title={t('backlog.title')}>
        {t('backlog.empty')}
        <div className="mt-6 w-[420px] text-left">
          <NewRow projectId={projectId} patch={{}} depth={0} autoFocus />
        </div>
      </EmptyState>
    );
  }

  const active = activeId ? items.find((i) => i.id === activeId) : undefined;

  return (
    <div className="relative min-h-0 flex-1 overflow-auto">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="full-width pb-40">
          <div style={{ minWidth: width }}>
            {/* Header */}
            <div className="sticky top-0 z-20 flex h-9 items-stretch border-b border-line bg-bg text-[13px] text-fg-3">
              <div className="flex items-center justify-center" style={{ width: GUTTER }}>
                <Checkbox
                  checked={flatIds.length > 0 && flatIds.every((id) => selected.has(id))}
                  indeterminate={selected.size > 0}
                  onChange={(v) => setSelected(v ? new Set(flatIds) : new Set())}
                  className={cn(selected.size === 0 && 'opacity-0 hover:opacity-100')}
                />
              </div>
              <HeaderCell width={TITLE_W} icon={<span className="font-serif text-[13px] font-semibold">Aa</span>} label={t('prop.title')} />
              {columns.map((c) => (
                <HeaderCell key={c.key} width={COL_W[c.key]} icon={c.icon} label={c.label} />
              ))}
            </div>

            <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
              {tree.map((g) => {
                const collapsed = collapsedGroups.has(g.key);
                return (
                  <div key={g.key}>
                    {settings.group !== 'none' && (
                      <GroupHeader
                        field={settings.group}
                        groupKey={g.key}
                        count={g.items.length}
                        collapsed={collapsed}
                        onToggle={() =>
                          setCollapsedGroups((s) => {
                            const n = new Set(s);
                            if (n.has(g.key)) n.delete(g.key);
                            else n.add(g.key);
                            return n;
                          })
                        }
                      />
                    )}
                    {!collapsed && (
                      <>
                        {g.rows.map((r) => (
                          <div key={r.item.id}>
                            <SortableRow
                              item={r.item}
                              depth={r.depth}
                              childCount={r.childCount}
                              expanded={!collapsedRows.has(r.item.id) || !!settings.filter.search}
                              columns={columns}
                              selected={selected.has(r.item.id)}
                              canDrag={canDrag}
                              onSelect={(shift) => toggleSelect(r.item.id, shift)}
                              onToggle={() =>
                                setCollapsedRows((s) => {
                                  const n = new Set(s);
                                  if (n.has(r.item.id)) n.delete(r.item.id);
                                  else n.add(r.item.id);
                                  return n;
                                })
                              }
                              onAddSub={() => {
                                setCollapsedRows((s) => {
                                  const n = new Set(s);
                                  n.delete(r.item.id);
                                  return n;
                                });
                                setAddingSub(r.item.id);
                              }}
                            />
                            {addingSub === r.item.id && (
                              <NewRow
                                projectId={projectId}
                                patch={{
                                  ...g.patch,
                                  parentId: r.item.id,
                                  type: r.item.type === 'initiative' ? 'epic' : r.item.type === 'epic' ? 'feature' : 'task',
                                }}
                                depth={r.depth + 1}
                                autoFocus
                                onClose={() => setAddingSub(null)}
                                placeholder={t('item.subtaskPlaceholder')}
                              />
                            )}
                          </div>
                        ))}
                        <NewRow projectId={projectId} patch={g.patch} depth={0} />
                      </>
                    )}
                  </div>
                );
              })}
            </SortableContext>
            {visible.length === 0 && <div className="py-10 text-center text-[14px] text-fg-3">{t('backlog.noMatches')}</div>}
            <div className="flex h-9 items-center text-[12.5px] text-fg-3" style={{ paddingLeft: GUTTER + 8 }}>
              <span className="uppercase tracking-wide text-fg-4">{t('backlog.count')}</span>
              <span className="ml-2 font-medium tabular-nums text-fg-2">{visible.length}</span>
            </div>
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}>
          {active ? (
            <div className="flex h-9 w-[420px] items-center gap-2 rounded-md bg-elevated px-3 text-[14px] shadow-lg ring-1 ring-accent/30">
              <TypeIcon type={active.type} size={14} />
              <span className="truncate">{active.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <BulkBar selected={[...selected].filter((id) => items.some((i) => i.id === id))} onClear={() => setSelected(new Set())} />
    </div>
  );
}

function HeaderCell({ width, icon, label }: { width: number; icon: ReactNode; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-r border-line px-2 last:border-r-0" style={{ width }}>
      <span className="flex w-4 justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function GroupHeader({
  field,
  groupKey,
  count,
  collapsed,
  onToggle,
}: {
  field: GroupField;
  groupKey: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const people = useData((s) => s.people);
  let label: ReactNode = groupKey;
  if (field === 'status')
    label = (
      <Chip color={STATUS_META[groupKey as Item['status']].color} dot>
        {t(`status.${groupKey}` as TKey)}
      </Chip>
    );
  if (field === 'type')
    label = (
      <span className="flex items-center gap-1.5">
        <TypeIcon type={groupKey as Item['type']} size={14} />
        {t(`type.${groupKey}` as TKey)}
      </span>
    );
  if (field === 'priority')
    label = (
      <span className="flex items-center gap-1.5">
        <PriorityIcon priority={groupKey as Item['priority']} />
        {t(`priority.${groupKey}` as TKey)}
      </span>
    );
  if (field === 'horizon')
    label =
      groupKey === 'none' ? (
        t('horizon.unsorted')
      ) : (
        <Chip color={HORIZON_COLOR[groupKey as 'now']} dot>
          {t(`horizon.${groupKey}` as TKey)}
        </Chip>
      );
  if (field === 'assignee')
    label =
      groupKey === 'none' ? (
        t('prop.unassigned')
      ) : (
        <span className="flex items-center gap-1.5">
          <Avatar person={people[groupKey]} size={18} />
          {people[groupKey]?.name}
        </span>
      );
  return (
    <div className="mt-3 flex h-9 items-center gap-1.5 text-[14px] font-medium" style={{ paddingLeft: GUTTER - 26 }}>
      <button onClick={onToggle} className="flex h-6 w-6 items-center justify-center rounded text-fg-3 hover:bg-hover">
        <ChevronRight size={14} className={cn('transition-transform duration-150', !collapsed && 'rotate-90')} />
      </button>
      {label}
      <span className="ml-1 text-[12.5px] font-normal text-fg-3">{count}</span>
    </div>
  );
}

function Checkbox({
  checked,
  indeterminate,
  onChange,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean, e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked, e);
      }}
      className={cn(
        'flex h-4 w-4 items-center justify-center rounded-[3px] border transition-all duration-100',
        checked ? 'border-accent bg-accent text-white' : 'border-fg-4 bg-bg hover:border-fg-3',
        className,
      )}
    >
      {checked ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          <path d="M2.5 6.2l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : indeterminate ? (
        <span className="h-[1.5px] w-2 rounded bg-fg-3" />
      ) : null}
    </button>
  );
}

function SortableRow(props: {
  item: Item;
  depth: number;
  childCount: number;
  expanded: boolean;
  columns: { key: Col }[];
  selected: boolean;
  canDrag: boolean;
  onSelect: (shift: boolean) => void;
  onToggle: () => void;
  onAddSub: () => void;
}) {
  const { item, canDrag } = props;
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !canDrag });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10 opacity-40')}
    >
      <Row {...props} dragHandle={canDrag ? { ...attributes, ...listeners } : undefined} />
    </div>
  );
}

function Row({
  item,
  depth,
  childCount,
  expanded,
  columns,
  selected,
  onSelect,
  onToggle,
  onAddSub,
  dragHandle,
}: {
  item: Item;
  depth: number;
  childCount: number;
  expanded: boolean;
  columns: { key: Col }[];
  selected: boolean;
  onSelect: (shift: boolean) => void;
  onToggle: () => void;
  onAddSub: () => void;
  dragHandle?: Record<string, unknown>;
}) {
  const t = useT();
  const lang = useLang();
  const people = useData((s) => s.people);
  const update = useData((s) => s.updateItem);
  const openPeek = useUI((s) => s.openPeek);
  const peekId = useUI((s) => s.peekItemId);
  const [editing, setEditing] = useState(false);
  const set = (patch: Partial<Item>) => update(item.id, patch);
  const score = riceScore(item.rice);
  const overdue = item.dueDate && item.dueDate < todayISO() && item.status !== 'done' && item.status !== 'canceled';

  const cell = (key: Col): ReactNode => {
    switch (key) {
      case 'status':
        return (
          <StatusPicker value={item.status} onChange={(v) => setItemStatus(item.id, v)}>
            <CellButton>
              <Chip color={STATUS_META[item.status].color} dot>
                {t(`status.${item.status}`)}
              </Chip>
            </CellButton>
          </StatusPicker>
        );
      case 'priority':
        return (
          <PriorityPicker value={item.priority} onChange={(v) => set({ priority: v })}>
            <CellButton>
              {item.priority !== 'none' ? (
                <span className="flex items-center gap-1.5">
                  <PriorityIcon priority={item.priority} />
                  <span data-color={PRIORITY_COLOR[item.priority]} className={cn(item.priority === 'urgent' && 'tint-text font-medium')}>
                    {t(`priority.${item.priority}`)}
                  </span>
                </span>
              ) : (
                <Empty />
              )}
            </CellButton>
          </PriorityPicker>
        );
      case 'assignee':
        return (
          <PersonPicker value={item.assigneeId} onChange={(v) => set({ assigneeId: v })}>
            <CellButton>
              {item.assigneeId && people[item.assigneeId] ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Avatar person={people[item.assigneeId]} size={20} />
                  <span className="truncate">{people[item.assigneeId].name}</span>
                </span>
              ) : (
                <Empty />
              )}
            </CellButton>
          </PersonPicker>
        );
      case 'due':
        return (
          <DatePicker start={item.startDate} end={item.dueDate} onChange={(s, e) => set({ startDate: s, dueDate: e })}>
            <CellButton>
              {item.dueDate ? (
                <span className={cn('truncate', overdue && 'font-medium text-[var(--c-red-text)]')}>
                  {formatRange(item.startDate, item.dueDate, lang)}
                </span>
              ) : (
                <Empty />
              )}
            </CellButton>
          </DatePicker>
        );
      case 'rice':
        return (
          <RicePicker value={item.rice} onChange={(r) => set({ rice: r })}>
            <CellButton className="justify-end">
              {score != null ? <span className="font-medium tabular-nums">{formatScore(score)}</span> : <Empty />}
            </CellButton>
          </RicePicker>
        );
      case 'estimate':
        return (
          <input
            type="number"
            min={0}
            value={item.estimate ?? ''}
            onChange={(e) => set({ estimate: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
            className="h-full w-full bg-transparent px-2 text-right text-[14px] tabular-nums outline-none focus:bg-hover"
          />
        );
      case 'tags':
        return (
          <TagPicker value={item.tags} onChange={(v) => set({ tags: v })}>
            <CellButton>
              {item.tags.length ? (
                <span className="flex min-w-0 gap-1 overflow-hidden">
                  {item.tags.map((tg) => (
                    <TagChip key={tg} tag={tg} />
                  ))}
                </span>
              ) : (
                <Empty />
              )}
            </CellButton>
          </TagPicker>
        );
      case 'horizon':
        return (
          <HorizonPicker value={item.horizon} onChange={(v) => set({ horizon: v })}>
            <CellButton>
              {item.horizon ? (
                <Chip color={HORIZON_COLOR[item.horizon]} dot>
                  {t(`horizon.${item.horizon}`)}
                </Chip>
              ) : (
                <Empty />
              )}
            </CellButton>
          </HorizonPicker>
        );
      case 'plane':
        return item.plane ? (
          <Tooltip content={item.plane.stateName ?? item.plane.key}>
            <span className="flex h-full items-center px-2">
              <span
                data-color={item.plane.stateGroup ? PLANE_GROUP_COLOR[item.plane.stateGroup] : 'gray'}
                className="tint inline-flex h-[22px] items-center rounded px-1.5 font-mono text-[12px] font-medium"
              >
                {item.plane.key}
              </span>
            </span>
          </Tooltip>
        ) : (
          <span className="flex h-full items-center px-2">
            <Empty />
          </span>
        );
    }
  };

  return (
    <ContextMenu
      entries={[
        ...itemMenuEntries(item).slice(0, 1),
        { key: 'sub', icon: <Plus size={15} />, label: t('backlog.addSub'), onSelect: onAddSub },
        ...itemMenuEntries(item).slice(1),
      ]}
    >
      <div
        data-peek-keep
        className={cn(
          'group/row animate-row-in flex h-[37px] items-stretch border-b border-line text-[14px] transition-colors duration-75',
          selected ? 'bg-accent-soft' : peekId === item.id ? 'bg-active' : 'hover:bg-hover',
        )}
      >
        <div className="flex shrink-0 items-center justify-end gap-0.5 pr-1" style={{ width: GUTTER }}>
          {dragHandle && (
            <span
              {...dragHandle}
              className="flex h-6 w-4 cursor-grab items-center justify-center rounded text-fg-4 opacity-0 hover:bg-active group-hover/row:opacity-100 active:cursor-grabbing"
            >
              <GripVertical size={14} />
            </span>
          )}
          <Checkbox
            checked={selected}
            onChange={(_, e) => onSelect(e.shiftKey)}
            className={cn(!selected && 'opacity-0 group-hover/row:opacity-100')}
          />
        </div>
        {/* Title */}
        <div className="relative flex shrink-0 items-center gap-1 border-r border-line pr-2" style={{ width: TITLE_W, paddingLeft: 6 + depth * 22 }}>
          {childCount > 0 ? (
            <button onClick={onToggle} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-active">
              <ChevronRight size={13} className={cn('transition-transform duration-150', expanded && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <TypePicker value={item.type} onChange={(v) => set({ type: v })}>
            <button className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-active">
              <TypeIcon type={item.type} size={14} />
            </button>
          </TypePicker>
          {editing ? (
            <input
              autoFocus
              defaultValue={item.title}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== item.title) set({ title: v });
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="h-7 min-w-0 flex-1 rounded-[4px] bg-elevated px-1.5 shadow-[0_0_0_2px_var(--accent-soft)] outline-none"
            />
          ) : (
            <>
              <span
                onClick={() => setEditing(true)}
                className={cn(
                  'min-w-0 flex-1 cursor-text truncate px-1 font-medium',
                  item.status === 'done' && 'text-fg-3 line-through decoration-fg-4',
                )}
              >
                {item.title || t('common.untitled')}
              </span>
              {childCount > 0 && <span className="shrink-0 text-[12px] text-fg-4 group-hover/row:opacity-0">{childCount}</span>}
              <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                <Tooltip content={t('backlog.addSub')}>
                  <button
                    onClick={onAddSub}
                    className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-line-strong bg-elevated text-fg-3 shadow-sm hover:bg-hover"
                  >
                    <Plus size={14} />
                  </button>
                </Tooltip>
                <button
                  onClick={() => openPeek(item.id)}
                  className="flex h-6 items-center gap-1 rounded-[5px] border border-line-strong bg-elevated px-1.5 text-[12px] font-medium text-fg-2 shadow-sm hover:bg-hover"
                >
                  <PanelRightOpen size={12} />
                  {t('item.openPeek')}
                </button>
              </span>
            </>
          )}
        </div>
        {columns.map((c) => (
          <div key={c.key} className="min-w-0 shrink-0 border-r border-line last:border-r-0" style={{ width: COL_W[c.key] }}>
            {cell(c.key)}
          </div>
        ))}
      </div>
    </ContextMenu>
  );
}

function CellButton({ children, className, ...rest }: { children: ReactNode; className?: string } & React.ComponentProps<'button'>) {
  return (
    <button {...rest} className={cn('flex h-full w-full min-w-0 items-center px-2 text-left transition-colors hover:bg-hover', className)}>
      {children}
    </button>
  );
}

function Empty() {
  return <span className="text-fg-4 opacity-0 transition-opacity group-hover/row:opacity-100">—</span>;
}

function NewRow({
  projectId,
  patch,
  depth,
  autoFocus,
  onClose,
  placeholder,
}: {
  projectId: ID;
  patch: Partial<Item>;
  depth: number;
  autoFocus?: boolean;
  onClose?: () => void;
  placeholder?: string;
}) {
  const t = useT();
  const createItem = useData((s) => s.createItem);
  const [active, setActive] = useState(!!autoFocus);
  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="flex h-[37px] w-full items-center gap-2 border-b border-line text-[14px] text-fg-4 transition-colors hover:bg-hover hover:text-fg-3"
        style={{ paddingLeft: GUTTER + 12 + depth * 22 }}
      >
        <Plus size={15} /> {t('item.newInline')}
      </button>
    );
  }
  return (
    <div className="flex h-[37px] items-center border-b border-line bg-hover/50" style={{ paddingLeft: GUTTER + 12 + depth * 22 }}>
      <Plus size={15} className="mr-2 text-fg-4" />
      <input
        autoFocus
        placeholder={placeholder ?? t('backlog.quickAdd')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value.trim();
            if (v) {
              createItem({ projectId, title: v, type: 'task', status: 'backlog', ...patch });
              (e.target as HTMLInputElement).value = '';
            }
          }
          if (e.key === 'Escape') {
            setActive(false);
            onClose?.();
          }
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v) createItem({ projectId, title: v, type: 'task', status: 'backlog', ...patch });
          setActive(false);
          onClose?.();
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-4"
      />
    </div>
  );
}

/* --------------------------------- Bulk bar --------------------------------- */

function BulkBar({ selected, onClear }: { selected: ID[]; onClear: () => void }) {
  const t = useT();
  const updateItems = useData((s) => s.updateItems);
  const planeOk = useData((s) => planeReady(s.plane.config));
  const [pushing, setPushing] = useState(false);
  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          initial={{ y: 40, opacity: 0, x: '-50%' }}
          animate={{ y: 0, opacity: 1, x: '-50%' }}
          exit={{ y: 30, opacity: 0, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          className="fixed bottom-6 left-1/2 z-40 flex h-11 items-center gap-1 rounded-xl bg-elevated px-2 text-[14px] shadow-lg"
        >
          <span className="px-2 font-medium text-accent">{t('backlog.selected', { n: selected.length })}</span>
          <span className="h-5 w-px bg-line" />
          <StatusPicker value={'backlog'} onChange={(v) => updateItems(selected, { status: v })}>
            <BulkButton icon={<CircleDot size={15} />}>{t('prop.status')}</BulkButton>
          </StatusPicker>
          <PriorityPicker value={'none'} onChange={(v) => updateItems(selected, { priority: v })}>
            <BulkButton icon={<Flag size={15} />}>{t('prop.priority')}</BulkButton>
          </PriorityPicker>
          <PersonPicker value={undefined} onChange={(v) => updateItems(selected, { assigneeId: v })}>
            <BulkButton icon={<User size={15} />}>{t('prop.assignee')}</BulkButton>
          </PersonPicker>
          <HorizonPicker value={undefined} onChange={(v) => updateItems(selected, { horizon: v })}>
            <BulkButton icon={<Compass size={15} />}>{t('prop.horizon')}</BulkButton>
          </HorizonPicker>
          {planeOk && (
            <BulkButton
              icon={<Send size={15} />}
              disabled={pushing}
              onClick={async () => {
                setPushing(true);
                const r = await pushItemsToPlane(selected);
                setPushing(false);
                toast({ message: r.message, tone: r.ok ? 'success' : 'error' });
              }}
            >
              {t('backlog.sendToPlane')}
            </BulkButton>
          )}
          <BulkButton
            icon={<Trash2 size={15} />}
            danger
            onClick={() => {
              deleteItemsWithUndo(selected);
              onClear();
            }}
          >
            {t('common.delete')}
          </BulkButton>
          <span className="h-5 w-px bg-line" />
          <Tooltip content={t('backlog.clearSelection')} shortcut="Esc">
            <button onClick={onClear} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-3 hover:bg-hover">
              <X size={16} />
            </button>
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BulkButton({
  icon,
  children,
  danger,
  ...rest
}: { icon: ReactNode; children: ReactNode; danger?: boolean } & React.ComponentProps<'button'>) {
  return (
    <button
      {...rest}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md px-2 text-fg-2 transition-colors hover:bg-hover disabled:opacity-50',
        danger && 'text-[var(--c-red-text)] hover:bg-[var(--c-red-bg)]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
