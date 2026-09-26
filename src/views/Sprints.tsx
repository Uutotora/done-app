import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, CalendarRange, GripVertical, IterationCw, MoreHorizontal, Play, Plus, Target, Timer, Trash2, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useData } from '@/lib/store';
import { toast, useUI } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { useViewState } from '@/lib/viewState';
import { formatRange, todayISO, daysBetween } from '@/lib/dates';
import { averageVelocity, burndown, sprintItems, sprintStats, useProjectSprints, velocity } from '@/lib/sprints';
import { EMPTY_FILTER } from '@/lib/itemQuery';
import { PRIORITY_RANK } from '@/lib/constants';
import { riceScore } from '@/lib/rice';
import type { ID, Item, Sprint } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ViewBar, NewButton } from '@/components/ViewBar';
import { Board } from './Board';
import { Button, IconButton } from '@/components/ui/Button';
import { AutoTextarea, Avatar, Chip, EmptyState, Progress } from '@/components/ui/bits';
import { Dialog, EntriesMenu, Tooltip } from '@/components/ui/Overlay';
import { DatePicker } from '@/components/pickers/DatePicker';
import { PriorityIcon, TypeIcon } from '@/components/pickers/icons';
import { BurndownChart, VelocityChart } from '@/components/charts/SprintCharts';
import { deleteSprintWithUndo } from '@/lib/actions';

type Tab = 'current' | 'planning' | 'history';

const statusColor = (s: Sprint['status']) => (s === 'active' ? 'blue' : s === 'completed' ? 'green' : 'gray');

export function SprintsView() {
  const t = useT();
  const { projectId } = useParams();
  const sprints = useProjectSprints(projectId);
  const createSprint = useData((s) => s.createSprint);
  const [tab, setTab] = useViewState<{ v: Tab }>(`sprints:${projectId}`, { v: 'current' });

  const newSprint = () => {
    const id = createSprint(projectId!);
    if (!id) return;
    setTab({ v: 'planning' });
    toast({ message: `${t('sprint.new')}: ${useData.getState().sprints[id]?.name ?? ''}`, tone: 'success' });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewBar
        tabs={[
          { value: 'current', label: t('sprint.current'), icon: <Timer size={15} /> },
          { value: 'planning', label: t('sprint.planning'), icon: <CalendarRange size={15} /> },
          { value: 'history', label: t('sprint.history'), icon: <BarChart3 size={15} /> },
        ]}
        value={tab.v}
        onChange={(v) => setTab({ v })}
      >
        <NewButton onClick={newSprint}>
          <Plus size={15} /> {t('sprint.new')}
        </NewButton>
      </ViewBar>
      {tab.v === 'current' && (
        <CurrentSprint projectId={projectId!} sprints={sprints} onPlan={() => setTab({ v: 'planning' })} onCreate={newSprint} />
      )}
      {tab.v === 'planning' && <Planning projectId={projectId!} sprints={sprints} onCreate={newSprint} />}
      {tab.v === 'history' && <History sprints={sprints} />}
    </div>
  );
}

/* --------------------------------- Current -------------------------------- */

function CurrentSprint({ projectId, sprints, onPlan, onCreate }: { projectId: ID; sprints: Sprint[]; onPlan: () => void; onCreate: () => void }) {
  const t = useT();
  const active = sprints.find((s) => s.status === 'active');
  const next = sprints.find((s) => s.status === 'planned');
  const startSprint = useData((s) => s.startSprint);
  const [collapsed, setCollapsed] = useViewState<{ v: string[] }>(`sprintboard:${projectId}`, { v: ['idea', 'backlog', 'canceled'] });

  if (!active) {
    return (
      <EmptyState
        className="flex-1"
        icon={<IterationCw size={40} strokeWidth={1.4} />}
        title={t('sprint.noActive')}
        action={
          next ? (
            <div className="flex gap-2">
              <Button
                variant="primary"
                icon={<Play size={14} />}
                onClick={() => {
                  startSprint(next.id);
                  toast({ message: t('sprint.started'), tone: 'success' });
                }}
              >
                {t('sprint.start')} · {next.name}
              </Button>
              <Button onClick={onPlan}>{t('sprint.planning')}</Button>
            </div>
          ) : (
            <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>
              {t('sprint.createFirst')}
            </Button>
          )
        }
      >
        {t('sprint.noActiveHint')}
      </EmptyState>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="full-width pt-6">
        <SprintHeader sprint={active} />
        <SprintInsights sprint={active} onPlan={onPlan} />
      </div>
      <Board
        projectId={projectId}
        settings={{ filter: { ...EMPTY_FILTER, sprint: [active.id] }, group: 'status', collapsed: collapsed.v }}
        onCollapse={(v) => setCollapsed({ v })}
        basePatch={{ sprintId: active.id }}
      />
    </div>
  );
}

function SprintHeader({ sprint, compact }: { sprint: Sprint; compact?: boolean }) {
  const t = useT();
  const lang = useLang();
  const update = useData((s) => s.updateSprint);
  const startSprint = useData((s) => s.startSprint);
  const hasActive = useData((s) => Object.values(s.sprints).some((sp) => sp.projectId === sprint.projectId && sp.status === 'active'));
  const [completing, setCompleting] = useState(false);
  const today = todayISO();
  const left = daysBetween(today, sprint.endDate);
  const timing =
    sprint.status === 'planned'
      ? sprint.startDate > today
        ? t('sprint.startsIn', { n: daysBetween(today, sprint.startDate) })
        : ''
      : sprint.status === 'active'
        ? left > 0
          ? t('sprint.daysLeft', { n: left + 1 })
          : left === 0
            ? t('sprint.lastDay')
            : t('sprint.overdue')
        : '';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          data-color={statusColor(sprint.status)}
          className={cn('tint flex shrink-0 items-center justify-center rounded-lg', compact ? 'h-7 w-7' : 'h-9 w-9')}
        >
          <IterationCw size={compact ? 15 : 18} />
        </span>
        <input
          key={sprint.id}
          defaultValue={sprint.name}
          aria-label={t('prop.sprint')}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== sprint.name && update(sprint.id, { name: e.target.value.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={cn(
            'min-w-0 max-w-[320px] rounded-md bg-transparent px-1 font-bold tracking-[-0.01em] outline-none hover:bg-hover focus:bg-hover',
            compact ? 'text-[15px]' : 'text-[24px]',
          )}
          style={{ width: `${Math.max(6, sprint.name.length + 1)}ch` }}
        />
        <Chip color={statusColor(sprint.status)} dot>
          {t(`sprint.status.${sprint.status}`)}
        </Chip>
        <DatePicker start={sprint.startDate} end={sprint.endDate} onChange={(s, e) => s && e && update(sprint.id, { startDate: s, endDate: e })}>
          <button className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-2 transition-colors hover:bg-hover">
            <CalendarRange size={14} className="text-fg-3" />
            {formatRange(sprint.startDate, sprint.endDate, lang)}
          </button>
        </DatePicker>
        {timing && !compact && (
          <span className={cn('text-[13px]', left < 0 && sprint.status === 'active' ? 'text-[var(--c-red-text)]' : 'text-fg-3')}>{timing}</span>
        )}
        <span className="flex-1" />
        {sprint.status === 'planned' && (
          <Tooltip content={hasActive ? t('sprint.alreadyActive') : t('sprint.start')}>
            <span>
              <Button
                size={compact ? 'sm' : 'md'}
                variant={compact ? 'secondary' : 'primary'}
                icon={<Play size={14} />}
                disabled={hasActive}
                onClick={() => {
                  startSprint(sprint.id);
                  toast({ message: t('sprint.started'), tone: 'success' });
                }}
              >
                {t('sprint.start')}
              </Button>
            </span>
          </Tooltip>
        )}
        {sprint.status === 'active' && !compact && <Button onClick={() => setCompleting(true)}>{t('sprint.complete')}</Button>}
        {sprint.status !== 'active' && (
          <EntriesMenu
            align="end"
            trigger={
              <IconButton size="md" label={t('common.more')}>
                <MoreHorizontal size={16} />
              </IconButton>
            }
            entries={[
              {
                key: 'delete',
                icon: <Trash2 size={15} />,
                label: t('sprint.delete'),
                danger: true,
                onSelect: () => deleteSprintWithUndo(sprint.id),
              },
            ]}
          />
        )}
      </div>
      {!compact && (
        <div className="mt-2 flex items-start gap-2 pl-1">
          <Target size={15} className="mt-[5px] shrink-0 text-fg-3" />
          <AutoTextarea
            key={sprint.id}
            defaultValue={sprint.goal ?? ''}
            placeholder={t('sprint.goalPlaceholder')}
            aria-label={t('sprint.goal')}
            onBlur={(e) => e.target.value.trim() !== (sprint.goal ?? '') && update(sprint.id, { goal: e.target.value.trim() || undefined })}
            className="rounded-md px-1 py-0.5 text-[15px] leading-relaxed text-fg-2 placeholder:text-fg-4 hover:bg-hover focus:bg-hover"
          />
        </div>
      )}
      <CompleteDialog sprint={sprint} open={completing} onOpenChange={setCompleting} />
    </div>
  );
}

function SprintInsights({ sprint, onPlan }: { sprint: Sprint; onPlan: () => void }) {
  const t = useT();
  const allItems = useData((s) => s.items);
  const people = useData((s) => s.people);
  const items = useMemo(() => sprintItems(sprint.id, allItems), [sprint.id, allItems]);
  const stats = sprintStats(sprint, items);
  const chart = useMemo(() => burndown(sprint, items), [sprint, items]);
  const load = useMemo(() => {
    const map = new Map<ID | 'none', { open: number; done: number }>();
    for (const i of items) {
      const key = i.assigneeId && people[i.assigneeId] ? i.assigneeId : 'none';
      const v = map.get(key) ?? { open: 0, done: 0 };
      if (i.status === 'done') v.done++;
      else v.open++;
      map.set(key, v);
    }
    return [...map.entries()].sort((a, b) => b[1].open + b[1].done - (a[1].open + a[1].done));
  }, [items, people]);
  const inProgress = items.filter((i) => i.status === 'in_progress' || i.status === 'in_review').length;

  if (!items.length) {
    return (
      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong px-4 py-4 text-[14px] text-fg-3">
        {t('sprint.emptyItems')}
        <Button size="sm" onClick={onPlan}>
          {t('sprint.planning')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="rounded-xl border border-line p-4">
        <div className="mb-1 text-[14px] font-semibold">{t('sprint.burndown')}</div>
        <p className="mb-3 text-[12.5px] text-fg-3">{t('sprint.burndownHint')}</p>
        <BurndownChart points={chart.points} unit={chart.unit} scope={chart.scope} startDate={sprint.startDate} />
      </section>
      <div className="grid content-start gap-3">
        <section className="rounded-xl border border-line p-4">
          <div className="text-[12.5px] text-fg-3">{t('sprint.progressLabel')}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[30px] font-semibold leading-none tracking-tight">{Math.round(stats.ratio * 100)}%</span>
            <span className="text-[12.5px] text-fg-3">
              {stats.points
                ? t('sprint.points', { done: stats.points.done, total: stats.points.total })
                : t('sprint.progress', { done: stats.done, total: stats.total })}
            </span>
          </div>
          <Progress value={stats.ratio} color="blue" className="mt-3" height={6} />
          <div className="mt-3 flex justify-between text-[12.5px] text-fg-3">
            <span>
              {t('status.in_progress')}: <span className="font-medium text-fg-2">{inProgress}</span>
            </span>
            <span>{stats.daysLeft > 0 ? t('sprint.daysLeft', { n: stats.daysLeft }) : t('sprint.lastDay')}</span>
          </div>
        </section>
        <section className="rounded-xl border border-line p-4">
          <div className="mb-2 text-[12.5px] text-fg-3">{t('sprint.workload')}</div>
          <div className="space-y-2">
            {load.map(([id, v]) => (
              <div key={id} className="flex items-center gap-2 text-[13px]">
                <Avatar person={id === 'none' ? undefined : people[id]} size={20} />
                <span className="min-w-0 flex-1 truncate">{id === 'none' ? t('prop.unassigned') : people[id].name}</span>
                <span className="tabular-nums text-fg-3">
                  {v.done}/{v.open + v.done}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CompleteDialog({ sprint, open, onOpenChange }: { sprint: Sprint; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const allItems = useData((s) => s.items);
  const complete = useData((s) => s.completeSprint);
  const fireCelebrate = useUI((s) => s.fireCelebrate);
  const [carry, setCarry] = useState<'next' | 'backlog'>('next');
  const items = sprintItems(sprint.id, allItems);
  const open_ = items.filter((i) => i.status !== 'done');
  const done = items.length - open_.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('sprint.completeTitle', { name: sprint.name })} className="max-w-[460px]">
      <div className="p-6">
        <h2 className="text-[18px] font-semibold">{t('sprint.completeTitle', { name: sprint.name })}</h2>
        <p className="mt-2 text-[14px] text-fg-2">{t('sprint.completeSummary', { done, total: items.length, open: open_.length })}</p>
        <Progress value={items.length ? done / items.length : 0} color="green" className="mt-4" height={6} />
        {open_.length > 0 && (
          <div role="radiogroup" className="mt-5 space-y-1.5">
            {(['next', 'backlog'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={carry === v}
                onClick={() => setCarry(v)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-[14px] transition-colors',
                  carry === v ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full border-[1.5px]',
                    carry === v ? 'border-accent' : 'border-fg-4',
                  )}
                >
                  {carry === v && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                {t(v === 'next' ? 'sprint.carryNext' : 'sprint.carryBacklog')}
              </button>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={(e) => {
              complete(sprint.id, carry);
              onOpenChange(false);
              fireCelebrate(e.clientX, e.clientY);
              toast({ message: t('sprint.completed'), tone: 'success' });
            }}
          >
            {t('sprint.complete')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* --------------------------------- Planning -------------------------------- */

const DRAG_TYPE = 'application/x-done-item';

function Planning({ projectId, sprints, onCreate }: { projectId: ID; sprints: Sprint[]; onCreate: () => void }) {
  const t = useT();
  const allItems = useData((s) => s.items);
  const open = sprints.filter((s) => s.status !== 'completed');
  const openKey = open.map((s) => s.id).join();
  const backlog = useMemo(() => {
    const openIds = new Set(openKey.split(','));
    return Object.values(allItems)
      .filter(
        (i) =>
          i.projectId === projectId &&
          i.type !== 'initiative' &&
          i.type !== 'milestone' &&
          i.status !== 'done' &&
          i.status !== 'canceled' &&
          (!i.sprintId || !openIds.has(i.sprintId)),
      )
      .sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (riceScore(b.rice) ?? -1) - (riceScore(a.rice) ?? -1) || a.order - b.order,
      );
  }, [allItems, projectId, openKey]);
  const avg = averageVelocity(sprints);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="full-width grid gap-6 pb-20 pt-5 lg:grid-cols-2">
        <DropZone sprintId={undefined} className="rounded-xl">
          {(over) => (
            <section>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-[15px] font-semibold">{t('sprint.backlog')}</h2>
                <span className="text-[13px] text-fg-3">{backlog.length}</span>
              </div>
              <p className="mb-3 text-[12.5px] text-fg-3">{t('sprint.backlogHint')}</p>
              <div className={cn('rounded-xl border transition-colors', over ? 'border-accent bg-accent-soft/40' : 'border-line')}>
                <AnimatePresence initial={false}>
                  {backlog.map((item) => (
                    <PlanRow key={item.id} item={item} sprints={open} />
                  ))}
                </AnimatePresence>
                {backlog.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-fg-3">{t('work.empty')}</div>}
              </div>
            </section>
          )}
        </DropZone>
        <section className="space-y-4">
          {avg !== undefined && (
            <div className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-[12.5px] text-fg-2">
              <BarChart3 size={14} className="text-fg-3" />
              {t('sprint.capacity', { n: avg })}
            </div>
          )}
          {open.map((sp) => (
            <SprintBucket key={sp.id} sprint={sp} sprints={open} velocity={avg} />
          ))}
          <button
            onClick={onCreate}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[14px] text-fg-3 transition-colors hover:border-accent hover:bg-accent-soft/40 hover:text-accent"
          >
            <Plus size={15} /> {t('sprint.new')}
          </button>
        </section>
      </div>
    </div>
  );
}

function SprintBucket({ sprint, sprints, velocity: avg }: { sprint: Sprint; sprints: Sprint[]; velocity?: number }) {
  const t = useT();
  const allItems = useData((s) => s.items);
  const items = useMemo(
    () =>
      sprintItems(sprint.id, allItems).sort(
        (a, b) => Number(a.status === 'done') - Number(b.status === 'done') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      ),
    [sprint.id, allItems],
  );
  const over = avg !== undefined && sprint.status === 'planned' && items.length > avg;
  return (
    <DropZone sprintId={sprint.id}>
      {(isOver) => (
        <div
          className={cn(
            'rounded-xl border bg-bg p-3 transition-[border-color,box-shadow] duration-150',
            isOver ? 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]' : sprint.status === 'active' ? 'border-line-strong' : 'border-line',
          )}
        >
          <SprintHeader sprint={sprint} compact />
          <div className="mt-1 flex items-center gap-2 pl-10 text-[12px] text-fg-3">
            <span>{t('sprint.progress', { done: items.filter((i) => i.status === 'done').length, total: items.length })}</span>
            {over && <span className="rounded bg-[var(--c-orange-bg)] px-1.5 py-0.5 text-[var(--c-orange-text)]">{t('sprint.overCapacity')}</span>}
          </div>
          <div className="mt-2">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <PlanRow key={item.id} item={item} sprints={sprints} inSprint />
              ))}
            </AnimatePresence>
            {items.length === 0 && (
              <div
                className={cn(
                  'flex h-14 items-center justify-center rounded-lg border border-dashed text-[13px] transition-colors',
                  isOver ? 'border-accent text-accent' : 'border-line-strong text-fg-4',
                )}
              >
                {t('sprint.dropHere')}
              </div>
            )}
          </div>
        </div>
      )}
    </DropZone>
  );
}

function DropZone({ sprintId, children, className }: { sprintId: ID | undefined; children: (over: boolean) => ReactNode; className?: string }) {
  const update = useData((s) => s.updateItem);
  const [depth, setDepth] = useState(0);
  const accepts = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
  return (
    <div
      className={className}
      onDragEnter={(e) => accepts(e) && setDepth((d) => d + 1)}
      onDragLeave={(e) => accepts(e) && setDepth((d) => Math.max(0, d - 1))}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setDepth(0);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        const item = useData.getState().items[id];
        if (item && item.sprintId !== sprintId) update(id, { sprintId });
      }}
    >
      {children(depth > 0)}
    </div>
  );
}

function PlanRow({ item, sprints, inSprint }: { item: Item; sprints: Sprint[]; inSprint?: boolean }) {
  const t = useT();
  const people = useData((s) => s.people);
  const update = useData((s) => s.updateItem);
  const openPeek = useUI((s) => s.openPeek);
  const [dragging, setDragging] = useState(false);
  const targets = sprints.filter((s) => s.id !== item.sprintId);
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: dragging ? 0.4 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      data-peek-keep
      draggable
      onDragStartCapture={(e: React.DragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, item.id);
        e.dataTransfer.setData('text/plain', item.title);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEndCapture={() => setDragging(false)}
      className={cn(
        'group/plan flex h-10 cursor-grab items-center gap-2 border-b border-line px-2 last:border-b-0 hover:bg-hover active:cursor-grabbing',
        inSprint && 'rounded-md border-b-0',
      )}
    >
      <GripVertical size={14} className="shrink-0 text-fg-4 opacity-0 transition-opacity group-hover/plan:opacity-100" />
      <TypeIcon type={item.type} size={14} />
      <button
        onClick={() => openPeek(item.id)}
        className={cn('min-w-0 flex-1 truncate text-left text-[14px]', item.status === 'done' && 'text-fg-3 line-through')}
      >
        {item.title}
      </button>
      <PriorityIcon priority={item.priority} />
      {item.estimate != null && <span className="rounded bg-hover px-1.5 text-[11.5px] tabular-nums text-fg-2">{item.estimate}</span>}
      <Avatar person={item.assigneeId ? people[item.assigneeId] : undefined} size={20} />
      <span className="flex w-7 shrink-0 justify-end opacity-0 transition-opacity group-hover/plan:opacity-100 has-[[data-state=open]]:opacity-100">
        {inSprint ? (
          <IconButton size="sm" label={t('sprint.removeFrom')} onClick={() => update(item.id, { sprintId: undefined })}>
            <X size={14} />
          </IconButton>
        ) : targets.length ? (
          <EntriesMenu
            align="end"
            trigger={
              <IconButton size="sm" label={t('sprint.moveTo')}>
                <IterationCw size={14} />
              </IconButton>
            }
            entries={[
              { key: 'h', heading: t('sprint.moveTo') },
              ...targets.map((sp) => ({
                key: sp.id,
                icon: <IterationCw size={14} />,
                label: sp.name,
                onSelect: () => update(item.id, { sprintId: sp.id }),
              })),
            ]}
          />
        ) : null}
      </span>
    </motion.div>
  );
}

/* --------------------------------- History --------------------------------- */

function History({ sprints }: { sprints: Sprint[] }) {
  const t = useT();
  const lang = useLang();
  const data = velocity(sprints);
  const completed = sprints.filter((s) => s.status === 'completed');
  if (!completed.length) {
    return <EmptyState className="flex-1" icon={<BarChart3 size={40} strokeWidth={1.4} />} title={t('sprint.noHistory')} />;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="full-width space-y-4 pb-20 pt-5">
        <section className="rounded-xl border border-line p-4">
          <div className="text-[14px] font-semibold">{t('sprint.velocity')}</div>
          <p className="mb-3 text-[12.5px] text-fg-3">{t('sprint.velocityHint')}</p>
          <VelocityChart data={data.slice(-10)} />
        </section>
        <div className="rounded-xl border border-line">
          {completed.map((sp) => (
            <div key={sp.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <span data-color="green" className="tint flex h-7 w-7 items-center justify-center rounded-lg">
                <IterationCw size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">{sp.name}</div>
                {sp.goal && <div className="truncate text-[12.5px] text-fg-3">{sp.goal}</div>}
              </div>
              <span className="text-[12.5px] text-fg-3">{formatRange(sp.startDate, sp.endDate, lang)}</span>
              <Chip color="green">{t('sprint.finished', { n: sp.completedCount ?? 0 })}</Chip>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
