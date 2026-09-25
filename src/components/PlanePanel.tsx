import { motion } from 'motion/react';
import { ExternalLink, Link2Off, RefreshCw, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { listPlaneProjects, planeReady, syncPlaneProject, type PlaneProjectInfo } from '@/lib/plane';
import { formatShortDate, timeAgo, todayISO } from '@/lib/dates';
import type { ID, PlaneStateGroup } from '@/lib/types';
import { Button, IconButton } from './ui/Button';
import { Popover } from './ui/Overlay';
import { OptionList } from './pickers/OptionList';
import { Progress, SectionTitle } from './ui/bits';

const GROUP_ORDER: PlaneStateGroup[] = ['completed', 'started', 'unstarted', 'backlog', 'cancelled'];
const GROUP_FILL: Record<PlaneStateGroup, string> = {
  completed: 'var(--c-green-solid)',
  started: 'var(--c-yellow-solid)',
  unstarted: 'var(--c-blue-solid)',
  backlog: 'var(--c-gray-solid)',
  cancelled: 'var(--c-red-solid)',
  triage: 'var(--c-purple-solid)',
};

/** Engineering progress for a project, pulled from Plane. */
export function PlanePanel({ projectId }: { projectId: ID }) {
  const t = useT();
  const lang = useLang();
  const project = useData((s) => s.projects[projectId]);
  const cfg = useData((s) => s.plane.config);
  const snap = useData((s) => s.plane.snapshots[projectId]);
  const updateProject = useData((s) => s.updateProject);
  const setSnapshot = useData((s) => s.setPlaneSnapshot);
  const [syncing, setSyncing] = useState(false);
  const [options, setOptions] = useState<PlaneProjectInfo[] | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const ready = planeReady(cfg);

  const counts = useMemo(() => {
    const c: Record<PlaneStateGroup, number> = { backlog: 0, unstarted: 0, started: 0, completed: 0, cancelled: 0, triage: 0 };
    if (!snap) return c;
    const byId = new Map(snap.states.map((s) => [s.id, s.group]));
    for (const i of snap.issues) c[(i.stateId && byId.get(i.stateId)) || 'backlog']++;
    return c;
  }, [snap]);
  const total = snap?.issues.length ?? 0;
  const cycle = useMemo(() => {
    const today = todayISO();
    return snap?.cycles.find((c) => c.startDate && c.endDate && c.startDate <= today && c.endDate >= today) ?? snap?.cycles.at(-1);
  }, [snap]);

  const sync = async () => {
    setSyncing(true);
    const res = await syncPlaneProject(projectId);
    setSyncing(false);
    toast({ message: res.message, tone: res.ok ? 'success' : 'error' });
  };

  const loadOptions = async () => {
    try {
      setOptions(await listPlaneProjects(cfg));
    } catch (e) {
      toast({ message: t('plane.error', { error: e instanceof Error ? e.message : String(e) }), tone: 'error' });
      setPickOpen(false);
    }
  };

  const linkPicker = (
    <Popover
      open={pickOpen}
      onOpenChange={(o) => {
        setPickOpen(o);
        if (o && !options) void loadOptions();
      }}
      trigger={
        <Button size="sm" variant="secondary">
          {t('plane.pick')}
        </Button>
      }
    >
      {options ? (
        <OptionList
          options={options.map((o) => ({ value: o.id, label: o.name, hint: o.identifier }))}
          selected={project?.plane?.projectId}
          onSelect={(v) => {
            const o = options.find((x) => x.id === v)!;
            updateProject(projectId, { plane: { projectId: o.id, identifier: o.identifier, name: o.name } });
            setSnapshot(projectId, undefined);
            setPickOpen(false);
            setTimeout(() => void syncPlaneProject(projectId).then((r) => toast({ message: r.message, tone: r.ok ? 'success' : 'error' })), 0);
          }}
        />
      ) : (
        <div className="w-[240px] space-y-2 p-3">
          <div className="skeleton h-4 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      )}
    </Popover>
  );

  return (
    <section>
      <SectionTitle
        action={
          project?.plane && (
            <div className="flex items-center gap-0.5">
              {ready && !snap?.demo && (
                <IconButton label={t('plane.sync')} onClick={sync} disabled={syncing}>
                  <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                </IconButton>
              )}
              <IconButton
                label={t('plane.unlink')}
                onClick={() => {
                  updateProject(projectId, { plane: undefined });
                  setSnapshot(projectId, undefined);
                }}
              >
                <Link2Off size={14} />
              </IconButton>
            </div>
          )
        }
      >
        <span className="flex items-center gap-2">
          <PlaneLogo />
          {t('project.stats.dev')}
        </span>
      </SectionTitle>

      <div className="rounded-xl border border-line p-4">
        {!project?.plane ? (
          <div className="text-[13.5px] text-fg-3">
            <p className="mb-3">{t('plane.connectCta')}</p>
            {ready ? (
              linkPicker
            ) : (
              <Link to="/settings/plane">
                <Button size="sm" variant="secondary" icon={<Settings2 size={14} />}>
                  {t('nav.planeNotConnected')}
                </Button>
              </Link>
            )}
          </div>
        ) : !snap ? (
          <div className="text-[13.5px] text-fg-3">
            <p className="mb-3">
              <span className="font-mono font-medium text-fg-2">{project.plane.identifier}</span> · {project.plane.name}
            </p>
            <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} loading={syncing} onClick={sync} disabled={!ready}>
              {syncing ? t('plane.syncing') : t('plane.sync')}
            </Button>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[22px] font-semibold tabular-nums">{total ? Math.round((counts.completed / total) * 100) : 0}%</span>
              <span className="text-[12.5px] text-fg-3">{t('plane.issues', { n: total })}</span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-active">
              {GROUP_ORDER.map((g) =>
                counts[g] ? (
                  <motion.div
                    key={g}
                    initial={{ width: 0 }}
                    animate={{ width: `${(counts[g] / total) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                    style={{ background: GROUP_FILL[g] }}
                    className="h-full"
                  />
                ) : null,
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
              {GROUP_ORDER.filter((g) => counts[g]).map((g) => (
                <div key={g} className="flex items-center gap-2 text-[12.5px] text-fg-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: GROUP_FILL[g] }} />
                  <span className="flex-1">{t(`plane.group.${g}`)}</span>
                  <span className="tabular-nums text-fg-3">{counts[g]}</span>
                </div>
              ))}
            </div>
            {cycle && (
              <div className="mt-4 rounded-lg bg-hover p-3">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="font-medium text-fg-2">
                    {t('plane.cycle')}: {cycle.name}
                  </span>
                  {cycle.endDate && <span className="text-fg-3">→ {formatShortDate(cycle.endDate, lang)}</span>}
                </div>
                {cycle.total ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={(cycle.completed ?? 0) / cycle.total} color="blue" />
                    <span className="shrink-0 text-[12px] tabular-nums text-fg-3">
                      {cycle.completed ?? 0}/{cycle.total}
                    </span>
                  </div>
                ) : null}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between text-[12px] text-fg-4">
              <span>{snap.demo ? t('common.demo') : t('plane.lastSync', { time: timeAgo(snap.syncedAt, lang) })}</span>
              {!snap.demo && cfg.webUrl && (
                <a
                  href={`${cfg.webUrl.replace(/\/+$/, '')}/${cfg.workspaceSlug}/projects/${snap.projectId}/issues/`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 hover:text-fg-2"
                >
                  Plane <ExternalLink size={11} />
                </a>
              )}
            </div>
            {snap.demo && ready && <div className="mt-3">{linkPicker}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

export function PlaneLogo({ size = 16 }: { size?: number }) {
  // Simplified geometric mark, not the official Plane logo.
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="3.5" fill="#3f76ff" />
      <path d="M5 4.5h3.2v3.2H11v3.8H7.8V8.3H5z" fill="white" />
    </svg>
  );
}
