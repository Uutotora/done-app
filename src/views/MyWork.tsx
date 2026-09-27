import { StatePanel } from '@/components/StatePanel';
import { ChevronDown, FolderOpen, ListTodo, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { useProjectsList } from '@/lib/selectors';
import { blockersOf, isFinished, isWorkItem, sortWork, WORK_BUCKETS, workBucket } from '@/lib/work';
import { formatShortDate, todayISO, shiftISO } from '@/lib/dates';
import { setItemStatus } from '@/lib/actions';
import { cn, matches } from '@/lib/utils';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/ui/Button';
import { Avatar, DoneCheck, PageIcon } from '@/components/ui/bits';
import { PriorityIcon, TypeIcon } from '@/components/pickers/icons';
import { PersonPicker, PriorityPicker } from '@/components/pickers/Pickers';
import { DatePicker } from '@/components/pickers/DatePicker';
import { RecurrenceMark } from '@/components/pickers/RecurrencePicker';
import { EntriesMenu } from '@/components/ui/Overlay';
import { IconButton } from '@/components/ui/Button';
import { csvMenuEntry, downloadItemsCsv, itemExportContext } from '@/components/ExportMenu';
import { MY_WORK_COLUMNS } from '@/lib/itemExport';

const WORK_VIEWS = ['active', 'overdue', 'week', 'blocked', 'unassigned', 'completed'] as const;

export function MyWork() {
  const t = useT();
  const lang = useLang();
  const [params, setParams] = useSearchParams();
  const all = useData((s) => s.items);
  const projects = useData((s) => s.projects);
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const update = useData((s) => s.updateItem);
  const openPeek = useUI((s) => s.openPeek);
  const create = useUI((s) => s.openCreateItem);
  const projectList = useProjectsList();
  const scope = params.get('scope') === 'team' ? 'team' : 'mine';
  const view = params.get('view') ?? 'active';
  const projectId = params.get('project') ?? '';
  const assignee = params.get('assignee');
  const search = params.get('q') ?? '';
  const today = todayISO();
  const change = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
        return next;
      },
      { replace: true },
    );
  const base = Object.values(all).filter(
    (i) =>
      isWorkItem(i) &&
      projects[i.projectId] &&
      !projects[i.projectId].archived &&
      projects[i.projectId].status !== 'completed' &&
      (scope === 'team' || i.assigneeId === meId) &&
      (!projectId || i.projectId === projectId) &&
      (!assignee || (i.assigneeId ?? 'none') === assignee) &&
      (!search || matches(`${i.title} ${projects[i.projectId].name} ${i.tags.join(' ')}`, search)),
  );
  const filtered = (v: string) =>
    base.filter((i) => {
      if (v === 'completed') return i.status === 'done';
      if (isFinished(i)) return false;
      if (v === 'overdue') return i.dueDate && i.dueDate < today;
      if (v === 'week') return i.dueDate && i.dueDate >= today && i.dueDate <= shiftISO(today, 7);
      if (v === 'blocked') return blockersOf(i, all).length > 0;
      if (v === 'unassigned') return !i.assigneeId;
      return true;
    });
  const items = sortWork(filtered(view));
  const exportCsv = () => {
    const ctx = itemExportContext();
    // Same order as on screen: bucket by bucket, the bucket as the first field.
    const rows = WORK_BUCKETS.flatMap((bucket) =>
      items.filter((i) => workBucket(i, today) === bucket).map((item) => ({ item, group: t(`work.bucket.${bucket}`) })),
    );
    const name = [
      scope === 'team' ? t('work.teamExport') : t('nav.myWork'),
      view !== 'active' && (WORK_VIEWS as readonly string[]).includes(view) ? t(`work.${view as (typeof WORK_VIEWS)[number]}`) : '',
      projectId && projects[projectId] ? projects[projectId].name : '',
    ]
      .filter(Boolean)
      .join(' · ');
    downloadItemsCsv(rows, MY_WORK_COLUMNS, ctx, name, { withGroup: true });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar crumbs={[{ label: t('nav.myWork'), icon: 'icon:list-todo:gray' }]} />
      <div className="full-width pt-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[30px] font-bold tracking-tight">{t('nav.myWork')}</h1>
            <p className="mt-1 text-[14px] text-fg-3">{t('work.subtitle')}</p>
          </div>
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => create({ ...(projectId ? { projectId } : {}), ...(scope === 'mine' ? { assigneeId: meId } : {}) })}
          >
            {t('home.quick.item')}
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-line pb-3">
          <div className="flex rounded-md bg-hover p-0.5">
            {(['mine', 'team'] as const).map((s) => (
              <button
                key={s}
                aria-pressed={scope === s}
                onClick={() => change({ scope: s, assignee: '' })}
                className={cn('rounded px-3 py-1 text-[13px]', scope === s ? 'bg-bg font-medium shadow-sm' : 'text-fg-3 hover:text-fg')}
              >
                {t(`work.${s}`)}
              </button>
            ))}
          </div>
          <EntriesMenu
            trigger={
              <button
                aria-label={t('prop.project')}
                className="flex h-8 max-w-[240px] items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] transition-colors hover:bg-hover data-[state=open]:bg-hover"
              >
                {projectId && projects[projectId] ? (
                  <>
                    <PageIcon icon={projects[projectId].icon} size={14} />
                    <span className="truncate">{projects[projectId].name || t('project.untitled')}</span>
                  </>
                ) : (
                  <>
                    <FolderOpen size={14} className="text-fg-3" />
                    <span>{t('work.allProjects')}</span>
                  </>
                )}
                <ChevronDown size={13} className="shrink-0 text-fg-3" />
              </button>
            }
            entries={[
              {
                key: 'all',
                icon: <FolderOpen size={15} />,
                label: t('work.allProjects'),
                checked: !projectId,
                onSelect: () => change({ project: '' }),
              },
              { key: 's', separator: true },
              ...projectList.map((p) => ({
                key: p.id,
                icon: <PageIcon icon={p.icon} size={15} />,
                label: p.name || t('project.untitled'),
                checked: projectId === p.id,
                onSelect: () => change({ project: p.id }),
              })),
            ]}
          />
          <div className="relative ml-auto flex items-center">
            <Search size={14} className="absolute left-2 text-fg-4" />
            <input
              aria-label={t('common.search')}
              placeholder={t('common.searchPlaceholder')}
              value={search}
              onChange={(e) => change({ q: e.target.value })}
              className="h-8 w-[180px] rounded-md border border-line bg-transparent pl-7 pr-2 text-[13px]"
            />
          </div>
          {assignee && (
            <button onClick={() => change({ assignee: '' })} className="flex items-center gap-1 rounded bg-hover px-2 py-1 text-[12px]">
              {people[assignee]?.name ?? t('health.unassigned')}
              <X size={12} />
            </button>
          )}
          <EntriesMenu
            align="end"
            entries={[csvMenuEntry(exportCsv, t)]}
            trigger={
              <IconButton size="md" label={t('common.more')} className="data-[state=open]:bg-hover">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          />
        </div>
        <div className="no-scrollbar flex gap-4 overflow-x-auto border-b border-line">
          {WORK_VIEWS.map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => change({ view: v })}
              className={cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 py-3 text-[13px]',
                view === v ? 'border-fg font-medium' : 'border-transparent text-fg-3 hover:text-fg',
              )}
            >
              {t(`work.${v}`)}
              <span className="text-[11px] tabular-nums text-fg-4">{filtered(v).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="full-width min-h-0 flex-1 overflow-y-auto pb-16 pt-4">
        {items.length === 0 && (
          <StatePanel
            illustration={search || projectId || assignee ? 'lost' : 'quiet'}
            title={t('work.empty')}
            action={
              <>
                <button className="state-primary" onClick={() => create()}>
                  {t('common.new')}
                </button>
                {(search || projectId || assignee || view !== 'active') && (
                  <button className="state-link" onClick={() => change({ view: 'active', project: '', q: '', assignee: '' })}>
                    {t('work.reset')}
                  </button>
                )}
              </>
            }
          >
            {t('work.emptyHint')}
          </StatePanel>
        )}
        {WORK_BUCKETS.map((bucket) => {
          const group = items.filter((i) => workBucket(i, today) === bucket);
          if (!group.length) return null;
          return (
            <section key={bucket} className="mb-6">
              <h2
                className={cn(
                  'mb-2 flex items-center gap-2 text-[12px] font-semibold',
                  bucket === 'overdue' ? 'text-[var(--c-red-text)]' : 'text-fg-3',
                )}
              >
                <ListTodo size={14} />
                {t(`work.bucket.${bucket}`)}
                <span className="font-normal tabular-nums">{group.length}</span>
              </h2>
              <div className="rounded-lg border border-line">
                {group.map((item) => (
                  <div
                    key={item.id}
                    data-peek-keep
                    className="group flex min-h-12 items-center gap-2 border-b border-line px-3 last:border-b-0 hover:bg-subtle"
                  >
                    <DoneCheck checked={item.status === 'done'} onChange={(v, e) => setItemStatus(item.id, v ? 'done' : 'in_progress', e)} />
                    <button onClick={() => openPeek(item.id)} className="flex min-w-0 flex-1 items-center gap-2 py-3 text-left">
                      <TypeIcon type={item.type} size={14} />
                      <span className={cn('min-w-0 truncate text-[14px]', item.status === 'done' && 'text-fg-3 line-through')}>{item.title}</span>
                      {blockersOf(item, all).length > 0 && (
                        <span className="hidden shrink-0 rounded bg-[var(--c-orange-bg)] px-1.5 text-[11px] text-[var(--c-orange-text)] sm:inline">
                          {t('work.blocked')}
                        </span>
                      )}
                    </button>
                    <Link
                      to={`/p/${item.projectId}/overview`}
                      className="hidden w-[150px] shrink-0 items-center gap-1.5 truncate text-[12px] text-fg-3 hover:text-fg xl:flex"
                    >
                      <PageIcon icon={projects[item.projectId].icon} size={14} />
                      <span className="truncate">{projects[item.projectId].name}</span>
                    </Link>
                    <PriorityPicker value={item.priority} onChange={(priority) => update(item.id, { priority })}>
                      <button aria-label={t('prop.priority')} className="rounded p-1 hover:bg-hover">
                        <PriorityIcon priority={item.priority} />
                      </button>
                    </PriorityPicker>
                    <DatePicker start={item.startDate} end={item.dueDate} onChange={(startDate, dueDate) => update(item.id, { startDate, dueDate })}>
                      <button
                        aria-label={t('prop.dates')}
                        className={cn(
                          'flex w-[76px] shrink-0 items-center justify-end gap-1 rounded px-1 py-1 text-right text-[12px] hover:bg-hover sm:w-[90px]',
                          bucket === 'overdue' ? 'text-[var(--c-red-text)]' : 'text-fg-3',
                        )}
                      >
                        <RecurrenceMark rule={item.recurrence} size={11} className="text-inherit" />
                        <span className="truncate">{formatShortDate(item.dueDate, lang) || t('common.noDate')}</span>
                      </button>
                    </DatePicker>
                    <PersonPicker value={item.assigneeId} onChange={(assigneeId) => update(item.id, { assigneeId })}>
                      <button aria-label={t('prop.assignee')} className="rounded p-1 hover:bg-hover">
                        <Avatar person={people[item.assigneeId ?? '']} size={21} />
                      </button>
                    </PersonPicker>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
