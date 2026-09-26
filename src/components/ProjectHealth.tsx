import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, GitBranch, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useT } from '@/lib/i18n';
import { sortWork, teamWorkload, workSummary } from '@/lib/work';
import { Avatar, SectionTitle } from './ui/bits';
import { StatusIcon } from './pickers/icons';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export function WorkspacePulse() {
  const t = useT();
  const items = useData((s) => s.items);
  const projects = useData((s) => s.projects);
  const activeProjects = Object.values(projects).filter((p) => !p.archived && p.status !== 'completed');
  const summary = workSummary(
    Object.values(items).filter((i) => activeProjects.some((p) => p.id === i.projectId)),
    items,
  );
  const metrics = [
    { key: 'activeProjects', value: activeProjects.length, icon: CheckCircle2, to: '/roadmap', tone: false },
    { key: 'overdue', value: summary.overdue.length, icon: AlertCircle, to: '/my-work?scope=team&view=overdue', tone: summary.overdue.length > 0 },
    { key: 'upcoming', value: summary.upcoming.length, icon: Clock3, to: '/my-work?scope=team&view=week', tone: false },
    { key: 'blocked', value: summary.blocked.length, icon: GitBranch, to: '/my-work?scope=team&view=blocked', tone: false },
  ] as const;
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line sm:grid-cols-4">
      {metrics.map((m) => (
        <Link key={m.key} to={m.to} className="group min-w-0 border-r border-line px-4 py-3 transition-colors last:border-r-0 hover:bg-subtle">
          <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <m.icon size={14} />
            <span className="truncate">{t(`health.${m.key}`)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className={cn('text-[25px] font-semibold tabular-nums', m.tone && 'text-[var(--c-red-text)]')}>{m.value}</span>
            <ArrowUpRight size={15} className="text-fg-4 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </div>
        </Link>
      ))}
    </div>
  );
}

export function ProjectHealth({ projectId }: { projectId: string }) {
  const t = useT();
  const all = useData((s) => s.items);
  const people = useData((s) => s.people);
  const openPeek = useUI((s) => s.openPeek);
  const [selected, setSelected] = useState<'overdue' | 'blocked' | 'unassigned' | 'upcoming'>('overdue');
  const items = Object.values(all).filter((i) => i.projectId === projectId);
  const summary = workSummary(items, all);
  const workload = teamWorkload(items, people);
  const max = Math.max(1, ...workload.map((w) => w.count));
  const metrics = [
    { key: 'overdue', icon: AlertCircle },
    { key: 'blocked', icon: GitBranch },
    { key: 'unassigned', icon: UserRound },
    { key: 'upcoming', icon: Clock3 },
  ] as const;
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-6 rounded-lg border border-line p-4 lg:grid-cols-[minmax(0,1fr)_250px]"
      aria-label={t('health.title')}
    >
      <div className="min-w-0">
        <SectionTitle>{t('health.title')}</SectionTitle>
        <div className="mb-3 flex flex-wrap gap-1" aria-label={t('health.title')}>
          {metrics.map(({ key, icon: Icon }) => (
            <button
              key={key}
              aria-pressed={selected === key}
              onClick={() => setSelected(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors',
                selected === key ? 'bg-hover font-medium text-fg' : 'text-fg-3 hover:bg-hover',
              )}
            >
              <Icon size={13} />
              {t(`health.${key}`)}
              <span className={cn('ml-1 tabular-nums', key === 'overdue' && summary[key].length > 0 && 'text-[var(--c-red-text)]')}>
                {summary[key].length}
              </span>
            </button>
          ))}
        </div>
        <div className="min-h-[108px]">
          {summary[selected].length === 0 ? (
            <div className="flex items-start gap-2 rounded-md bg-subtle px-3 py-5 text-[13px] text-fg-3">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--c-green-text)]" />
              {t(`health.empty.${selected}`)}
            </div>
          ) : (
            sortWork(summary[selected])
              .slice(0, 3)
              .map((item) => (
                <button
                  key={item.id}
                  data-peek-keep
                  onClick={() => openPeek(item.id)}
                  className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-[13px] hover:bg-hover"
                >
                  <StatusIcon status={item.status} />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <Avatar person={people[item.assigneeId ?? '']} size={18} />
                  <ArrowUpRight size={13} className="text-fg-4" />
                </button>
              ))
          )}
        </div>
        {summary[selected].length > 3 && (
          <Link
            className="mt-2 inline-block text-[12px] text-fg-3 hover:text-fg"
            to={`/my-work?scope=team&view=${selected === 'upcoming' ? 'week' : selected}&project=${projectId}`}
          >
            {t('health.viewAll', { n: summary[selected].length })} →
          </Link>
        )}
      </div>
      <div className="min-w-0 lg:border-l lg:border-line lg:pl-5">
        <SectionTitle>{t('health.workload')}</SectionTitle>
        {!workload.length && <p className="text-[13px] text-fg-3">{t('health.noWork')}</p>}
        <div className="space-y-3">
          {workload.slice(0, 5).map((w) => (
            <Link
              key={w.id ?? 'none'}
              to={`/my-work?scope=team&project=${projectId}&assignee=${w.id ?? 'none'}`}
              className="block rounded hover:bg-subtle"
            >
              <div className="mb-1 flex items-center gap-1.5 text-[12px]">
                <Avatar person={w.person} size={17} />
                <span className="min-w-0 flex-1 truncate">{w.person?.name ?? t('health.unassigned')}</span>
                {w.overdue > 0 && (
                  <span className="text-[var(--c-red-text)]" title={t('health.overdue')}>
                    {w.overdue} !
                  </span>
                )}
                <span className="tabular-nums text-fg-3">{w.count}</span>
              </div>
              <div className="h-1 overflow-hidden rounded bg-hover">
                <div className="h-full rounded bg-fg-4" style={{ width: `${(w.count / max) * 100}%` }} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
