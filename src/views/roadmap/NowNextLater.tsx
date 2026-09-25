import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { AnimatePresence, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useData } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { HORIZONS, HORIZON_COLOR, PRIORITY_RANK } from '@/lib/constants';
import { riceScore } from '@/lib/rice';
import { useProjectsList } from '@/lib/selectors';
import { ItemCard } from '@/components/ItemCard';
import type { Horizon, ID, Item } from '@/lib/types';
import { cn } from '@/lib/utils';

type Col = Horizon | 'none';

/** Now / Next / Later: the roadmap format product teams actually present. */
export function NowNextLater({ projectId, showTasks }: { projectId?: ID; showTasks: boolean }) {
  const t = useT();
  const itemsRec = useData((s) => s.items);
  const updateItem = useData((s) => s.updateItem);
  const projects = useProjectsList();
  const [activeId, setActiveId] = useState<ID | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const items = useMemo(() => {
    const live = new Set(projects.map((p) => p.id));
    return Object.values(itemsRec).filter(
      (i) =>
        (projectId ? i.projectId === projectId : live.has(i.projectId)) &&
        !['canceled'].includes(i.status) &&
        i.type !== 'milestone' &&
        (showTasks || !['task', 'bug'].includes(i.type)),
    );
  }, [itemsRec, projectId, projects, showTasks]);

  const columns = useMemo(() => {
    const sortFn = (a: Item, b: Item) =>
      (riceScore(b.rice) ?? -1) - (riceScore(a.rice) ?? -1) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order;
    const out: Record<Col, Item[]> = { now: [], next: [], later: [], none: [] };
    for (const it of items) out[it.horizon ?? 'none'].push(it);
    for (const k of Object.keys(out) as Col[]) out[k].sort(sortFn);
    return out;
  }, [items]);

  const onStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const col = e.over?.id as Col | undefined;
    if (!col) return;
    const id = String(e.active.id);
    const next = col === 'none' ? undefined : col;
    if (itemsRec[id]?.horizon !== next) updateItem(id, { horizon: next });
  };

  const active = activeId ? itemsRec[activeId] : undefined;
  const cols: Col[] = [...HORIZONS, 'none'];

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActiveId(null)}>
      <div className="full-width min-h-0 flex-1 overflow-auto py-5">
        <div className="grid min-w-[980px] grid-cols-4 gap-4">
          {cols.map((c) => (
            <Column
              key={c}
              col={c}
              items={columns[c]}
              projectId={projectId ?? projects[0]?.id}
              showProject={!projectId}
              label={c === 'none' ? t('horizon.unsorted') : t(`horizon.${c}`)}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}>
        {active ? <ItemCard item={active} overlay show={{ rice: true, project: !projectId }} className="w-[280px]" /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ col, items, label, projectId, showProject }: { col: Col; items: Item[]; label: string; projectId?: ID; showProject: boolean }) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: col });
  const createItem = useData((s) => s.createItem);
  const [adding, setAdding] = useState(false);
  const color = col === 'none' ? 'gray' : HORIZON_COLOR[col];
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[420px] flex-col rounded-xl p-2 transition-colors duration-150',
        col === 'none' ? 'bg-transparent' : 'bg-subtle',
        isOver && 'bg-accent-soft ring-1 ring-accent/40',
      )}
    >
      <div className="mb-2 flex items-center gap-2 px-1.5 pt-1">
        <span data-color={color} className="tint inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[12.5px] font-semibold">
          <span className="tint-solid h-2 w-2 rounded-full" />
          {label}
        </span>
        <span className="text-[12.5px] text-fg-3">{items.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <DraggableCard key={it.id} item={it} showProject={showProject} />
          ))}
        </AnimatePresence>
        {adding ? (
          <input
            autoFocus
            placeholder={t('item.titlePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v && projectId) createItem({ projectId, title: v, type: 'feature', status: 'idea', horizon: col === 'none' ? undefined : col });
                (e.target as HTMLInputElement).value = '';
              }
              if (e.key === 'Escape') setAdding(false);
            }}
            onBlur={() => setAdding(false)}
            className="h-9 rounded-lg border border-accent bg-elevated px-2.5 text-[14px] shadow-[0_0_0_2px_var(--accent-soft)] outline-none"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
          >
            <Plus size={14} /> {t('item.newInline')}
          </button>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ item, showProject }: { item: Item; showProject: boolean }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: item.id });
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
    >
      <ItemCard ref={setNodeRef} item={item} ghost={isDragging} show={{ rice: true, project: showProject }} {...attributes} {...listeners} />
    </motion.div>
  );
}
