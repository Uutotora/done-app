import { motion } from 'motion/react';
import { ArrowUpRight, FilePlus, FolderPlus, IterationCw, Link2, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { dateLocale, useLang, useT } from '@/lib/i18n';
import { isClosed, progressOf, refPath, refTitle, useMe, useProjectsList } from '@/lib/selectors';
import { daysFromToday, formatRange, formatShortDate, timeAgo, todayISO, toISODate } from '@/lib/dates';
import { sprintItems, sprintStats } from '@/lib/sprints';
import { PROJECT_STATUS_COLOR } from '@/lib/constants';
import { setItemStatus } from '@/lib/actions';
import { Topbar } from '@/components/Topbar';
import { AvatarStack, Chip, DoneCheck, PageIcon, Progress, SectionTitle } from '@/components/ui/bits';
import { PriorityIcon, TypeIcon } from '@/components/pickers/icons';
import { NodeIcon } from '@/components/files/NodeIcon';
import { useOpenFileNode } from '@/views/Files';
import { cn } from '@/lib/utils';
import { WorkspacePulse } from '@/components/ProjectHealth';
import type { Item, Person } from '@/lib/types';
import { useCanCreateProjects } from '@/lib/auth';

const fadeUp = (i: number) => ({
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.015 * i, duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
});

export function Home() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const me = useMe();
  const items = useData((s) => s.items);
  const projectsById = useData((s) => s.projects);
  const people = useData((s) => s.people);
  const recent = useData((s) => s.prefs.recent);
  const createProject = useData((s) => s.createProject);
  const canCreate = useCanCreateProjects();
  const createDoc = useData((s) => s.createDoc);
  const openLinkDialog = useUI((s) => s.openLinkDialog);
  const files = useData((s) => s.files);
  const openNode = useOpenFileNode();
  const openCreateItem = useUI((s) => s.openCreateItem);
  const openPeek = useUI((s) => s.openPeek);
  const projects = useProjectsList();
  const recentFiles = useMemo(
    () =>
      Object.values(files)
        .filter((f) => f.kind !== 'folder')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6),
    [files],
  );

  const hour = new Date().getHours();
  const greeting = t(hour < 5 ? 'home.night' : hour < 12 ? 'home.morning' : hour < 18 ? 'home.day' : 'home.evening');
  const firstName = me?.name.split(' ')[0] ?? '';

  const focus = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.assigneeId === me?.id && !isClosed(i) && i.type !== 'initiative' && i.type !== 'milestone')
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
        .slice(0, 8),
    [items, me?.id],
  );
  const doneToday = useMemo(
    () =>
      Object.values(items).filter(
        (i) => i.assigneeId === me?.id && i.status === 'done' && i.completedAt && toISODate(new Date(i.completedAt)) === todayISO(),
      ),
    [items, me?.id],
  );
  const milestones = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.type === 'milestone' && i.dueDate && i.dueDate >= todayISO() && !isClosed(i))
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
        .slice(0, 5),
    [items],
  );
  const allItems = useMemo(() => Object.values(items), [items]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Topbar crumbs={[{ label: t('nav.home'), icon: '🏠' }]} />
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-10 pb-24 pt-10">
        <motion.div {...fadeUp(0)}>
          <div className="text-[13.5px] font-medium text-fg-3 first-letter:uppercase">
            {format(new Date(), 'EEEE, d MMMM', { locale: dateLocale(lang) })}
          </div>
          <h1 className="mt-1 text-[34px] font-bold tracking-[-0.02em]">
            {greeting}
            {firstName && `, ${firstName}`}
          </h1>
        </motion.div>

        <div className="mt-6">
          <WorkspacePulse />
        </div>

        {/* Quick actions */}
        <motion.div {...fadeUp(1)} className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
          <QuickAction icon={<Plus size={18} />} color="blue" label={t('home.quick.item')} hint="C" onClick={() => openCreateItem()} />
          <QuickAction icon={<Link2 size={18} />} color="purple" label={t('home.quick.link')} onClick={() => openLinkDialog()} />
          <QuickAction
            icon={<FilePlus size={18} />}
            color="green"
            label={t('home.quick.doc')}
            onClick={() => {
              const id = createDoc({});
              if (id) navigate(`/docs/${id}`);
            }}
          />
          {canCreate && (
            <QuickAction
              icon={<FolderPlus size={18} />}
              color="orange"
              label={t('home.quick.project')}
              onClick={() => {
                const id = createProject({ name: '' });
                if (id) navigate(`/p/${id}/overview`);
              }}
            />
          )}
        </motion.div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          {/* Focus */}
          <motion.section {...fadeUp(2)}>
            <SectionTitle
              action={
                <Link to="/my-work" className="text-[13px] text-fg-3 hover:text-fg">
                  {t('nav.myWork')} → {doneToday.length > 0 && `✓ ${doneToday.length}`}
                </Link>
              }
            >
              {t('home.focus')}
            </SectionTitle>
            <div className="overflow-hidden rounded-xl border border-line">
              {focus.length === 0 && <div className="px-4 py-8 text-center text-[14px] text-fg-3">{t('home.focusEmpty')}</div>}
              {focus.map((it, i) => (
                <FocusRow
                  key={it.id}
                  item={it}
                  index={i}
                  projectName={projectsById[it.projectId]?.name}
                  projectIcon={projectsById[it.projectId]?.icon}
                  onOpen={() => openPeek(it.id)}
                />
              ))}
            </div>
          </motion.section>

          {/* Milestones */}
          <motion.section {...fadeUp(3)}>
            <SectionTitle>{t('home.milestones')}</SectionTitle>
            <div className="relative space-y-1 pl-4">
              <div className="absolute bottom-3 left-[5px] top-3 w-px bg-line-strong" />
              {milestones.length === 0 && <div className="py-4 text-[13.5px] text-fg-3">{t('home.milestonesEmpty')}</div>}
              {milestones.map((m) => {
                const days = daysFromToday(m.dueDate!);
                return (
                  <button
                    key={m.id}
                    data-peek-keep
                    onClick={() => openPeek(m.id)}
                    className="relative flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover"
                  >
                    <span
                      data-color="orange"
                      className="tint-solid absolute -left-[14.5px] top-[14px] h-2.5 w-2.5 rotate-45 rounded-[2px] ring-4 ring-[var(--bg)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{m.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-fg-3">
                        <PageIcon icon={projectsById[m.projectId]?.icon} size={13} />
                        <span className="truncate">{projectsById[m.projectId]?.name}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[13px] font-medium">{formatShortDate(m.dueDate, lang)}</div>
                      <div className="text-[12px] text-fg-3">{days === 0 ? t('common.today') : t('home.inDays', { n: days })}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.section>
        </div>

        <ActiveSprints />

        {/* Projects */}
        <motion.section {...fadeUp(4)} className="mt-10">
          <SectionTitle>{t('home.projects')}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p, i) => {
              const pi = allItems.filter((it) => it.projectId === p.id);
              const prog = progressOf(pi);
              const team = [...new Set(pi.map((it) => it.assigneeId).filter(Boolean))].map((id) => people[id!]).filter(Boolean) as Person[];
              return (
                <motion.div key={p.id} {...fadeUp(Math.min(5 + i, 8))}>
                  <Link
                    to={`/p/${p.id}/overview`}
                    className="group block overflow-hidden rounded-xl border border-line bg-bg transition-colors duration-100 hover:bg-subtle"
                  >
                    <div className="relative p-4">
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-subtle text-[24px]">
                        <PageIcon icon={p.icon} size={26} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-[15px] font-semibold">{p.name || t('project.untitled')}</div>
                        <ArrowUpRight size={16} className="shrink-0 text-fg-4 opacity-0 group-hover:opacity-100" />
                      </div>
                      <div className="mt-0.5 h-5 truncate text-[13px] text-fg-3">{p.summary}</div>
                      <div className="mt-3 flex items-center justify-between">
                        <Chip color={PROJECT_STATUS_COLOR[p.status]} dot>
                          {t(`pstatus.${p.status}`)}
                        </Chip>
                        <AvatarStack people={team} size={20} />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <Progress value={prog.ratio} />
                        <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{Math.round(prog.ratio * 100)}%</span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* Files */}
        <motion.section {...fadeUp(6)} className="mt-10">
          <SectionTitle
            action={
              <Link to="/files" className="text-[13px] text-fg-3 hover:text-fg">
                {t('nav.files')} →
              </Link>
            }
          >
            {t('home.recentFiles')}
          </SectionTitle>
          {recentFiles.length === 0 ? (
            <button
              onClick={() => openLinkDialog()}
              className="w-full rounded-xl border border-dashed border-line-strong px-4 py-8 text-[14px] text-fg-3 transition-colors hover:bg-hover"
            >
              {t('home.recentFilesEmpty')}
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {recentFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openNode(f)}
                  className="group flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:bg-hover"
                >
                  <NodeIcon node={f} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{f.name}</span>
                    <span className="flex items-center gap-1 truncate text-[12.5px] text-fg-3">
                      {f.projectId && projectsById[f.projectId] && (
                        <>
                          <PageIcon icon={projectsById[f.projectId].icon} size={12} />
                          <span className="truncate">{projectsById[f.projectId].name}</span>
                          <span>·</span>
                        </>
                      )}
                      {timeAgo(f.createdAt, lang)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </motion.section>

        {/* Jump back in */}
        {recent.length > 0 && (
          <motion.section {...fadeUp(7)} className="mt-10">
            <SectionTitle>{t('home.jumpBack')}</SectionTitle>
            <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
              {recent.slice(0, 8).map((r) => {
                const info = refTitle(r);
                if (!info) return null;
                return (
                  <Link
                    key={`${r.kind}:${r.id}`}
                    to={refPath(r)}
                    className="group w-[170px] shrink-0 rounded-lg border border-line bg-bg transition-colors hover:bg-subtle"
                  >
                    <div className="p-3">
                      <div className="mb-2">
                        <PageIcon icon={info.icon} size={28} />
                      </div>
                      <div className="line-clamp-2 text-[13.5px] font-medium leading-snug">{info.title || t('common.untitled')}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </motion.section>
        )}
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick, color, hint }: { icon: ReactNode; label: string; onClick: () => void; color: string; hint?: string }) {
  return (
    <motion.button
      onClick={onClick}
      className="flex h-[52px] items-center gap-2 rounded-lg border border-line px-2.5 text-left text-[13px] font-medium transition-colors duration-100 sm:gap-3 sm:px-3.5 sm:text-[14px] hover:bg-subtle"
    >
      <span data-color={color} className="tint flex h-7 w-7 shrink-0 items-center justify-center rounded-md sm:h-8 sm:w-8">
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="hidden text-[12px] text-fg-4 sm:inline">{hint}</span>}
    </motion.button>
  );
}

function FocusRow({
  item,
  index,
  projectName,
  projectIcon,
  onOpen,
}: {
  item: Item;
  index: number;
  projectName?: string;
  projectIcon?: string;
  onOpen: () => void;
}) {
  const lang = useLang();
  const t = useT();
  const overdue = item.dueDate && item.dueDate < todayISO();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.03 * index }}
      data-peek-keep
      onClick={onOpen}
      className="group flex h-11 cursor-pointer items-center gap-3 border-b border-line px-3.5 last:border-b-0 hover:bg-hover"
    >
      <DoneCheck checked={false} onChange={(_, e) => setItemStatus(item.id, 'done', e)} size={18} />
      {item.type !== 'task' && <TypeIcon type={item.type} size={14} />}
      <span className="min-w-0 flex-1 truncate text-[14px]">{item.title}</span>
      <span className="hidden items-center gap-1.5 truncate text-[12.5px] text-fg-3 sm:flex">
        <PageIcon icon={projectIcon} size={13} />
        <span className="max-w-[160px] truncate">{projectName}</span>
      </span>
      <PriorityIcon priority={item.priority} />
      {item.dueDate && (
        <span className={cn('w-[72px] shrink-0 text-right text-[12.5px]', overdue ? 'font-medium text-[var(--c-red-text)]' : 'text-fg-3')}>
          {overdue ? t('home.overdue') : formatShortDate(item.dueDate, lang)}
        </span>
      )}
    </motion.div>
  );
}

/** Every running sprint across projects, so leads see all teams at a glance. */
function ActiveSprints() {
  const t = useT();
  const lang = useLang();
  const sprints = useData((s) => s.sprints);
  const projects = useData((s) => s.projects);
  const items = useData((s) => s.items);
  const active = Object.values(sprints).filter((sp) => sp.status === 'active' && projects[sp.projectId] && !projects[sp.projectId].archived);
  if (!active.length) return null;
  return (
    <motion.section {...fadeUp(4)} className="mt-10">
      <SectionTitle>{t('home.activeSprints')}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((sp) => {
          const list = sprintItems(sp.id, items);
          const stats = sprintStats(sp, list);
          const project = projects[sp.projectId];
          return (
            <Link
              key={sp.id}
              to={`/p/${sp.projectId}/sprints`}
              className="group rounded-xl border border-line p-4 transition-colors duration-100 hover:bg-subtle"
            >
              <div className="flex items-center gap-2 text-[12.5px] text-fg-3">
                <PageIcon icon={project.icon} size={14} />
                <span className="truncate">{project.name}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <IterationCw size={15} className="shrink-0 text-accent" />
                <span className="truncate text-[15px] font-semibold">{sp.name}</span>
                <span className="ml-auto shrink-0 text-[12px] text-fg-3">{formatRange(sp.startDate, sp.endDate, lang)}</span>
              </div>
              {sp.goal && <div className="mt-1 line-clamp-2 text-[13px] text-fg-2">{sp.goal}</div>}
              <div className="mt-3 flex items-center gap-2">
                <Progress value={stats.ratio} color="blue" />
                <span className="shrink-0 text-[12px] tabular-nums text-fg-3">{Math.round(stats.ratio * 100)}%</span>
              </div>
              <div className="mt-2 flex justify-between text-[12px] text-fg-3">
                <span>{t('sprint.progress', { done: stats.done, total: stats.total })}</span>
                <span>{stats.daysLeft > 0 ? t('sprint.daysLeft', { n: stats.daysLeft }) : t('sprint.lastDay')}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </motion.section>
  );
}
