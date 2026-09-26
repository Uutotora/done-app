import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { Eye, MessageSquare, MoreHorizontal, Plus, Trash2, Link2 } from 'lucide-react';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useT } from '@/lib/i18n';
import { deleteProjectWithUndo } from '@/lib/actions';
import { Topbar } from '@/components/Topbar';
import { PROJECT_TABS } from '@/components/Sidebar';
import { IconButton, Button } from '@/components/ui/Button';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/Overlay';
import { PageIcon } from '@/components/ui/bits';
import { IconPicker } from '@/components/pickers/IconPicker';
import { ProjectShareDialog } from '@/components/access/ProjectShare';
import { isAdmin, useAuth, useProjectLevel } from '@/lib/auth';
import { NotFound } from '../NotFound';
import { cn } from '@/lib/utils';

export function ProjectLayout() {
  const t = useT();
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const project = useData((s) => (projectId ? s.projects[projectId] : undefined));
  const updateProject = useData((s) => s.updateProject);
  const touchRecent = useData((s) => s.touchRecent);
  const openCreateItem = useUI((s) => s.openCreateItem);
  const tab = location.pathname.split('/')[3] ?? 'overview';
  const level = useProjectLevel(projectId);
  const canEdit = level === 'editor' || level === 'full';
  const canDelete = useAuth((s) => s.mode !== 'signedIn' || isAdmin(s.user) || (!!s.user && project?.createdBy === s.user.id));
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (projectId && project) touchRecent({ kind: 'project', id: projectId });
    // Record the visit once per project.
  }, [projectId]);

  if (!project) return <NotFound />;
  const isOverview = tab === 'overview';
  const tabLabel = PROJECT_TABS.find((x) => x.key === tab)?.label;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        crumbs={[
          { label: project.name || t('project.untitled'), icon: project.icon, to: `/p/${project.id}/overview` },
          ...(tabLabel && !isOverview ? [{ label: t(tabLabel) }] : []),
        ]}
        favorite={{ kind: 'project', id: project.id }}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setSharing(true)} className="text-fg">
              {t('share.button')}
            </Button>
            {canEdit && (
              <Button size="sm" variant="primary" icon={<Plus size={15} />} onClick={() => openCreateItem({ projectId: project.id })}>
                {t('common.new')}
              </Button>
            )}
            <Menu
              align="end"
              trigger={
                <IconButton size="md" label={t('common.more')}>
                  <MoreHorizontal size={17} />
                </IconButton>
              }
            >
              <MenuItem
                icon={<Link2 size={15} />}
                onSelect={() => {
                  void navigator.clipboard?.writeText(window.location.href);
                  toast({ message: t('common.copied') });
                }}
              >
                {t('common.copyLink')}
              </MenuItem>
              {canDelete && <MenuSeparator />}
              {canDelete && (
                <MenuItem
                  danger
                  icon={<Trash2 size={15} />}
                  onSelect={() => {
                    navigate('/');
                    deleteProjectWithUndo(project.id);
                  }}
                >
                  {t('project.delete')}
                </MenuItem>
              )}
            </Menu>
          </>
        }
      />
      {!canEdit && level && (
        <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-line bg-subtle px-4 text-[12.5px] text-fg-3">
          {level === 'commenter' ? <MessageSquare size={13} /> : <Eye size={13} />}
          {level === 'commenter' ? t('readonly.commenter') : t('readonly.viewer')}
        </div>
      )}
      {!isOverview && (
        <div className="full-width flex items-center gap-3 pb-1 pt-3">
          <IconPicker value={project.icon} onChange={(v) => updateProject(project.id, { icon: v ?? '📁' })} allowRemove={false}>
            <button disabled={!canEdit} className="flex h-9 w-9 items-center justify-center rounded-md enabled:hover:bg-hover">
              <PageIcon icon={project.icon} size={26} />
            </button>
          </IconPicker>
          <input
            key={project.id}
            readOnly={!canEdit}
            defaultValue={project.name}
            placeholder={t('project.untitled')}
            onBlur={(e) => e.target.value !== project.name && updateProject(project.id, { name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="min-w-0 flex-1 bg-transparent text-[24px] font-bold tracking-[-0.01em] outline-none placeholder:text-fg-4"
          />
        </div>
      )}
      <ProjectTabs projectId={project.id} active={tab} sticky={!isOverview} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
      {sharing && <ProjectShareDialog projectId={project.id} open onOpenChange={setSharing} />}
    </div>
  );
}

export function ProjectTabs({ projectId, active, sticky }: { projectId: string; active: string; sticky?: boolean }) {
  const t = useT();
  if (active === 'overview') return null;
  return <TabsBar projectId={projectId} active={active} className={cn(sticky && 'border-b border-line')} t={t} />;
}

export function TabsBar({ projectId, active, className, t }: { projectId: string; active: string; className?: string; t: ReturnType<typeof useT> }) {
  return (
    <div className={cn('full-width no-scrollbar flex shrink-0 items-end gap-1 overflow-x-auto', className)}>
      {PROJECT_TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <NavLink
            key={tab.key}
            to={`/p/${projectId}/${tab.key}`}
            className={cn(
              'relative flex h-10 shrink-0 items-center gap-1.5 rounded-t-md px-2.5 text-[14px] transition-colors',
              isActive ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            <tab.icon size={15} />
            {t(tab.label)}
            {isActive && <span className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-fg" />}
          </NavLink>
        );
      })}
    </div>
  );
}
