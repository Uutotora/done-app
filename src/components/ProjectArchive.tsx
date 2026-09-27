import { StatePanel } from '@/components/StatePanel';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArchiveRestore, ArrowUpRight, MoreHorizontal, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { create } from 'zustand';
import { useData } from '@/lib/store';
import { isAdmin, useAuth, useProjectLevel } from '@/lib/auth';
import { useLang, useT } from '@/lib/i18n';
import { timeAgo } from '@/lib/dates';
import { archivedProjects } from '@/lib/archive';
import { deleteProjectWithUndo, restoreArchivedProject } from '@/lib/actions';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { sidebarRow } from './sidebarStyles';
import { Button, IconButton } from './ui/Button';
import { Dialog, EntriesMenu, Tooltip, type MenuEntry } from './ui/Overlay';
import { PageIcon } from './ui/bits';

/** Open state lives outside the sidebar so the command palette can open the archive too. */
const useArchiveDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openProjectArchive = () => useArchiveDialog.setState({ open: true });
const closeProjectArchive = () => useArchiveDialog.setState({ open: false });

/** "Archive" row at the bottom of the sidebar, next to the trash. */
export function ArchiveButton() {
  const t = useT();
  const open = useArchiveDialog((s) => s.open);
  const count = useData((s) => Object.values(s.projects).filter((p) => p.archived).length);
  return (
    <button onClick={openProjectArchive} className={cn(sidebarRow(false), open && 'bg-[var(--sb-selected)]')} style={{ paddingLeft: 8 }}>
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[var(--sb-icon)]">
        <Archive size={18} strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1 truncate">{t('nav.archive')}</span>
      {count > 0 && <span className="pr-1 text-[12px] font-normal text-[var(--sb-muted)]">{count}</span>}
    </button>
  );
}

/** Archived projects with search, like Notion's trash: open, bring back or delete. */
export function ProjectArchiveDialog() {
  const t = useT();
  const open = useArchiveDialog((s) => s.open);
  const projects = useData((s) => s.projects);
  const groups = useData((s) => s.groups);
  const [q, setQ] = useState('');
  const all = useMemo(() => archivedProjects(projects, groups), [projects, groups]);
  const list = useMemo(() => (q.trim() ? archivedProjects(projects, groups, q) : all), [projects, groups, q, all]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        closeProjectArchive();
        setQ('');
      }}
      position="top"
      className="flex max-w-[560px] flex-col"
      title={t('archive.title')}
      description={t('archive.hint')}
    >
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <Archive size={17} className="text-fg-3" />
        <div className="flex-1 text-[15px] font-semibold">{t('archive.title')}</div>
        {all.length > 0 && <span className="text-[12.5px] text-fg-3">{all.length}</span>}
      </div>
      {all.length > 0 && (
        <div className="mx-3 mt-2 flex h-8 items-center gap-2 rounded-md border border-line bg-[var(--bg-input)] px-2.5">
          <Search size={14} className="shrink-0 text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('archive.search')}
            aria-label={t('archive.search')}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-4"
          />
        </div>
      )}
      <div className="max-h-[min(420px,60vh)] min-h-[120px] overflow-y-auto p-1.5">
        {all.length === 0 ? (
          <StatePanel compact illustration="workspace" title={t('archive.empty')}>
            {t('archive.emptyHint')}
          </StatePanel>
        ) : list.length === 0 ? (
          <div className="flex h-[120px] items-center justify-center text-[13.5px] text-fg-3">{t('cmd.noResults')}</div>
        ) : (
          <AnimatePresence initial={false}>
            {list.map((p) => (
              <ArchivedRow key={p.id} project={p} />
            ))}
          </AnimatePresence>
        )}
      </div>
      <div className="border-t border-line px-4 py-2.5 text-[12px] text-fg-3">{t('archive.hint')}</div>
    </Dialog>
  );
}

function ArchivedRow({ project }: { project: Project }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const group = useData((s) => (project.groupId ? s.groups[project.groupId] : undefined));
  const level = useProjectLevel(project.id);
  const canEdit = level === 'editor' || level === 'full';
  const canDelete = useAuth((s) => s.mode !== 'signedIn' || isAdmin(s.user) || (!!s.user && project.createdBy === s.user.id));
  const name = project.name || t('project.untitled');
  const openProject = () => {
    closeProjectArchive();
    navigate(`/p/${project.id}/overview`);
  };
  const entries: MenuEntry[] = [
    { key: 'open', icon: <ArrowUpRight size={15} />, label: t('common.open'), onSelect: openProject },
    ...(canEdit
      ? [{ key: 'restore', icon: <ArchiveRestore size={15} />, label: t('project.unarchive'), onSelect: () => restoreArchivedProject(project.id) }]
      : []),
    ...(canDelete
      ? [
          { key: 's', separator: true as const },
          {
            key: 'delete',
            icon: <Trash2 size={15} />,
            label: t('project.delete'),
            danger: true,
            onSelect: () => {
              if (location.pathname.startsWith(`/p/${project.id}/`) || location.pathname === `/p/${project.id}`) navigate('/');
              deleteProjectWithUndo(project.id);
            },
          },
        ]
      : []),
  ];
  const meta = [
    group ? group.name || t('group.untitled') : '',
    project.archivedAt ? t('archive.archivedWhen', { when: timeAgo(project.archivedAt, lang) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className="group/archived flex min-h-12 items-center gap-1 rounded-md pr-1.5 hover:bg-hover has-[[data-state=open]]:bg-hover"
    >
      <button
        onClick={openProject}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-md px-2 py-1.5 text-left outline-offset-[-2px]"
      >
        <PageIcon icon={project.icon} size={20} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{name}</span>
          {meta && <span className="block truncate text-[12px] text-fg-3">{meta}</span>}
        </span>
      </button>
      {canEdit && (
        <Tooltip content={t('project.unarchive')}>
          <Button
            size="sm"
            variant="ghost"
            icon={<ArchiveRestore size={14} />}
            onClick={() => restoreArchivedProject(project.id)}
            aria-label={t('project.unarchive')}
            className="px-1.5 sm:px-2"
          >
            <span className="hidden sm:inline">{t('archive.restoreShort')}</span>
          </Button>
        </Tooltip>
      )}
      <EntriesMenu
        align="end"
        entries={entries}
        trigger={
          <IconButton size="md" label={t('common.more')}>
            <MoreHorizontal size={16} />
          </IconButton>
        }
      />
    </motion.div>
  );
}

/** Calm notice at the top of an archived project's pages. */
export function ArchivedProjectBanner({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useT();
  return (
    <div
      role="status"
      className="flex min-h-9 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-subtle px-4 py-1.5 text-center text-[13px] text-fg-2"
    >
      <span className="flex items-center gap-2">
        <Archive size={14} className="shrink-0 text-fg-3" />
        {t('archive.banner')}
      </span>
      {canEdit && (
        <Button size="xs" variant="secondary" icon={<ArchiveRestore size={13} />} onClick={() => restoreArchivedProject(projectId)}>
          {t('project.unarchive')}
        </Button>
      )}
    </div>
  );
}
