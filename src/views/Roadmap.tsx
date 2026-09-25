import { CalendarCheck, Columns3, GanttChart, Layers, ListChecks } from 'lucide-react';
import { useParams } from 'react-router';
import { useUI } from '@/lib/ui';
import { useT, type TKey } from '@/lib/i18n';
import { useViewState } from '@/lib/viewState';
import { Topbar } from '@/components/Topbar';
import { EntriesMenu } from '@/components/ui/Overlay';
import { Segmented } from '@/components/ui/bits';
import { BarButton, NewButton, ViewBar } from '@/components/ViewBar';
import { Timeline, type GroupBy, type Zoom } from './roadmap/Timeline';
import { NowNextLater } from './roadmap/NowNextLater';

export interface RoadmapSettings {
  mode: 'timeline' | 'nnl';
  zoom: Zoom;
  groupBy: GroupBy;
  showTasks: boolean;
}

export function RoadmapView() {
  const t = useT();
  const { projectId } = useParams();
  const global = !projectId;
  const openCreateItem = useUI((s) => s.openCreateItem);
  const [view, setView] = useViewState<RoadmapSettings>(`roadmap:${projectId ?? 'all'}`, {
    mode: 'timeline',
    zoom: 'month',
    groupBy: global ? 'project' : 'initiative',
    showTasks: false,
  });
  const set = (patch: Partial<RoadmapSettings>) => setView((v) => ({ ...v, ...patch }));
  const groups: GroupBy[] = global ? ['project', 'initiative', 'type', 'status', 'none'] : ['initiative', 'type', 'status', 'none'];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {global && <Topbar crumbs={[{ label: t('roadmap.portfolio'), icon: '🗺️' }]} />}
      {global && (
        <div className="full-width pb-1 pt-6">
          <h1 className="text-[32px] font-bold tracking-[-0.02em]">{t('roadmap.portfolio')}</h1>
        </div>
      )}
      <ViewBar
        value={view.mode}
        onChange={(mode) => set({ mode })}
        tabs={[
          { value: 'timeline', label: t('roadmap.timeline'), icon: <GanttChart size={15} /> },
          { value: 'nnl', label: t('roadmap.nnl'), icon: <Columns3 size={15} /> },
        ]}
      >
        {view.mode === 'timeline' && (
          <Segmented
            value={view.zoom}
            onChange={(zoom) => set({ zoom })}
            options={[
              { value: 'week', label: t('roadmap.zoom.week') },
              { value: 'month', label: t('roadmap.zoom.month') },
              { value: 'quarter', label: t('roadmap.zoom.quarter') },
            ]}
          />
        )}
        {view.mode === 'timeline' && (
          <EntriesMenu
            align="end"
            trigger={<BarButton icon={<Layers size={15} />}>{t(`roadmap.group.${view.groupBy}` as TKey)}</BarButton>}
            entries={groups.map((g) => ({
              key: g,
              label: t(`roadmap.group.${g}` as TKey),
              checked: view.groupBy === g,
              onSelect: () => set({ groupBy: g }),
            }))}
          />
        )}
        <BarButton icon={<ListChecks size={15} />} active={view.showTasks} onClick={() => set({ showTasks: !view.showTasks })}>
          {t('roadmap.showTasks')}
        </BarButton>
        {view.mode === 'timeline' && (
          <BarButton icon={<CalendarCheck size={15} />} onClick={() => window.dispatchEvent(new Event('done:roadmap-today'))}>
            {t('common.today')}
          </BarButton>
        )}
        <NewButton onClick={() => openCreateItem({ projectId, type: 'feature', status: 'planned' })}>{t('common.new')}</NewButton>
      </ViewBar>
      {view.mode === 'timeline' ? (
        <Timeline projectId={projectId} zoom={view.zoom} groupBy={view.groupBy} showTasks={view.showTasks} />
      ) : (
        <NowNextLater projectId={projectId} showTasks={view.showTasks} />
      )}
    </div>
  );
}
