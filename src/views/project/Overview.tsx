import { motion } from 'motion/react';
import { CalendarDays, Diamond, FolderOpen, ImageIcon, ListTodo, TrendingUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { formatRange, formatShortDate, timeAgo, todayISO } from '@/lib/dates';
import { PROJECT_STATUS_COLOR, GRADIENTS } from '@/lib/constants';
import { isClosed, progressOf, useItems } from '@/lib/selectors';
import { Editor } from '@/components/Editor';
import { AutoTextarea, Avatar, AvatarStack, Chip, PageIcon, Progress, SectionTitle } from '@/components/ui/bits';
import { CoverPicker, IconPicker } from '@/components/pickers/IconPicker';
import { PersonPicker, ProjectStatusPicker } from '@/components/pickers/Pickers';
import { DatePicker } from '@/components/pickers/DatePicker';
import { StatusIcon, TypeIcon } from '@/components/pickers/icons';
import { PlanePanel } from '@/components/PlanePanel';
import { TabsBar } from './ProjectLayout';
import type { Person } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Overview() {
  const t = useT();
  const lang = useLang();
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const project = useData((s) => s.projects[projectId!]);
  const people = useData((s) => s.people);
  const update = useData((s) => s.updateProject);
  const openPeek = useUI((s) => s.openPeek);
  const items = useItems(projectId);
  const fileCount = useData((s) => Object.values(s.files).filter((f) => f.projectId === projectId && f.kind !== 'folder').length);
  const [hoverHeader, setHoverHeader] = useState(false);

  const prog = progressOf(items);
  const open = items.filter((i) => !isClosed(i) && i.type !== 'milestone' && i.type !== 'initiative').length;
  const nextMilestone = useMemo(
    () =>
      items
        .filter((i) => i.type === 'milestone' && i.dueDate && i.dueDate >= todayISO() && !isClosed(i))
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0],
    [items],
  );
  const recent = useMemo(() => [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), [items]);
  const team = useMemo(() => {
    const ids = new Set(items.map((i) => i.assigneeId).filter(Boolean) as string[]);
    if (project?.leadId) ids.add(project.leadId);
    return [...ids].map((id) => people[id]).filter(Boolean) as Person[];
  }, [items, people, project?.leadId]);

  if (!project) return null;
  const set = (patch: Parameters<typeof update>[1]) => update(project.id, patch);
  const tab = location.pathname.split('/')[3] ?? 'overview';

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div onMouseEnter={() => setHoverHeader(true)} onMouseLeave={() => setHoverHeader(false)}>
        {project.cover && (
          <div className="group relative h-[180px] w-full" style={{ background: project.cover.value }}>
            <div className="absolute bottom-3 right-4 opacity-0 transition-opacity group-hover:opacity-100">
              <CoverPicker value={project.cover} onChange={(c) => set({ cover: c })}>
                <button className="rounded-md bg-white/80 px-2.5 py-1 text-[12.5px] font-medium text-[#37352f] shadow-sm backdrop-blur hover:bg-white">
                  {t('project.changeCover')}
                </button>
              </CoverPicker>
            </div>
          </div>
        )}
        <div className="full-width">
          <div className={cn('relative z-10', project.cover ? '-mt-11' : 'mt-10')}>
            <IconPicker value={project.icon} onChange={(v) => set({ icon: v ?? '📁' })} allowRemove={false}>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="flex h-[78px] w-[78px] items-center justify-center rounded-lg hover:bg-hover"
              >
                <PageIcon icon={project.icon} size={72} />
              </motion.button>
            </IconPicker>
          </div>
          <div className="flex h-8 items-center gap-1">
            {!project.cover && (
              <motion.div animate={{ opacity: hoverHeader ? 1 : 0 }}>
                <button
                  onClick={() => set({ cover: { kind: 'gradient', value: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)] } })}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-fg-3 hover:bg-hover"
                >
                  <ImageIcon size={15} /> {t('project.addCover')}
                </button>
              </motion.div>
            )}
          </div>
          <AutoTextarea
            key={project.id}
            defaultValue={project.name}
            autoFocus={!project.name}
            placeholder={t('project.untitled')}
            onBlur={(e) => e.target.value !== project.name && set({ name: e.target.value })}
            className="text-[40px] font-bold leading-[1.2] tracking-[-0.02em] placeholder:text-fg-4"
          />
          <input
            key={`${project.id}-summary`}
            defaultValue={project.summary}
            placeholder={t('project.summaryPlaceholder')}
            onBlur={(e) => e.target.value !== (project.summary ?? '') && set({ summary: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="mt-1 w-full bg-transparent text-[17px] text-fg-2 outline-none placeholder:text-fg-4"
          />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ProjectStatusPicker value={project.status} onChange={(v) => set({ status: v })}>
              <button className="rounded-md hover:opacity-80">
                <Chip color={PROJECT_STATUS_COLOR[project.status]} dot className="h-7 px-2.5 text-[13px]">
                  {t(`pstatus.${project.status}`)}
                </Chip>
              </button>
            </ProjectStatusPicker>
            <PersonPicker value={project.leadId} onChange={(v) => set({ leadId: v })}>
              <button className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover">
                <span className="text-fg-3">{t('prop.lead')}</span>
                <Avatar person={project.leadId ? people[project.leadId] : undefined} size={18} />
                {project.leadId && people[project.leadId]?.name}
              </button>
            </PersonPicker>
            <DatePicker start={project.startDate} end={project.targetDate} onChange={(s, e) => set({ startDate: s, targetDate: e })}>
              <button className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover">
                <CalendarDays size={14} className="text-fg-3" />
                {project.targetDate ? formatRange(project.startDate, project.targetDate, lang) : t('project.dates')}
              </button>
            </DatePicker>
            <AvatarStack people={team} size={22} max={6} />
          </div>
        </div>
      </div>

      <div className="mt-6 border-b border-line">
        <TabsBar projectId={project.id} active={tab} t={t} />
      </div>

      <div className="full-width grid grid-cols-1 gap-10 pb-32 pt-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={<TrendingUp size={15} />} label={t('project.stats.progress')} value={`${Math.round(prog.ratio * 100)}%`}>
              <Progress value={prog.ratio} className="mt-2" />
            </Stat>
            <Stat icon={<ListTodo size={15} />} label={t('project.stats.open')} value={String(open)} />
            <Stat
              icon={<Diamond size={15} />}
              label={t('project.stats.nextMilestone')}
              value={nextMilestone ? formatShortDate(nextMilestone.dueDate, lang) : '—'}
              sub={nextMilestone?.title ?? t('project.noMilestone')}
              onClick={nextMilestone ? () => openPeek(nextMilestone.id) : undefined}
            />
            <Stat
              icon={<FolderOpen size={15} />}
              label={t('project.stats.files')}
              value={String(fileCount)}
              onClick={() => navigate(`/p/${project.id}/files`)}
            />
          </div>

          <div className="mt-10">
            <SectionTitle>{t('project.brief')}</SectionTitle>
            <Editor
              key={project.id}
              initial={project.brief}
              onChange={(blocks) => useData.getState().updateProject(project.id, { brief: blocks })}
              placeholder={t('project.briefPlaceholder')}
            />
          </div>
        </div>

        <aside className="space-y-8">
          <PlanePanel projectId={project.id} />
          <section>
            <SectionTitle>{t('project.activity')}</SectionTitle>
            <div className="space-y-0.5">
              {recent.map((it) => (
                <button
                  key={it.id}
                  data-peek-keep
                  onClick={() => openPeek(it.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <StatusIcon status={it.status} />
                  <TypeIcon type={it.type} size={13} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{it.title}</span>
                  <span className="shrink-0 text-[12px] text-fg-4">{timeAgo(it.updatedAt, lang)}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  children,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <motion.div
      whileHover={onClick ? { y: -2 } : undefined}
      onClick={onClick}
      data-peek-keep
      className={`rounded-xl border border-line p-3.5 ${onClick ? 'cursor-pointer hover:bg-hover' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-3">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold tabular-nums tracking-[-0.01em]">{value}</div>
      {sub && <div className="truncate text-[12.5px] text-fg-3">{sub}</div>}
      {children}
    </motion.div>
  );
}
