import { AnimatePresence, motion } from 'motion/react';
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Diamond, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { dateLocale, useLang, useT } from '@/lib/i18n';
import { useViewState } from '@/lib/viewState';
import { daysBetween, fromISODate, shiftISO, toISODate, todayISO, weekStartsOn } from '@/lib/dates';
import { STATUS_META } from '@/lib/constants';
import { useProjectsList } from '@/lib/selectors';
import type { ID, ISODate, Item } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Topbar } from '@/components/Topbar';
import { ViewBar, BarButton, NewButton } from '@/components/ViewBar';
import { Popover, ContextMenu } from '@/components/ui/Overlay';
import { Avatar, PageIcon } from '@/components/ui/bits';
import { TypeIcon } from '@/components/pickers/icons';
import { itemMenuEntries } from '@/components/itemMenu';

type Mode = 'month' | 'week';
interface CalSettings {
  mode: Mode;
  showItems: boolean;
  showMilestones: boolean;
  showDone: boolean;
}

const MAX_PER_DAY = 4;

export function CalendarView() {
  const t = useT();
  const lang = useLang();
  const { projectId } = useParams();
  const openCreateItem = useUI((s) => s.openCreateItem);
  const [cursor, setCursor] = useState(() => new Date());
  const [settings, setSettings] = useViewState<CalSettings>(`calendar:${projectId ?? 'all'}`, {
    mode: 'month',
    showItems: true,
    showMilestones: true,
    showDone: true,
  });
  const set = (p: Partial<CalSettings>) => setSettings((s) => ({ ...s, ...p }));
  const items = useData((s) => s.items);
  const projects = useProjectsList();

  const byDay = useMemo(() => {
    const live = new Set(projects.map((p) => p.id));
    const map = new Map<ISODate, Item[]>();
    for (const it of Object.values(items)) {
      if (!it.dueDate || it.status === 'canceled') continue;
      if (projectId ? it.projectId !== projectId : !live.has(it.projectId)) continue;
      if (it.type === 'milestone' ? !settings.showMilestones : !settings.showItems) continue;
      if (!settings.showDone && it.status === 'done') continue;
      const list = map.get(it.dueDate) ?? [];
      list.push(it);
      map.set(it.dueDate, list);
    }
    for (const list of map.values())
      list.sort(
        (a, b) =>
          Number(b.type === 'milestone') - Number(a.type === 'milestone') ||
          Number(a.status === 'done') - Number(b.status === 'done') ||
          a.order - b.order,
      );
    return map;
  }, [items, projects, projectId, settings]);

  const step = (dir: number) => setCursor((c) => (settings.mode === 'month' ? addMonths(c, dir) : addWeeks(c, dir)));
  const ws = weekStartsOn(lang);
  const title =
    settings.mode === 'month'
      ? format(cursor, 'LLLL yyyy', { locale: dateLocale(lang) })
      : `${format(startOfWeek(cursor, { weekStartsOn: ws }), 'd MMM', { locale: dateLocale(lang) })} – ${format(endOfWeek(cursor, { weekStartsOn: ws }), 'd MMM yyyy', { locale: dateLocale(lang) })}`.replace(
          /\./g,
          '',
        );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!projectId && <Topbar crumbs={[{ label: t('calendar.title'), icon: '📅' }]} />}
      <ViewBar
        value={settings.mode}
        onChange={(mode) => set({ mode })}
        tabs={[
          { value: 'month', label: t('calendar.month'), icon: <CalendarDays size={15} /> },
          { value: 'week', label: t('calendar.week'), icon: <CalendarRange size={15} /> },
        ]}
      >
        <Legend active={settings.showItems} color="blue" onClick={() => set({ showItems: !settings.showItems })}>
          {t('calendar.legend.items')}
        </Legend>
        <Legend active={settings.showMilestones} color="orange" onClick={() => set({ showMilestones: !settings.showMilestones })}>
          {t('calendar.legend.milestones')}
        </Legend>
        <Legend active={settings.showDone} color="green" onClick={() => set({ showDone: !settings.showDone })}>
          {t('status.done')}
        </Legend>
        <NewButton onClick={() => openCreateItem({ projectId, dueDate: todayISO() })}>{t('common.new')}</NewButton>
      </ViewBar>
      <div className="full-width flex h-14 shrink-0 items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold first-letter:uppercase">{title}</h2>
        <BarButton onClick={() => setCursor(new Date())}>{t('common.today')}</BarButton>
        <button onClick={() => step(-1)} aria-label="prev" className="flex h-7 w-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover">
          <ChevronLeft size={17} />
        </button>
        <button onClick={() => step(1)} aria-label="next" className="flex h-7 w-7 items-center justify-center rounded-md text-fg-2 hover:bg-hover">
          <ChevronRight size={17} />
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${settings.mode}-${title}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {settings.mode === 'month' ? (
            <MonthGrid cursor={cursor} byDay={byDay} projectId={projectId} />
          ) : (
            <WeekGrid cursor={cursor} byDay={byDay} projectId={projectId} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Legend({ active, color, children, onClick }: { active: boolean; color: string; children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex h-7 items-center gap-1.5 rounded-md px-2 text-[13.5px] transition-all hover:bg-hover', active ? 'text-fg-2' : 'text-fg-4')}
    >
      <span data-color={color} className={cn('h-2.5 w-2.5 rounded-[3px]', active ? 'tint-solid' : 'border border-fg-4')} />
      {children}
    </button>
  );
}

/** Moves an item to another day, keeping the length of its date range. */
function useMoveItem() {
  const updateItem = useData((s) => s.updateItem);
  return (id: ID, date: ISODate) => {
    const it = useData.getState().items[id];
    if (!it?.dueDate || it.dueDate === date) return;
    const delta = daysBetween(it.dueDate, date);
    updateItem(id, { dueDate: date, startDate: it.startDate ? shiftISO(it.startDate, delta) : undefined });
  };
}

function useDayDrop(iso: ISODate) {
  const move = useMoveItem();
  const [over, setOver] = useState(false);
  return {
    over,
    bind: {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('application/x-done-item')) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('application/x-done-item');
        if (id) move(id, iso);
      },
    },
  };
}

/* ---------------------------------- Month ---------------------------------- */

function MonthGrid({ cursor, byDay, projectId }: { cursor: Date; byDay: Map<ISODate, Item[]>; projectId?: ID }) {
  const lang = useLang();
  const ws = weekStartsOn(lang);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { weekStartsOn: ws }),
    end: endOfWeek(endOfMonth(cursor), { weekStartsOn: ws }),
  });
  return (
    <div className="full-width flex min-h-0 flex-1 flex-col pb-6">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="px-2 pb-1.5 text-right text-[12px] font-medium capitalize text-fg-3">
            {format(d, 'EEEEEE', { locale: dateLocale(lang) })}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 border-l border-line"
        style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(112px, 1fr))` }}
      >
        {days.map((d) => (
          <DayCell key={toISODate(d)} day={d} inMonth={isSameMonth(d, cursor)} items={byDay.get(toISODate(d)) ?? []} projectId={projectId} />
        ))}
      </div>
    </div>
  );
}

function DayCell({ day, inMonth, items, projectId }: { day: Date; inMonth: boolean; items: Item[]; projectId?: ID }) {
  const lang = useLang();
  const iso = toISODate(day);
  const today = iso === todayISO();
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const drop = useDayDrop(iso);
  return (
    <div
      {...drop.bind}
      className={cn(
        'group/day relative flex min-w-0 flex-col border-b border-r border-line p-1 transition-colors',
        !inMonth ? 'bg-subtle/60' : weekend && 'bg-subtle/30',
        drop.over && 'bg-accent-soft',
      )}
    >
      <div className="flex h-7 items-center justify-between pl-0.5">
        <QuickAdd date={iso} projectId={projectId} />
        <span
          className={cn(
            'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[13px]',
            today ? 'bg-[var(--c-red-solid)] font-semibold text-white' : inMonth ? 'text-fg-2' : 'text-fg-4',
          )}
        >
          {day.getDate() === 1 && !today ? format(day, 'd MMM', { locale: dateLocale(lang) }).replace('.', '') : day.getDate()}
        </span>
      </div>
      <div className="flex min-h-0 flex-col gap-[3px]">
        {items.slice(0, MAX_PER_DAY).map((it) => (
          <ItemChip key={it.id} item={it} />
        ))}
        {items.length > MAX_PER_DAY && <MoreItems items={items} date={iso} />}
      </div>
    </div>
  );
}

function ItemChip({ item, big }: { item: Item; big?: boolean }) {
  const openPeek = useUI((s) => s.openPeek);
  const projects = useData((s) => s.projects);
  const { projectId } = useParams();
  const drag = {
    draggable: true,
    'data-peek-keep': true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('application/x-done-item', item.id);
      e.dataTransfer.effectAllowed = 'move';
    },
  };
  const chip =
    item.type === 'milestone' ? (
      <button
        {...drag}
        onClick={() => openPeek(item.id)}
        data-color={item.status === 'done' ? 'green' : 'orange'}
        className={cn(
          'tint flex h-[22px] w-full min-w-0 items-center gap-1 rounded-[4px] px-1.5 text-left text-[12px] font-semibold hover:brightness-95',
          big && 'h-7 text-[13px]',
        )}
      >
        <Diamond size={11} className="shrink-0 fill-current" />
        <span className="truncate">{item.title}</span>
      </button>
    ) : (
      <button
        {...drag}
        onClick={() => openPeek(item.id)}
        data-color={STATUS_META[item.status].color}
        className={cn(
          'flex h-[22px] w-full min-w-0 items-center gap-1.5 rounded-[4px] border border-line bg-elevated px-1.5 text-left text-[12px] shadow-[0_1px_1px_rgba(15,15,15,0.04)] transition-colors hover:bg-hover',
          big && 'h-7 text-[13px]',
          item.status === 'done' && 'text-fg-3 line-through decoration-fg-4',
        )}
      >
        <span className="tint-solid h-1.5 w-1.5 shrink-0 rounded-full" />
        {!projectId && projects[item.projectId] ? (
          <PageIcon icon={projects[item.projectId].icon} size={11} />
        ) : (
          <TypeIcon type={item.type} size={11} />
        )}
        <span className="truncate">{item.title}</span>
      </button>
    );
  return <ContextMenu entries={itemMenuEntries(item)}>{chip}</ContextMenu>;
}

function MoreItems({ items, date }: { items: Item[]; date: ISODate }) {
  const t = useT();
  const lang = useLang();
  return (
    <Popover
      trigger={
        <button className="h-5 rounded px-1.5 text-left text-[12px] font-medium text-fg-3 hover:bg-hover">
          {t('calendar.more', { n: items.length - MAX_PER_DAY })}
        </button>
      }
    >
      <div className="w-[260px] p-2">
        <div className="mb-2 px-1 text-[13px] font-semibold first-letter:uppercase">
          {format(fromISODate(date), 'EEEE, d MMMM', { locale: dateLocale(lang) })}
        </div>
        <div className="flex flex-col gap-1">
          {items.map((it) => (
            <ItemChip key={it.id} item={it} big />
          ))}
        </div>
      </div>
    </Popover>
  );
}

function QuickAdd({ date, projectId }: { date: ISODate; projectId?: ID }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const createItem = useData((s) => s.createItem);
  const projects = useProjectsList();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 30);
  }, [open]);
  const target = projectId ?? projects[0]?.id;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button className="flex h-6 w-6 items-center justify-center rounded text-fg-3 opacity-0 transition-opacity hover:bg-hover group-hover/day:opacity-100 data-[state=open]:opacity-100">
          <Plus size={14} />
        </button>
      }
    >
      <div className="w-[280px] p-2">
        <div className="mb-1.5 px-1 text-[12px] text-fg-3">
          {t('calendar.addItem', { date: format(fromISODate(date), 'd MMMM', { locale: dateLocale(lang) }) })}
        </div>
        <input
          ref={ref}
          placeholder={t('create.placeholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v && target) createItem({ projectId: target, title: v, type: 'task', status: 'planned', dueDate: date });
              setOpen(false);
            }
          }}
          className="h-8 w-full rounded-md border border-line-strong bg-input px-2 text-[14px] outline-none focus:border-accent"
        />
      </div>
    </Popover>
  );
}

/* ----------------------------------- Week ----------------------------------- */

function WeekGrid({ cursor, byDay, projectId }: { cursor: Date; byDay: Map<ISODate, Item[]>; projectId?: ID }) {
  const lang = useLang();
  const start = startOfWeek(cursor, { weekStartsOn: weekStartsOn(lang) });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="full-width grid min-h-0 flex-1 grid-cols-7 gap-2 pb-6">
      {days.map((d) => (
        <WeekColumn key={toISODate(d)} day={d} items={byDay.get(toISODate(d)) ?? []} projectId={projectId} />
      ))}
    </div>
  );
}

function WeekColumn({ day, items, projectId }: { day: Date; items: Item[]; projectId?: ID }) {
  const lang = useLang();
  const people = useData((s) => s.people);
  const openPeek = useUI((s) => s.openPeek);
  const iso = toISODate(day);
  const today = iso === todayISO();
  const drop = useDayDrop(iso);
  return (
    <div
      {...drop.bind}
      className={cn(
        'group/day flex min-h-0 flex-col rounded-xl bg-subtle p-2 transition-colors',
        drop.over && 'bg-accent-soft',
        today && 'ring-1 ring-[var(--c-red-solid)]/40',
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12.5px] capitalize text-fg-3">{format(day, 'EEEEEE', { locale: dateLocale(lang) })}</span>
          <span
            className={cn(
              'flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[15px] font-semibold',
              today && 'bg-[var(--c-red-solid)] text-white',
            )}
          >
            {day.getDate()}
          </span>
        </div>
        <QuickAdd date={iso} projectId={projectId} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {items.map((it) => (
          <ContextMenu key={it.id} entries={itemMenuEntries(it)}>
            <button
              draggable
              data-peek-keep
              onDragStart={(e) => e.dataTransfer.setData('application/x-done-item', it.id)}
              onClick={() => openPeek(it.id)}
              data-color={it.type === 'milestone' ? 'orange' : STATUS_META[it.status].color}
              className={cn(
                'rounded-lg border border-line bg-elevated p-2 text-left shadow-sm transition-colors hover:bg-hover',
                it.type === 'milestone' && 'tint border-transparent',
              )}
            >
              <div className="flex items-start gap-1.5">
                {it.type === 'milestone' ? (
                  <Diamond size={12} className="mt-[3px] shrink-0 fill-current" />
                ) : (
                  <span className="tint-solid mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" />
                )}
                <span className={cn('text-[13px] font-medium leading-snug', it.status === 'done' && 'text-fg-3 line-through')}>{it.title}</span>
              </div>
              {it.assigneeId && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-fg-3">
                  <Avatar person={people[it.assigneeId]} size={16} />
                  <span className="truncate">{people[it.assigneeId]?.name}</span>
                </div>
              )}
            </button>
          </ContextMenu>
        ))}
      </div>
    </div>
  );
}
