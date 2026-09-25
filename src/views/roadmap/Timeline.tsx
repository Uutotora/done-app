import { AnimatePresence, motion } from 'motion/react';
import { addDays, differenceInCalendarDays, eachMonthOfInterval, endOfMonth, format, getDay, startOfMonth, startOfWeek, getQuarter } from 'date-fns';
import { ChevronRight, Diamond, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { dateLocale, useLang, useT, type TKey } from '@/lib/i18n';
import { formatRange, fromISODate, shiftISO, toISODate, todayISO } from '@/lib/dates';
import { ITEM_TYPES, STATUSES, STATUS_META } from '@/lib/constants';
import { descendantsOf, progressOf, useProjectsList } from '@/lib/selectors';
import { Avatar, PageIcon } from '@/components/ui/bits';
import { TypeIcon, StatusIcon } from '@/components/pickers/icons';
import type { ID, ISODate, Item } from '@/lib/types';
import { cn } from '@/lib/utils';

export type Zoom = 'week' | 'month' | 'quarter';
export type GroupBy = 'initiative' | 'type' | 'status' | 'project' | 'none';

const DAY_W: Record<Zoom, number> = { week: 38, month: 13, quarter: 4.2 };
const ROW_H = 36;
const LEFT_W = 300;
const HEADER_H = 54;

type Row =
  | { kind: 'group'; key: string; label: string; icon?: ReactNode; count: number; collapsed: boolean; item?: Item; defaults: Partial<Item> }
  | { kind: 'item'; key: string; item: Item; depth: number; hasChildren: boolean; expanded: boolean }
  | { kind: 'milestones'; key: string; items: Item[] }
  | { kind: 'add'; key: string; defaults: Partial<Item>; depth: number };

interface DragState {
  id: ID;
  mode: 'move' | 'start' | 'end';
  originX: number;
  start: ISODate;
  end: ISODate;
  delta: number;
  moved: boolean;
}

export function Timeline({ projectId, zoom, groupBy, showTasks }: { projectId?: ID; zoom: Zoom; groupBy: GroupBy; showTasks: boolean }) {
  const t = useT();
  const lang = useLang();
  const itemsRec = useData((s) => s.items);
  const people = useData((s) => s.people);
  const updateItem = useData((s) => s.updateItem);
  const openPeek = useUI((s) => s.openPeek);
  const projects = useProjectsList();
  const projectsById = useData((s) => s.projects);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<{ id: ID; day: ISODate } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const dayW = DAY_W[zoom];
  const today = todayISO();

  const scoped = useMemo(() => {
    const live = new Set(projects.map((p) => p.id));
    return Object.values(itemsRec).filter(
      (i) =>
        (projectId ? i.projectId === projectId : live.has(i.projectId)) &&
        i.status !== 'canceled' &&
        (showTasks || !['task', 'bug'].includes(i.type)),
    );
  }, [itemsRec, projectId, projects, showTasks]);

  /* ------------------------------- time range ------------------------------- */
  const range = useMemo(() => {
    let min = shiftISO(today, zoom === 'quarter' ? -120 : -45);
    let max = shiftISO(today, zoom === 'quarter' ? 420 : zoom === 'month' ? 180 : 75);
    for (const i of scoped) {
      for (const d of [i.startDate, i.dueDate]) {
        if (!d) continue;
        if (d < min) min = d;
        if (d > max) max = d;
      }
    }
    const start = startOfWeek(startOfMonth(addDays(fromISODate(min), -14)), { weekStartsOn: 1 });
    const end = endOfMonth(addDays(fromISODate(max), 30));
    return { start, end, days: differenceInCalendarDays(end, start) + 1 };
  }, [scoped, today, zoom]);

  const x = useCallback((iso: ISODate) => differenceInCalendarDays(fromISODate(iso), range.start) * dayW, [range.start, dayW]);
  const dayAt = useCallback((px: number) => toISODate(addDays(range.start, Math.floor(px / dayW))), [range.start, dayW]);
  const totalW = range.days * dayW;

  /* ---------------------------------- rows ---------------------------------- */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const milestones = scoped.filter((i) => i.type === 'milestone').sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    if (milestones.length) out.push({ kind: 'milestones', key: 'milestones', items: milestones });
    const pool = scoped.filter((i) => i.type !== 'milestone');
    const ids = new Set(pool.map((i) => i.id));
    const sortFn = (a: Item, b: Item) => (a.startDate ?? a.dueDate ?? '9999').localeCompare(b.startDate ?? b.dueDate ?? '9999') || a.order - b.order;
    const childrenOf = (id: ID) => pool.filter((i) => i.parentId === id).sort(sortFn);

    const pushTree = (item: Item, depth: number) => {
      const kids = childrenOf(item.id);
      const expanded = !collapsed.has(item.id);
      out.push({ kind: 'item', key: item.id, item, depth, hasChildren: kids.length > 0, expanded });
      if (expanded) kids.forEach((k) => pushTree(k, depth + 1));
    };
    const pushGroup = (key: string, label: string, icon: ReactNode, list: Item[], opts: { item?: Item; tree?: boolean; defaults: Partial<Item> }) => {
      const isCollapsed = collapsed.has(key);
      out.push({ kind: 'group', key, label, icon, count: list.length, collapsed: isCollapsed, item: opts.item, defaults: opts.defaults });
      if (isCollapsed) return;
      if (opts.tree) {
        const set = new Set(list.map((i) => i.id));
        list
          .filter((i) => !i.parentId || !set.has(i.parentId))
          .sort(sortFn)
          .forEach((i) => pushTree(i, 0));
      } else list.sort(sortFn).forEach((i) => out.push({ kind: 'item', key: i.id, item: i, depth: 0, hasChildren: false, expanded: false }));
      out.push({ kind: 'add', key: `add:${key}`, defaults: opts.defaults, depth: 0 });
    };
    const firstProject = projectId ?? projects[0]?.id;

    if (groupBy === 'initiative') {
      const initiatives = pool.filter((i) => i.type === 'initiative').sort(sortFn);
      const covered = new Set<ID>();
      for (const ini of initiatives) {
        const desc = descendantsOf(ini.id, pool);
        desc.forEach((d) => covered.add(d.id));
        covered.add(ini.id);
        const proj = projectsById[ini.projectId];
        pushGroup(`g:${ini.id}`, ini.title, projectId ? <TypeIcon type="initiative" size={15} /> : <PageIcon icon={proj?.icon} size={15} />, desc, {
          item: ini,
          tree: true,
          defaults: { projectId: ini.projectId, parentId: ini.id, type: 'epic' },
        });
      }
      const rest = pool.filter((i) => !covered.has(i.id));
      if (rest.length)
        pushGroup('g:none', t('roadmap.noInitiative'), undefined, rest, { tree: true, defaults: { projectId: firstProject, type: 'feature' } });
    } else if (groupBy === 'project') {
      for (const p of projects) {
        const list = pool.filter((i) => i.projectId === p.id);
        if (!list.length && !projectId) continue;
        pushGroup(`p:${p.id}`, p.name, <PageIcon icon={p.icon} size={15} />, list, { tree: true, defaults: { projectId: p.id, type: 'feature' } });
      }
    } else if (groupBy === 'type') {
      for (const ty of ITEM_TYPES.filter((x) => x !== 'milestone')) {
        const list = pool.filter((i) => i.type === ty);
        if (!list.length) continue;
        pushGroup(`t:${ty}`, t(`type.${ty}` as TKey), <TypeIcon type={ty} size={15} />, list, { defaults: { projectId: firstProject, type: ty } });
      }
    } else if (groupBy === 'status') {
      for (const st of STATUSES) {
        const list = pool.filter((i) => i.status === st);
        if (!list.length) continue;
        pushGroup(`s:${st}`, t(`status.${st}` as TKey), <StatusIcon status={st} />, list, {
          defaults: { projectId: firstProject, status: st, type: 'feature' },
        });
      }
    } else {
      pool
        .filter((i) => !i.parentId || !ids.has(i.parentId))
        .sort(sortFn)
        .forEach((i) => pushTree(i, 0));
      out.push({ kind: 'add', key: 'add:all', defaults: { projectId: firstProject, type: 'feature' }, depth: 0 });
    }
    return out;
  }, [scoped, groupBy, collapsed, projectsById, projects, projectId, t]);

  /* -------------------------------- scrolling ------------------------------- */
  const scrollToToday = useCallback(
    (smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      const target = LEFT_W + x(today) - (el.clientWidth - LEFT_W) * 0.3;
      el.scrollTo({ left: Math.max(0, target - LEFT_W), behavior: smooth ? 'smooth' : 'auto' });
    },
    [x, today],
  );
  // Jump to today whenever the zoom level changes (and on first paint).
  useLayoutEffect(() => scrollToToday(false), [zoom]);
  useEffect(() => {
    const on = () => scrollToToday(true);
    window.addEventListener('done:roadmap-today', on);
    return () => window.removeEventListener('done:roadmap-today', on);
  }, [scrollToToday]);

  /* ---------------------------------- drag ---------------------------------- */
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const dragKey = drag ? `${drag.id}:${drag.originX}` : null;
  useEffect(() => {
    if (!dragKey) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.originX;
      setDrag({ ...d, delta: Math.round(dx / dayW), moved: d.moved || Math.abs(dx) > 3 });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.moved) {
        const { start, end } = applyDrag(d);
        const it = useData.getState().items[d.id];
        if (it) updateItem(d.id, it.type === 'milestone' ? { dueDate: end } : { startDate: start, dueDate: end });
      } else openPeek(d.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragKey, dayW, updateItem, openPeek]);

  const startDrag = (e: React.PointerEvent, item: Item, mode: DragState['mode']) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = item.startDate ?? item.dueDate!;
    const end = item.dueDate ?? item.startDate!;
    setDrag({ id: item.id, mode, originX: e.clientX, start, end, delta: 0, moved: false });
  };

  const datesOf = (item: Item): { start?: ISODate; end?: ISODate } => {
    if (drag && drag.id === item.id) return applyDrag(drag);
    const start = item.startDate ?? item.dueDate;
    const end = item.dueDate ?? item.startDate;
    return { start, end };
  };

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  /* --------------------------------- header --------------------------------- */
  const months = useMemo(() => eachMonthOfInterval({ start: range.start, end: range.end }), [range]);
  const ticks = useMemo(() => {
    const out: { left: number; label: string; strong?: boolean; weekend?: boolean; today?: boolean }[] = [];
    if (zoom === 'week') {
      for (let i = 0; i < range.days; i++) {
        const d = addDays(range.start, i);
        const wd = getDay(d);
        out.push({ left: i * dayW, label: String(d.getDate()), weekend: wd === 0 || wd === 6, today: toISODate(d) === today });
      }
    } else if (zoom === 'month') {
      for (let i = 0; i < range.days; i += 7) {
        const d = addDays(range.start, i);
        out.push({ left: i * dayW, label: String(d.getDate()) });
      }
    } else {
      for (const m of months) out.push({ left: x(toISODate(m)), label: format(m, 'LLL', { locale: dateLocale(lang) }).replace('.', '') });
    }
    return out;
  }, [zoom, range, dayW, months, today, lang, x]);

  const topLabels = useMemo(() => {
    if (zoom === 'quarter') {
      const seen = new Set<string>();
      const out: { left: number; width: number; label: string }[] = [];
      for (const m of months) {
        const key = `${m.getFullYear()}-${getQuarter(m)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const qEnd = endOfMonth(addDays(startOfMonth(m), 62));
        out.push({
          left: x(toISODate(m)),
          width: x(toISODate(addDays(qEnd, 1))) - x(toISODate(m)),
          label: t('roadmap.quarter', { q: getQuarter(m), year: m.getFullYear() }),
        });
      }
      return out;
    }
    return months.map((m) => ({
      left: Math.max(0, x(toISODate(m))),
      width: x(toISODate(addDays(endOfMonth(m), 1))) - Math.max(0, x(toISODate(m))),
      label: format(m, 'LLLL yyyy', { locale: dateLocale(lang) }),
    }));
  }, [zoom, months, x, lang, t]);

  const todayX = x(today);

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" style={{ overscrollBehaviorX: 'contain' }}>
      <div className="relative" style={{ width: LEFT_W + totalW, minHeight: '100%' }}>
        {/* Header */}
        <div className="sticky top-0 z-30 flex" style={{ height: HEADER_H }}>
          <div
            className="sticky left-0 z-10 flex items-end border-b border-r border-line bg-bg px-4 pb-2 text-[12px] font-medium text-fg-3"
            style={{ width: LEFT_W }}
          >
            {t('prop.title')}
          </div>
          <div className="relative border-b border-line bg-bg" style={{ width: totalW }}>
            {topLabels.map((m) => (
              <div key={m.left} className="absolute top-0 h-[26px] overflow-clip border-l border-line" style={{ left: m.left, width: m.width }}>
                <span
                  className="sticky flex h-full w-max items-center px-2 text-[12.5px] font-semibold capitalize text-fg-2"
                  style={{ left: LEFT_W }}
                >
                  {m.label}
                </span>
              </div>
            ))}
            {ticks
              .filter((tk) => zoom === 'week' || Math.abs(tk.left - todayX) > 34)
              .map((tk) => (
                <div
                  key={tk.left}
                  className={cn(
                    'absolute bottom-0 flex h-[28px] items-center justify-center text-[11.5px] capitalize text-fg-3',
                    tk.weekend && 'text-fg-4',
                  )}
                  style={{ left: tk.left, width: zoom === 'week' ? dayW : undefined, paddingLeft: zoom === 'week' ? 0 : 4 }}
                >
                  {tk.today ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--c-red-solid)] px-1 text-[11px] font-semibold text-white">
                      {tk.label}
                    </span>
                  ) : (
                    tk.label
                  )}
                </div>
              ))}
            {zoom !== 'week' && (
              <div className="absolute bottom-[5px] z-10 -translate-x-1/2" style={{ left: todayX + dayW / 2 }}>
                <span className="rounded-full bg-[var(--c-red-solid)] px-1.5 py-[1px] text-[10.5px] font-semibold text-white">
                  {t('common.today')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="pointer-events-none absolute bottom-0 z-0" style={{ left: LEFT_W, width: totalW, top: HEADER_H }}>
          {zoom === 'week' &&
            ticks
              .filter((tk) => tk.weekend)
              .map((tk) => <div key={tk.left} className="absolute bottom-0 top-0 bg-hover/60" style={{ left: tk.left, width: dayW }} />)}
          {months.map((m) => (
            <div key={m.toISOString()} className="absolute bottom-0 top-0 w-px bg-line" style={{ left: x(toISODate(m)) }} />
          ))}
          {zoom === 'month' &&
            ticks.map((tk) => <div key={`w${tk.left}`} className="absolute bottom-0 top-0 w-px bg-line opacity-40" style={{ left: tk.left }} />)}
          <div className="absolute bottom-0 top-0 z-20 w-[2px] bg-[var(--c-red-solid)] opacity-70" style={{ left: todayX + dayW / 2 - 1 }} />
        </div>

        {/* Rows */}
        <div className="relative z-10">
          {rows.map((row) => {
            if (row.kind === 'milestones') {
              return (
                <div key={row.key} className="flex border-b border-line" style={{ height: ROW_H + 8 }}>
                  <LeftCell>
                    <span data-color="orange" className="tint-text flex items-center gap-2 px-4 text-[13px] font-semibold">
                      <Diamond size={14} /> {t('calendar.legend.milestones')}
                    </span>
                  </LeftCell>
                  <div className="relative" style={{ width: totalW }}>
                    {row.items.map((m) => {
                      const { end } = datesOf(m);
                      if (!end) return null;
                      const left = x(end) + dayW / 2;
                      return (
                        <div
                          key={m.id}
                          data-peek-keep
                          onPointerDown={(e) => startDrag(e, m, 'move')}
                          className="group absolute top-1/2 flex -translate-y-1/2 cursor-grab items-center gap-1.5 active:cursor-grabbing"
                          style={{ left: left - 8 }}
                        >
                          <span
                            data-color={m.status === 'done' ? 'green' : 'orange'}
                            className="tint-solid block h-[14px] w-[14px] rotate-45 rounded-[3px] shadow-sm ring-2 ring-[var(--bg)] transition-transform group-hover:scale-125"
                          />
                          <span className="whitespace-nowrap rounded bg-bg/80 px-1 text-[12.5px] font-medium text-fg-2 backdrop-blur-sm">
                            {m.title}
                          </span>
                          {drag?.id === m.id && drag.moved && <DragBadge label={formatRange(undefined, end, lang)} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }
            if (row.kind === 'group') {
              const it = row.item;
              const { start, end } = it ? datesOf(it) : {};
              const prog = it ? progressOf(descendantsOf(it.id, Object.values(itemsRec))) : undefined;
              return (
                <div key={row.key} className="group/row flex" style={{ height: ROW_H + 4 }}>
                  <LeftCell className="border-b border-line">
                    <button
                      onClick={() => toggle(row.key)}
                      className="ml-2 flex h-6 w-6 items-center justify-center rounded text-fg-3 hover:bg-active"
                    >
                      <ChevronRight size={14} className={cn('transition-transform duration-150', !row.collapsed && 'rotate-90')} />
                    </button>
                    {row.icon && <span className="flex w-5 justify-center">{row.icon}</span>}
                    <button
                      data-peek-keep
                      onClick={() => it && openPeek(it.id)}
                      className={cn('min-w-0 flex-1 truncate text-left text-[14px] font-semibold', it && 'hover:underline')}
                    >
                      {row.label}
                    </button>
                    <span className="pr-4 text-[12px] text-fg-4">{row.count}</span>
                  </LeftCell>
                  <div className="relative border-b border-line" style={{ width: totalW }}>
                    {it && start && end && (
                      <Bar
                        item={it}
                        left={x(start)}
                        width={x(end) + dayW - x(start)}
                        strong
                        progress={prog?.total ? prog.ratio : undefined}
                        dragging={drag?.id === it.id}
                        dragLabel={drag?.id === it.id && drag.moved ? formatRange(start, end, lang) : undefined}
                        onPointerDown={startDrag}
                      />
                    )}
                  </div>
                </div>
              );
            }
            if (row.kind === 'add') {
              return (
                <div key={row.key} className="flex" style={{ height: ROW_H }}>
                  <LeftCell className="border-b border-line">
                    {adding === row.key ? (
                      <InlineCreate
                        onDone={(title) => {
                          setAdding(null);
                          if (!title || !row.defaults.projectId) return;
                          useData.getState().createItem({
                            ...row.defaults,
                            projectId: row.defaults.projectId,
                            title,
                            status: row.defaults.status ?? 'planned',
                            startDate: today,
                            dueDate: shiftISO(today, 13),
                          });
                          setAdding(row.key);
                        }}
                        onCancel={() => setAdding(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setAdding(row.key)}
                        className="flex h-full w-full items-center gap-2 pl-10 text-[13.5px] text-fg-4 transition-colors hover:text-fg-2"
                      >
                        <Plus size={14} /> {t('item.newInline')}
                      </button>
                    )}
                  </LeftCell>
                  <div className="border-b border-line" style={{ width: totalW }} />
                </div>
              );
            }
            const it = row.item;
            const { start, end } = datesOf(it);
            const hasDates = !!(start && end);
            const kids = row.hasChildren ? progressOf(descendantsOf(it.id, Object.values(itemsRec))) : undefined;
            return (
              <div key={row.key} className="group/row flex" style={{ height: ROW_H }}>
                <LeftCell className="border-b border-line">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5" style={{ paddingLeft: 16 + row.depth * 18 }}>
                    {row.hasChildren ? (
                      <button
                        onClick={() => toggle(it.id)}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-active"
                      >
                        <ChevronRight size={13} className={cn('transition-transform duration-150', row.expanded && 'rotate-90')} />
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <TypeIcon type={it.type} size={14} />
                    <button
                      data-peek-keep
                      onClick={() => openPeek(it.id)}
                      className={cn('min-w-0 flex-1 truncate text-left text-[14px] hover:underline', it.status === 'done' && 'text-fg-3')}
                    >
                      {it.title}
                    </button>
                    {it.assigneeId && <Avatar person={people[it.assigneeId]} size={18} className="mr-3" />}
                  </div>
                </LeftCell>
                <div
                  className="relative border-b border-line"
                  style={{ width: totalW }}
                  onMouseMove={(e) => {
                    if (hasDates || drag) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const day = dayAt(e.clientX - rect.left);
                    if (hover?.day !== day || hover.id !== it.id) setHover({ id: it.id, day });
                  }}
                  onMouseLeave={() => hover?.id === it.id && setHover(null)}
                  onClick={() => {
                    if (hasDates || !hover || hover.id !== it.id) return;
                    updateItem(it.id, { startDate: hover.day, dueDate: shiftISO(hover.day, zoom === 'quarter' ? 29 : 13) });
                    setHover(null);
                  }}
                >
                  {hasDates ? (
                    <Bar
                      item={it}
                      left={x(start!)}
                      width={x(end!) + dayW - x(start!)}
                      progress={kids?.total ? kids.ratio : undefined}
                      dragging={drag?.id === it.id}
                      dragLabel={drag?.id === it.id && drag.moved ? formatRange(start, end, lang) : undefined}
                      onPointerDown={startDrag}
                    />
                  ) : (
                    hover?.id === it.id && (
                      <div
                        className="pointer-events-none absolute top-1/2 flex h-[26px] -translate-y-1/2 items-center rounded-md border border-dashed border-accent bg-accent-soft px-2 text-[12px] text-accent"
                        style={{ left: x(hover.day), width: (zoom === 'quarter' ? 30 : 14) * dayW }}
                      >
                        <span className="truncate">{t('roadmap.scheduleHint')}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="sticky left-0 flex h-48 items-center justify-center text-[14px] text-fg-3" style={{ width: 'min(100%, 100vw)' }}>
              {t('roadmap.empty')}
            </div>
          )}
          <div style={{ height: 120 }} />
        </div>
      </div>
    </div>
  );
}

function applyDrag(d: DragState): { start: ISODate; end: ISODate } {
  if (d.mode === 'move') return { start: shiftISO(d.start, d.delta), end: shiftISO(d.end, d.delta) };
  if (d.mode === 'start') {
    const s = shiftISO(d.start, d.delta);
    return { start: s > d.end ? d.end : s, end: d.end };
  }
  const e = shiftISO(d.end, d.delta);
  return { start: d.start, end: e < d.start ? d.start : e };
}

function LeftCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-bg', className)} style={{ width: LEFT_W }}>
      <div className="pointer-events-none absolute inset-0 transition-colors group-hover/row:bg-hover" />
      <div className="relative flex h-full min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

function Bar({
  item,
  left,
  width,
  strong,
  progress,
  dragging,
  dragLabel,
  onPointerDown,
}: {
  item: Item;
  left: number;
  width: number;
  strong?: boolean;
  progress?: number;
  dragging?: boolean;
  dragLabel?: string;
  onPointerDown: (e: React.PointerEvent, item: Item, mode: 'move' | 'start' | 'end') => void;
}) {
  const color = STATUS_META[item.status].color;
  const labelInside = width > 90;
  return (
    <motion.div
      data-peek-keep
      data-color={color}
      initial={{ opacity: 0, scaleX: 0.6 }}
      animate={{ opacity: 1, scaleX: 1, y: dragging ? -1 : 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      style={{ left, width: Math.max(width, 10), transformOrigin: 'left center' }}
      onPointerDown={(e) => onPointerDown(e, item, 'move')}
      className={cn(
        'group/bar absolute top-1/2 flex h-[26px] -translate-y-1/2 cursor-grab select-none items-center overflow-visible rounded-md active:cursor-grabbing',
        'tint border-l-[3px] border-[var(--tint-solid)] shadow-[0_1px_2px_rgba(15,15,15,0.06)]',
        strong && 'h-[28px] font-semibold',
        dragging && 'z-20 shadow-md ring-1 ring-[var(--tint-solid)]',
      )}
    >
      {progress !== undefined && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-[3px] bg-[var(--tint-solid)] opacity-20"
          style={{ width: `${progress * 100}%` }}
        />
      )}
      <span
        onPointerDown={(e) => onPointerDown(e, item, 'start')}
        className="absolute -left-[3px] top-0 z-10 h-full w-2 cursor-ew-resize rounded-l-md opacity-0 transition-opacity group-hover/bar:opacity-100"
      >
        <span className="absolute left-[3px] top-1/2 h-3 w-[2px] -translate-y-1/2 rounded bg-[var(--tint-solid)]" />
      </span>
      {labelInside && (
        <span className="pointer-events-none absolute inset-0 flex items-center overflow-clip rounded-md">
          <span className="sticky max-w-full truncate px-2 text-[12.5px] leading-none" style={{ left: LEFT_W }}>
            {item.title}
          </span>
        </span>
      )}
      <span
        onPointerDown={(e) => onPointerDown(e, item, 'end')}
        className="absolute -right-0 top-0 z-10 h-full w-2 cursor-ew-resize rounded-r-md opacity-0 transition-opacity group-hover/bar:opacity-100"
      >
        <span className="absolute right-[2px] top-1/2 h-3 w-[2px] -translate-y-1/2 rounded bg-[var(--tint-solid)]" />
      </span>
      {!labelInside && (
        <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap text-[12.5px] font-normal text-fg-2">{item.title}</span>
      )}
      <AnimatePresence>{dragLabel && <DragBadge label={dragLabel} />}</AnimatePresence>
    </motion.div>
  );
}

function DragBadge({ label }: { label: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute -top-8 left-0 whitespace-nowrap rounded-md bg-[#1f1f1f] px-2 py-1 text-[11.5px] font-medium text-white shadow-md dark:bg-[#3a3a3a]"
    >
      {label}
    </motion.span>
  );
}

function InlineCreate({ onDone, onCancel }: { onDone: (title: string) => void; onCancel: () => void }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <input
      ref={ref}
      placeholder={t('item.titlePlaceholder')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const v = (e.target as HTMLInputElement).value.trim();
          (e.target as HTMLInputElement).value = '';
          onDone(v);
        }
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v) onDone(v);
        onCancel();
      }}
      className="ml-10 mr-3 h-7 min-w-0 flex-1 rounded-md border border-accent bg-bg px-2 text-[13.5px] shadow-[0_0_0_2px_var(--accent-soft)] outline-none"
    />
  );
}
