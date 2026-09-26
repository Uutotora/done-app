import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronsLeft, ChevronsRight, KanbanSquare, Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useT, type TKey } from '@/lib/i18n';
import { useViewState } from '@/lib/viewState';
import { useItems } from '@/lib/selectors';
import { useProjectSprints } from '@/lib/sprints';
import { EMPTY_FILTER, filterItems, groupItems, sortItems, type GroupField, type ItemFilter } from '@/lib/itemQuery';
import { HORIZON_COLOR, PRIORITY_COLOR, STATUS_META, TYPE_META } from '@/lib/constants';
import type { ColorName, ID, Item } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ViewBar, NewButton } from '@/components/ViewBar';
import { FilterButton, FilterPills, GroupButton, SearchToggle } from '@/components/QueryControls';
import { ItemCard } from '@/components/ItemCard';
import { Avatar, Chip } from '@/components/ui/bits';
import { IconButton } from '@/components/ui/Button';
import { PriorityIcon, TypeIcon } from '@/components/pickers/icons';

export interface BoardSettings {
  filter: ItemFilter;
  group: Exclude<GroupField, 'none'>;
  collapsed: string[];
}

export function BoardView() {
  const t = useT();
  const { projectId } = useParams();
  const openCreateItem = useUI((s) => s.openCreateItem);
  const [settings, setSettings] = useViewState<BoardSettings>(`board:${projectId}`, {
    filter: { ...EMPTY_FILTER, type: [] },
    group: 'status',
    collapsed: ['canceled'],
  });
  const set = (patch: Partial<BoardSettings>) => setSettings((s) => ({ ...s, ...patch }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewBar tabs={[{ value: 'board', label: t('board.title'), icon: <KanbanSquare size={15} /> }]} value="board">
        <FilterButton filter={settings.filter} onChange={(filter) => set({ filter })} />
        <GroupButton
          group={settings.group}
          fields={['status', 'priority', 'assignee', 'type', 'horizon', 'sprint']}
          onChange={(g) => g !== 'none' && set({ group: g, collapsed: g === 'status' ? ['canceled'] : [] })}
        />
        <SearchToggle value={settings.filter.search} onChange={(search) => set({ filter: { ...settings.filter, search } })} />
        <NewButton onClick={() => openCreateItem({ projectId })}>{t('common.new')}</NewButton>
      </ViewBar>
      <FilterPills filter={settings.filter} onChange={(filter) => set({ filter })} />
      <Board projectId={projectId!} settings={settings} onCollapse={(collapsed) => set({ collapsed })} />
    </div>
  );
}

export function Board({
  projectId,
  settings,
  onCollapse,
  basePatch,
}: {
  projectId: ID;
  settings: BoardSettings;
  onCollapse: (c: string[]) => void;
  /** Applied to items created inline, e.g. the sprint a sprint board shows. */
  basePatch?: Partial<Item>;
}) {
  const items = useItems(projectId);
  const people = useData((s) => s.people);
  const updateItem = useData((s) => s.updateItem);
  const reorderItems = useData((s) => s.reorderItems);
  const [dragCols, setDragCols] = useState<Record<string, ID[]> | null>(null);
  const [activeId, setActiveId] = useState<ID | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useMemo(() => sortItems(filterItems(items, settings.filter), { field: 'manual', dir: 'asc' }), [items, settings.filter]);
  const sprints = useProjectSprints(projectId);
  const groups = useMemo(() => groupItems(visible, settings.group, people, true, sprints), [visible, settings.group, people, sprints]);
  const base = useMemo(() => Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.id)])), [groups]);
  const cols = dragCols ?? base;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const findCol = (id: string): string | undefined => {
    if (id.startsWith('col:')) return id.slice(4);
    return Object.keys(cols).find((k) => cols[k].includes(id));
  };

  const onStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setActiveId(id);
    setDragCols(base);
    setOrigin(Object.keys(base).find((k) => base[k].includes(id)) ?? null);
  };

  const onOver = (e: DragOverEvent) => {
    if (!e.over) return;
    const id = String(e.active.id);
    const from = findCol(id);
    const to = findCol(String(e.over.id));
    if (!from || !to || from === to) return;
    setDragCols((prev) => {
      const c = { ...(prev ?? base) };
      c[from] = c[from].filter((x) => x !== id);
      const target = [...c[to]];
      const overIdx = target.indexOf(String(e.over!.id));
      target.splice(overIdx < 0 ? target.length : overIdx, 0, id);
      c[to] = target;
      return c;
    });
  };

  const onEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const current = dragCols ?? base;
    const to = e.over
      ? String(e.over.id).startsWith('col:')
        ? String(e.over.id).slice(4)
        : Object.keys(current).find((k) => current[k].includes(String(e.over!.id)))
      : undefined;
    let next = current;
    if (to && e.over && !String(e.over.id).startsWith('col:')) {
      const list = current[to];
      const a = list.indexOf(id);
      const b = list.indexOf(String(e.over.id));
      if (a >= 0 && b >= 0 && a !== b) next = { ...current, [to]: arrayMove(list, a, b) };
    }
    setActiveId(null);
    setDragCols(null);
    if (!to) return;
    const g = groups.find((x) => x.key === to);
    if (g && origin !== to) updateItem(id, g.patch);
    const ordered = groups.flatMap((x) => next[x.key] ?? []);
    const rest = items
      .filter((i) => !ordered.includes(i.id))
      .sort((a, b) => a.order - b.order)
      .map((i) => i.id);
    reorderItems([...ordered, ...rest]);
  };

  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onStart}
      onDragOver={onOver}
      onDragEnd={onEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragCols(null);
      }}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="full-width flex min-h-full items-start gap-3 pb-10 pt-4">
          {groups.map((g) => (
            <Column
              key={g.key}
              field={settings.group}
              groupKey={g.key}
              patch={{ ...basePatch, ...g.patch }}
              projectId={projectId}
              ids={cols[g.key] ?? []}
              byId={byId}
              collapsed={settings.collapsed.includes(g.key)}
              onToggleCollapse={() =>
                onCollapse(settings.collapsed.includes(g.key) ? settings.collapsed.filter((k) => k !== g.key) : [...settings.collapsed, g.key])
              }
              showStatus={settings.group !== 'status'}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}>
        {active ? <ItemCard item={active} overlay className="w-[272px]" show={{ status: settings.group !== 'status' }} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function useColumnLabel(field: GroupField, key: string): { label: ReactNode; color: ColorName } {
  const t = useT();
  const people = useData((s) => s.people);
  const sprint = useData((s) => s.sprints[key]);
  switch (field) {
    case 'sprint':
      return sprint
        ? { label: sprint.name, color: sprint.status === 'active' ? 'blue' : sprint.status === 'completed' ? 'green' : 'gray' }
        : { label: t('sprint.none'), color: 'gray' };
    case 'status':
      return { label: t(`status.${key}` as TKey), color: STATUS_META[key as Item['status']].color };
    case 'priority':
      return {
        label: (
          <span className="flex items-center gap-1.5">
            <PriorityIcon priority={key as Item['priority']} />
            {t(`priority.${key}` as TKey)}
          </span>
        ),
        color: PRIORITY_COLOR[key as Item['priority']],
      };
    case 'type':
      return {
        label: (
          <span className="flex items-center gap-1.5">
            <TypeIcon type={key as Item['type']} size={13} />
            {t(`type.${key}` as TKey)}
          </span>
        ),
        color: TYPE_META[key as Item['type']].color,
      };
    case 'horizon':
      return key === 'none'
        ? { label: t('horizon.unsorted'), color: 'gray' }
        : { label: t(`horizon.${key}` as TKey), color: HORIZON_COLOR[key as 'now'] };
    case 'assignee':
      return key === 'none'
        ? { label: t('prop.unassigned'), color: 'gray' }
        : {
            label: (
              <span className="flex items-center gap-1.5">
                <Avatar person={people[key]} size={16} />
                {people[key]?.name}
              </span>
            ),
            color: people[key]?.color ?? 'gray',
          };
    default:
      return { label: key, color: 'gray' };
  }
}

function Column({
  field,
  groupKey,
  patch,
  projectId,
  ids,
  byId,
  collapsed,
  onToggleCollapse,
  showStatus,
}: {
  field: GroupField;
  groupKey: string;
  patch: Partial<Item>;
  projectId: ID;
  ids: ID[];
  byId: Map<ID, Item>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  showStatus: boolean;
}) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: `col:${groupKey}` });
  const createItem = useData((s) => s.createItem);
  const [adding, setAdding] = useState(false);
  const { label, color } = useColumnLabel(field, groupKey);

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        data-color={color}
        onClick={onToggleCollapse}
        className={cn(
          'flex w-10 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-lg py-3 transition-colors hover:bg-hover',
          isOver && 'bg-accent-soft',
        )}
      >
        <ChevronsRight size={14} className="text-fg-3" />
        <span className="tint-solid h-2 w-2 rounded-full" />
        <span className="text-[12.5px] font-medium text-fg-2 [writing-mode:vertical-rl]">{label}</span>
        <span className="text-[12px] text-fg-3">{ids.length}</span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-color={color}
      className={cn(
        'group/col flex w-[284px] shrink-0 flex-col rounded-xl p-1.5 transition-colors duration-150',
        'bg-[color-mix(in_srgb,var(--tint-bg)_55%,transparent)]',
        isOver && 'ring-2 ring-accent/40',
      )}
    >
      <div className="flex h-8 items-center gap-2 px-1.5">
        <Chip color={color} dot={field === 'status' || field === 'horizon'}>
          {label}
        </Chip>
        <span className="text-[12.5px] text-fg-3">{ids.length}</span>
        <span className="flex-1" />
        <span className="flex opacity-0 transition-opacity group-hover/col:opacity-100">
          <IconButton size="sm" label="collapse" onClick={onToggleCollapse}>
            <ChevronsLeft size={14} />
          </IconButton>
          <IconButton size="sm" label={t('item.newInline')} onClick={() => setAdding(true)}>
            <Plus size={14} />
          </IconButton>
        </span>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[40px] flex-col gap-1.5 px-0.5 pb-1 pt-0.5">
          {ids.map((id) => {
            const item = byId.get(id);
            return item ? <SortableCard key={id} item={item} showStatus={showStatus} /> : null;
          })}
        </div>
      </SortableContext>
      {adding ? (
        <div className="px-0.5 pb-1">
          <textarea
            autoFocus
            rows={2}
            placeholder={t('item.titlePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const v = (e.target as HTMLTextAreaElement).value.trim();
                if (v) createItem({ projectId, title: v, type: 'task', status: 'backlog', ...patch });
                (e.target as HTMLTextAreaElement).value = '';
              }
              if (e.key === 'Escape') setAdding(false);
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) createItem({ projectId, title: v, type: 'task', status: 'backlog', ...patch });
              setAdding(false);
            }}
            className="w-full resize-none rounded-lg border border-accent bg-elevated p-2.5 text-[14px] font-medium shadow-[0_0_0_2px_var(--accent-soft)] outline-none"
          />
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
        >
          <Plus size={14} /> {t('item.newInline')}
        </button>
      )}
    </div>
  );
}

function SortableCard({ item, showStatus }: { item: Item; showStatus: boolean }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <ItemCard
      ref={setNodeRef}
      item={item}
      ghost={isDragging}
      show={{ status: showStatus }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    />
  );
}
