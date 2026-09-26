import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays,
  ChartGantt,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  CircleDot,
  Copy,
  FileText,
  FolderInput,
  FolderOpen,
  FolderPlus,
  House,
  KanbanSquare,
  Link2,
  ListTodo,
  Moon,
  MoreHorizontal,
  Network,
  PenLine,
  Plus,
  Search,
  Settings,
  SmilePlus,
  Star,
  StarOff,
  Sun,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import { create } from 'zustand';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useT, type TKey } from '@/lib/i18n';
import { refPath, refTitle } from '@/lib/selectors';
import { cn, modKey } from '@/lib/utils';
import { useIsDark, useMediaQuery } from '@/lib/hooks';
import { deleteDocWithUndo, deleteGroupWithUndo, deleteProjectWithUndo } from '@/lib/actions';
import { Kbd, PageIcon } from './ui/bits';
import { ContextMenu, EntriesMenu, Tooltip, type MenuEntry } from './ui/Overlay';
import { IconButton } from './ui/Button';
import { IconPicker } from './pickers/IconPicker';
import { AccountStatus } from './AccountStatus';
import { TrashButton } from './Trash';
import type { Doc, ID, Project, ProjectGroup } from '@/lib/types';

export const PROJECT_TABS: { key: string; icon: typeof House; label: TKey }[] = [
  { key: 'overview', icon: CircleDot, label: 'tab.overview' },
  { key: 'roadmap', icon: ChartGantt, label: 'tab.roadmap' },
  { key: 'backlog', icon: ListTodo, label: 'tab.backlog' },
  { key: 'board', icon: KanbanSquare, label: 'tab.board' },
  { key: 'calendar', icon: CalendarDays, label: 'tab.calendar' },
  { key: 'map', icon: Network, label: 'tab.map' },
  { key: 'docs', icon: FileText, label: 'tab.docs' },
  { key: 'files', icon: FolderOpen, label: 'tab.files' },
];

/* ------------------------------ Sidebar UI state ------------------------------ */

type DragKind = 'project' | 'doc';
type DropPos = 'before' | 'after' | 'inside';
interface SidebarUI {
  drag: { kind: DragKind; id: ID } | null;
  hint: { id: ID; pos: DropPos } | null;
  renaming: ID | null;
  setDrag: (d: SidebarUI['drag']) => void;
  setHint: (h: SidebarUI['hint']) => void;
  setRenaming: (id: ID | null) => void;
}
const useSidebarUI = create<SidebarUI>()((set) => ({
  drag: null,
  hint: null,
  renaming: null,
  setDrag: (drag) => set({ drag, hint: null }),
  setHint: (hint) => set((s) => (s.hint?.id === hint?.id && s.hint?.pos === hint?.pos ? s : { hint })),
  setRenaming: (renaming) => set({ renaming }),
}));

function useStartRename() {
  return useSidebarUI((s) => s.setRenaming);
}

/* ---------------------------------- Sidebar ---------------------------------- */

export function Sidebar() {
  const t = useT();
  const navigate = useNavigate();
  const desktopCollapsed = useData((s) => s.prefs.sidebarCollapsed);
  const mobile = useMediaQuery('(max-width: 767px)');
  const mobileOpen = useUI((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUI((s) => s.setMobileSidebar);
  const collapsed = mobile ? !mobileOpen : desktopCollapsed;
  const location = useLocation();
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);
  useEffect(() => {
    if (!mobile || !mobileOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobile, mobileOpen, setMobileOpen]);
  const width = useData((s) => s.prefs.sidebarWidth);
  const setPrefs = useData((s) => s.setPrefs);
  const workspace = useData((s) => s.workspace);
  const favorites = useData((s) => s.prefs.favorites);
  const recent = useData((s) => s.prefs.recent);
  const planeConfigured = useData((s) => !!(s.plane.config.apiKey && s.plane.config.workspaceSlug));
  const projectsRec = useData((s) => s.projects);
  const groupsRec = useData((s) => s.groups);
  const docs = useData((s) => s.docs);
  const createProject = useData((s) => s.createProject);
  const createGroup = useData((s) => s.createGroup);
  const createDoc = useData((s) => s.createDoc);
  const setPalette = useUI((s) => s.setPalette);
  const isDark = useIsDark();
  const startRename = useStartRename();
  const drag = useSidebarUI((s) => s.drag);

  const groups = useMemo(() => Object.values(groupsRec).sort((a, b) => a.order - b.order), [groupsRec]);
  const ungrouped = useMemo(
    () =>
      Object.values(projectsRec)
        .filter((p) => !p.archived && (!p.groupId || !groupsRec[p.groupId]))
        .sort((a, b) => a.order - b.order),
    [projectsRec, groupsRec],
  );
  const rootPages = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => !d.projectId && !d.parentId)
        .sort((a, b) => a.order - b.order),
    [docs],
  );

  const [resizing, setResizing] = useState(false);
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setResizing(true);
      const startX = e.clientX;
      const startW = width;
      const move = (ev: PointerEvent) => setPrefs({ sidebarWidth: Math.min(420, Math.max(208, startW + ev.clientX - startX)) });
      const up = () => {
        setResizing(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [width, setPrefs],
  );

  const newProject = (groupId?: ID) => {
    const id = createProject({ name: '', groupId });
    if (!id) return;
    navigate(`/p/${id}/overview`);
  };
  const newGroup = () => {
    const id = createGroup({ name: '' });
    startRename(id);
  };
  const newPage = (parentId?: ID) => {
    const id = createDoc({ parentId });
    if (!id) return;
    if (parentId) useData.getState().setExpanded(`doc:${parentId}`, true);
    navigate(`/docs/${id}`);
  };

  return (
    <>
      {mobile && mobileOpen && (
        <button aria-label={t('nav.collapse')} onClick={() => setMobileOpen(false)} className="fixed inset-0 z-20 bg-black/20" />
      )}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 0 : width }}
        transition={resizing ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 42 }}
        inert={collapsed}
        aria-hidden={collapsed}
        aria-label={t('nav.projects')}
        className={cn(
          'workspace-sidebar z-20 h-full shrink-0 overflow-hidden border-line bg-sidebar',
          !collapsed && 'border-r',
          mobile ? 'fixed inset-y-0 left-0 shadow-lg' : 'relative',
        )}
      >
        <div className="flex h-full flex-col" style={{ width }}>
          {/* Workspace switcher */}
          <div className="group/ws flex h-12 items-center gap-1 px-2 pt-1">
            <EntriesMenu
              trigger={
                <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover">
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-elevated text-[14px] shadow-sm">
                    <PageIcon icon={workspace.icon} size={16} />
                  </span>
                  <span className="truncate text-[14px] font-semibold">{workspace.name}</span>
                  <ChevronDown size={14} className="shrink-0 text-fg-3" />
                </button>
              }
              entries={[
                { key: 'settings', icon: <Settings size={15} />, label: t('nav.settings'), onSelect: () => navigate('/settings') },
                {
                  key: 'theme',
                  icon: isDark ? <Sun size={15} /> : <Moon size={15} />,
                  label: t('cmd.toggleTheme'),
                  shortcut: `${modKey()}⇧L`,
                  onSelect: () => setPrefs({ theme: isDark ? 'light' : 'dark' }),
                },
              ]}
            />
            <Tooltip content={t('nav.collapse')} shortcut={`${modKey()} \\`}>
              <IconButton
                className="opacity-0 transition-opacity group-hover/ws:opacity-100 group-focus-within/ws:opacity-100"
                onClick={() => (mobile ? setMobileOpen(false) : setPrefs({ sidebarCollapsed: true }))}
                label={t('nav.collapse')}
              >
                <ChevronsLeft size={17} />
              </IconButton>
            </Tooltip>
          </div>

          {/* Primary navigation */}
          <nav className="px-2 pb-2">
            <button
              onClick={() => setPalette(true)}
              className="mb-2 mt-1 flex h-9 w-full items-center gap-2 rounded-lg border border-line-strong px-2.5 text-[14px] text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
            >
              <Search size={17} className="text-fg-3" />
              <span className="flex-1 text-left">{t('nav.search')}</span>
              <Kbd>{modKey()}K</Kbd>
            </button>
            <NavRow to="/" end icon={<House size={17} />} label={t('nav.home')} />
            <NavRow to="/my-work" icon={<ListTodo size={17} />} label={t('nav.myWork')} />
            <NavRow to="/calendar" icon={<CalendarDays size={17} />} label={t('nav.calendar')} />
            <NavRow to="/roadmap" icon={<ChartGantt size={17} />} label={t('nav.roadmap')} />
            <NavRow to="/files" icon={<FolderOpen size={17} />} label={t('nav.files')} />
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {recent.length > 0 && (
              <Section id="recent" title={t('nav.recent')}>
                {recent.slice(0, 3).map((ref) => {
                  const info = refTitle(ref);
                  return info ? (
                    <NavRow
                      key={`${ref.kind}:${ref.id}`}
                      to={refPath(ref)}
                      icon={<PageIcon icon={info.icon} size={18} />}
                      label={info.title || t('common.untitled')}
                    />
                  ) : null;
                })}
              </Section>
            )}
            {favorites.length > 0 && (
              <Section id="favorites" title={t('nav.favorites')}>
                {favorites.map((f) => {
                  const info = refTitle(f);
                  if (!info) return null;
                  return (
                    <NavRow
                      key={`${f.kind}:${f.id}`}
                      to={refPath(f)}
                      icon={<PageIcon icon={info.icon} size={17} />}
                      label={info.title || t('common.untitled')}
                    />
                  );
                })}
              </Section>
            )}

            <Section
              id="projects"
              title={t('nav.projects')}
              addMenu={[
                { key: 'p', icon: <Plus size={15} />, label: t('nav.newProject'), onSelect: () => newProject() },
                { key: 'g', icon: <FolderPlus size={15} />, label: t('nav.newGroup'), onSelect: newGroup },
              ]}
              addLabel={t('nav.newProject')}
            >
              {groups.map((g) => (
                <GroupBlock key={g.id} group={g} onNewProject={() => newProject(g.id)} />
              ))}
              {ungrouped.map((p) => (
                <ProjectRow key={p.id} project={p} />
              ))}
              {drag?.kind === 'project' && groups.length > 0 && <UngroupedDrop />}
            </Section>

            <Section id="pages" title={t('nav.pages')} onAdd={() => newPage()} addLabel={t('nav.newPage')}>
              {rootPages.length === 0 && <div className="px-2 py-1 text-[13px] text-fg-4">{t('nav.noPages')}</div>}
              {rootPages.map((d) => (
                <DocRow key={d.id} doc={d} depth={0} onAddChild={newPage} />
              ))}
            </Section>
          </div>

          <AccountStatus />

          {/* Footer */}
          <div className="border-t border-line px-2 py-2">
            <TrashButton />
            <NavRow to="/settings" icon={<Settings size={17} />} label={t('nav.settings')} />
            <NavLink
              to="/settings/plane"
              className="mt-1 flex h-[26px] items-center gap-2 rounded-md px-2 text-[12.5px] text-fg-3 transition-colors hover:bg-hover"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', planeConfigured ? 'bg-[var(--c-green-solid)]' : 'bg-fg-4')} />
              {planeConfigured ? t('nav.planeConnected') : t('nav.planeNotConnected')}
            </NavLink>
          </div>
        </div>

        {/* Resize handle */}
        <div
          onPointerDown={startResize}
          onDoubleClick={() => setPrefs({ sidebarWidth: 256 })}
          className={cn(
            'absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-line-strong',
            resizing && 'bg-accent-soft',
          )}
        />
      </motion.aside>
    </>
  );
}

/* ---------------------------------- Pieces ----------------------------------- */

function Section({
  id,
  title,
  children,
  onAdd,
  addMenu,
  addLabel,
}: {
  id: string;
  title: string;
  children: ReactNode;
  onAdd?: () => void;
  addMenu?: MenuEntry[];
  addLabel?: string;
}) {
  const key = `section:${id}`;
  const collapsed = useData((s) => s.prefs.expanded[key] === false);
  const setExpanded = useData((s) => s.setExpanded);
  const addButton = (
    <IconButton
      size="xs"
      onClick={onAdd}
      label={addLabel}
      className="opacity-0 group-hover/sec:opacity-100 group-focus-within/sec:opacity-100 data-[state=open]:opacity-100"
    >
      <Plus size={14} />
    </IconButton>
  );
  return (
    <div className="mt-3">
      <div className="group/sec flex h-[26px] items-center justify-between rounded-md px-2 transition-colors hover:bg-hover">
        <button onClick={() => setExpanded(key, collapsed)} className="flex flex-1 items-center gap-1 text-left text-[12px] font-medium text-fg-3">
          {title}
          <ChevronRight
            size={12}
            className={cn(
              'opacity-0 transition-[opacity,transform] group-hover/sec:opacity-100 group-focus-within/sec:opacity-100',
              !collapsed && 'rotate-90',
            )}
          />
        </button>
        {addMenu ? <EntriesMenu trigger={addButton} entries={addMenu} /> : onAdd && addButton}
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavRow({
  to,
  icon,
  label,
  end,
  depth = 0,
  actions,
  expandable,
  expanded,
  onToggle,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  end?: boolean;
  depth?: number;
  actions?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'sidebar-row group/row relative flex h-[32px] items-center gap-2 rounded-md pr-1 text-[14px] transition-colors duration-100',
          isActive ? 'bg-[var(--sidebar-selected)] font-medium text-fg' : 'text-fg-2 hover:bg-hover',
        )
      }
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <RowIcon icon={icon} expandable={expandable} expanded={expanded} onToggle={onToggle} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {actions && <RowActions>{actions}</RowActions>}
    </NavLink>
  );
}

/** Notion swaps the page icon for a disclosure chevron on hover. */
function RowIcon({ icon, expandable, expanded, onToggle }: { icon: ReactNode; expandable?: boolean; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center text-fg-3">
      <span
        className={cn(
          'flex items-center justify-center transition-opacity duration-100',
          expandable && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0',
        )}
      >
        {icon}
      </span>
      {expandable && (
        <button
          aria-label={expanded ? t('nav.collapse') : t('nav.expand')}
          aria-expanded={expanded}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle?.();
          }}
          className="absolute inset-0 flex items-center justify-center rounded opacity-0 transition-opacity duration-100 hover:bg-active group-hover/row:opacity-100 group-focus-within/row:opacity-100"
        >
          <ChevronRight size={14} className={cn('transition-transform duration-150', expanded && 'rotate-90')} />
        </button>
      )}
    </span>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[data-state=open]]:opacity-100"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </span>
  );
}

function InlineRename({ value, placeholder, onDone }: { value: string; placeholder: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={value}
      placeholder={placeholder}
      onClick={(e) => e.preventDefault()}
      onBlur={(e) => onDone(e.target.value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onDone(null);
      }}
      className="h-[24px] min-w-0 flex-1 rounded-[4px] border border-accent bg-bg px-1.5 text-[14px] shadow-[0_0_0_2px_var(--accent-soft)] outline-none"
    />
  );
}

function DropLine({ pos }: { pos: 'before' | 'after' }) {
  return (
    <motion.span
      layoutId="sidebar-drop-line"
      transition={{ type: 'spring', stiffness: 700, damping: 45 }}
      className={cn(
        'pointer-events-none absolute inset-x-1 z-10 h-[3px] rounded-full bg-accent/70',
        pos === 'before' ? '-top-[2px]' : '-bottom-[2px]',
      )}
    />
  );
}

/* ---------------------------------- Groups ----------------------------------- */

function GroupBlock({ group, onNewProject }: { group: ProjectGroup; onNewProject: () => void }) {
  const t = useT();
  const key = `group:${group.id}`;
  const expanded = useData((s) => s.prefs.expanded[key] !== false);
  const setExpanded = useData((s) => s.setExpanded);
  const updateGroup = useData((s) => s.updateGroup);
  const projectsRec = useData((s) => s.projects);
  const moveProject = useData((s) => s.moveProject);
  const renaming = useSidebarUI((s) => s.renaming === group.id);
  const setRenaming = useSidebarUI((s) => s.setRenaming);
  const drag = useSidebarUI((s) => s.drag);
  const hint = useSidebarUI((s) => (s.hint?.id === group.id ? s.hint : null));
  const setHint = useSidebarUI((s) => s.setHint);
  const setDrag = useSidebarUI((s) => s.setDrag);
  const [iconOpen, setIconOpen] = useState(false);
  const projects = useMemo(
    () =>
      Object.values(projectsRec)
        .filter((p) => p.groupId === group.id && !p.archived)
        .sort((a, b) => a.order - b.order),
    [projectsRec, group.id],
  );

  const entries: MenuEntry[] = [
    { key: 'rename', icon: <PenLine size={15} />, label: t('common.rename'), onSelect: () => setRenaming(group.id) },
    { key: 'icon', icon: <SmilePlus size={15} />, label: t('group.changeIcon'), onSelect: () => setTimeout(() => setIconOpen(true), 60) },
    { key: 'new', icon: <Plus size={15} />, label: t('group.addProject'), onSelect: onNewProject },
    { key: 's', separator: true },
    { key: 'delete', icon: <Trash2 size={15} />, label: t('group.delete'), danger: true, onSelect: () => deleteGroupWithUndo(group.id) },
  ];

  return (
    <div className="mb-0.5">
      <ContextMenu entries={entries}>
        <div
          onClick={() => !renaming && setExpanded(key, !expanded)}
          onDoubleClick={() => setRenaming(group.id)}
          onDragOver={(e) => {
            if (drag?.kind !== 'project') return;
            e.preventDefault();
            setHint({ id: group.id, pos: 'inside' });
          }}
          onDragLeave={() => hint && setHint(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (drag?.kind === 'project') {
              moveProject(drag.id, group.id);
              setExpanded(key, true);
            }
            setDrag(null);
          }}
          className={cn(
            'sidebar-row group/row relative flex h-[32px] cursor-pointer select-none items-center gap-2 rounded-md pl-2 pr-1 text-[14px] font-medium text-fg-2 transition-colors hover:bg-hover',
            hint && 'bg-accent-soft ring-1 ring-accent/50',
          )}
        >
          <IconPicker
            open={iconOpen}
            onOpenChange={setIconOpen}
            value={group.icon}
            onChange={(v) => updateGroup(group.id, { icon: v ?? '📂' })}
            allowRemove={false}
          >
            <button onClick={(e) => e.stopPropagation()} className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-active">
              <PageIcon icon={group.icon} size={16} />
            </button>
          </IconPicker>
          {renaming ? (
            <InlineRename
              value={group.name}
              placeholder={t('group.namePlaceholder')}
              onDone={(v) => {
                if (v !== null) updateGroup(group.id, { name: v || t('group.untitled') });
                else if (!group.name) updateGroup(group.id, { name: t('group.untitled') });
                setRenaming(null);
              }}
            />
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="truncate">{group.name || t('group.untitled')}</span>
              <ChevronDown size={13} className={cn('shrink-0 text-fg-4 transition-transform duration-150', !expanded && '-rotate-90')} />
            </span>
          )}
          {!renaming && (
            <RowActions>
              <EntriesMenu
                entries={entries}
                trigger={
                  <IconButton size="xs" label={t('common.more')}>
                    <MoreHorizontal size={14} />
                  </IconButton>
                }
              />
              <IconButton size="xs" label={t('group.addProject')} onClick={onNewProject}>
                <Plus size={14} />
              </IconButton>
            </RowActions>
          )}
        </div>
      </ContextMenu>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {projects.map((p) => (
              <ProjectRow key={p.id} project={p} depth={1} />
            ))}
            {projects.length === 0 && (
              <div className="py-1 text-[12.5px] text-fg-4" style={{ paddingLeft: 38 }}>
                {t('group.empty')}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UngroupedDrop() {
  const t = useT();
  const drag = useSidebarUI((s) => s.drag);
  const setDrag = useSidebarUI((s) => s.setDrag);
  const moveProject = useData((s) => s.moveProject);
  const [over, setOver] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 30 }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        if (drag?.kind === 'project') moveProject(drag.id, undefined);
        setDrag(null);
      }}
      className={cn(
        'mt-1 flex items-center justify-center rounded-md border border-dashed text-[12.5px] text-fg-3',
        over ? 'border-accent bg-accent-soft' : 'border-line-strong',
      )}
    >
      {t('group.none')}
    </motion.div>
  );
}

/* --------------------------------- Projects ---------------------------------- */

function ProjectRow({ project, depth = 0 }: { project: Project; depth?: number }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const key = `project:${project.id}`;
  const expanded = useData((s) => !!s.prefs.expanded[key]);
  const setExpanded = useData((s) => s.setExpanded);
  const isFav = useData((s) => s.prefs.favorites.some((f) => f.id === project.id));
  const groups = useData((s) => s.groups);
  const projectsRec = useData((s) => s.projects);
  const toggleFavorite = useData((s) => s.toggleFavorite);
  const updateProject = useData((s) => s.updateProject);
  const moveProject = useData((s) => s.moveProject);
  const duplicateProject = useData((s) => s.duplicateProject);
  const openCreateItem = useUI((s) => s.openCreateItem);
  const renaming = useSidebarUI((s) => s.renaming === project.id);
  const setRenaming = useSidebarUI((s) => s.setRenaming);
  const drag = useSidebarUI((s) => s.drag);
  const hint = useSidebarUI((s) => (s.hint?.id === project.id ? s.hint : null));
  const setHint = useSidebarUI((s) => s.setHint);
  const setDrag = useSidebarUI((s) => s.setDrag);
  const base = `/p/${project.id}`;
  const inProject = location.pathname.startsWith(`${base}/`) || location.pathname === base;

  const entries: MenuEntry[] = [
    {
      key: 'fav',
      icon: isFav ? <StarOff size={15} /> : <Star size={15} />,
      label: isFav ? t('common.removeFromFavorites') : t('common.addToFavorites'),
      onSelect: () => toggleFavorite({ kind: 'project', id: project.id }),
    },
    {
      key: 'link',
      icon: <Link2 size={15} />,
      label: t('common.copyLink'),
      onSelect: () => {
        void navigator.clipboard?.writeText(`${window.location.origin}${base}/overview`);
        toast({ message: t('common.copied') });
      },
    },
    {
      key: 'dup',
      icon: <Copy size={15} />,
      label: t('common.duplicate'),
      onSelect: () => {
        const id = duplicateProject(project.id);
        if (id) navigate(`/p/${id}/overview`);
      },
    },
    { key: 'rename', icon: <PenLine size={15} />, label: t('common.rename'), onSelect: () => setRenaming(project.id) },
    {
      key: 'move',
      icon: <FolderInput size={15} />,
      label: t('group.moveTo'),
      children: [
        { key: 'none', label: t('group.none'), checked: !project.groupId, onSelect: () => moveProject(project.id, undefined) },
        ...Object.values(groups)
          .sort((a, b) => a.order - b.order)
          .map<MenuEntry>((g) => ({
            key: g.id,
            icon: <PageIcon icon={g.icon} size={15} />,
            label: g.name || t('group.untitled'),
            checked: project.groupId === g.id,
            onSelect: () => moveProject(project.id, g.id),
          })),
      ],
    },
    { key: 's', separator: true },
    {
      key: 'delete',
      icon: <Trash2 size={15} />,
      label: t('project.delete'),
      danger: true,
      onSelect: () => {
        if (inProject) navigate('/');
        deleteProjectWithUndo(project.id);
      },
    },
  ];

  const onDrop = () => {
    if (drag?.kind === 'project' && hint && drag.id !== project.id) {
      const siblings = Object.values(projectsRec)
        .filter((p) => p.groupId === project.groupId && p.id !== drag.id)
        .sort((a, b) => a.order - b.order);
      const idx = siblings.findIndex((p) => p.id === project.id);
      const beforeId = hint.pos === 'before' ? project.id : siblings[idx + 1]?.id;
      moveProject(drag.id, project.groupId && groups[project.groupId] ? project.groupId : undefined, beforeId);
    }
    setDrag(null);
  };

  return (
    <div>
      <ContextMenu entries={entries}>
        <NavLink
          to={`${base}/overview`}
          draggable={!renaming}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', project.name);
            setDrag({ kind: 'project', id: project.id });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (drag?.kind !== 'project' || drag.id === project.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setHint({ id: project.id, pos: e.clientY < r.top + r.height / 2 ? 'before' : 'after' });
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            setRenaming(project.id);
          }}
          className={cn(
            'sidebar-row group/row relative flex h-[32px] items-center gap-2 rounded-md pr-1 text-[14px] transition-colors duration-100',
            inProject && !expanded ? 'bg-active font-medium text-fg' : 'text-fg-2 hover:bg-hover',
            drag?.id === project.id && 'opacity-40',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {hint && hint.pos !== 'inside' && <DropLine pos={hint.pos} />}
          <RowIcon icon={<PageIcon icon={project.icon} size={17} />} expandable expanded={expanded} onToggle={() => setExpanded(key, !expanded)} />
          {renaming ? (
            <InlineRename
              value={project.name}
              placeholder={t('project.namePlaceholder')}
              onDone={(v) => {
                if (v) updateProject(project.id, { name: v });
                setRenaming(null);
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{project.name || t('project.untitled')}</span>
          )}
          {!renaming && (
            <RowActions>
              <EntriesMenu
                entries={entries}
                trigger={
                  <IconButton size="xs" label={t('common.more')}>
                    <MoreHorizontal size={14} />
                  </IconButton>
                }
              />
              <IconButton size="xs" label={t('item.new')} onClick={() => openCreateItem({ projectId: project.id })}>
                <Plus size={14} />
              </IconButton>
            </RowActions>
          )}
        </NavLink>
      </ContextMenu>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {PROJECT_TABS.map((tab) => (
              <NavRow key={tab.key} to={`${base}/${tab.key}`} depth={depth + 1} icon={<tab.icon size={15} />} label={t(tab.label)} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ----------------------------------- Pages ----------------------------------- */

function DocRow({ doc, depth, onAddChild }: { doc: Doc; depth: number; onAddChild: (parentId: ID) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const isActive = !!useMatch(`/docs/${doc.id}`);
  const key = `doc:${doc.id}`;
  const expanded = useData((s) => !!s.prefs.expanded[key]);
  const setExpanded = useData((s) => s.setExpanded);
  const docs = useData((s) => s.docs);
  const isFav = useData((s) => s.prefs.favorites.some((f) => f.id === doc.id));
  const toggleFavorite = useData((s) => s.toggleFavorite);
  const updateDoc = useData((s) => s.updateDoc);
  const moveDoc = useData((s) => s.moveDoc);
  const duplicateDoc = useData((s) => s.duplicateDoc);
  const renaming = useSidebarUI((s) => s.renaming === doc.id);
  const setRenaming = useSidebarUI((s) => s.setRenaming);
  const drag = useSidebarUI((s) => s.drag);
  const hint = useSidebarUI((s) => (s.hint?.id === doc.id ? s.hint : null));
  const setHint = useSidebarUI((s) => s.setHint);
  const setDrag = useSidebarUI((s) => s.setDrag);
  const children = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.parentId === doc.id)
        .sort((a, b) => a.order - b.order),
    [docs, doc.id],
  );

  const entries: MenuEntry[] = [
    {
      key: 'fav',
      icon: isFav ? <StarOff size={15} /> : <Star size={15} />,
      label: isFav ? t('common.removeFromFavorites') : t('common.addToFavorites'),
      onSelect: () => toggleFavorite({ kind: 'doc', id: doc.id }),
    },
    {
      key: 'link',
      icon: <Link2 size={15} />,
      label: t('common.copyLink'),
      onSelect: () => {
        void navigator.clipboard?.writeText(`${window.location.origin}/docs/${doc.id}`);
        toast({ message: t('common.copied') });
      },
    },
    {
      key: 'dup',
      icon: <Copy size={15} />,
      label: t('common.duplicate'),
      onSelect: () => {
        const id = duplicateDoc(doc.id);
        if (id) navigate(`/docs/${id}`);
      },
    },
    { key: 'rename', icon: <PenLine size={15} />, label: t('common.rename'), onSelect: () => setRenaming(doc.id) },
    { key: 'sub', icon: <Plus size={15} />, label: t('docs.addSubpage'), onSelect: () => onAddChild(doc.id) },
    { key: 's', separator: true },
    { key: 'delete', icon: <Trash2 size={15} />, label: t('docs.delete'), danger: true, onSelect: () => deleteDocWithUndo(doc.id) },
  ];

  const onDrop = () => {
    if (drag?.kind === 'doc' && hint && drag.id !== doc.id) {
      if (hint.pos === 'inside') {
        moveDoc(drag.id, doc.id);
        setExpanded(key, true);
      } else {
        const siblings = Object.values(docs)
          .filter((d) => d.parentId === doc.parentId && d.projectId === doc.projectId && d.id !== drag.id)
          .sort((a, b) => a.order - b.order);
        const idx = siblings.findIndex((d) => d.id === doc.id);
        moveDoc(drag.id, doc.parentId, hint.pos === 'before' ? doc.id : siblings[idx + 1]?.id);
      }
    }
    setDrag(null);
  };

  return (
    <div>
      <ContextMenu entries={entries}>
        <NavLink
          to={`/docs/${doc.id}`}
          draggable={!renaming}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', doc.title);
            setDrag({ kind: 'doc', id: doc.id });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (drag?.kind !== 'doc' || drag.id === doc.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - r.top;
            setHint({ id: doc.id, pos: y < r.height * 0.28 ? 'before' : y > r.height * 0.72 ? 'after' : 'inside' });
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            setRenaming(doc.id);
          }}
          // Radix Slot (context menu trigger) can't merge NavLink's function className, so compute it here.
          className={cn(
            'sidebar-row group/row relative flex h-[32px] items-center gap-2 rounded-md pr-1 text-[14px] transition-colors duration-100',
            isActive ? 'bg-[var(--sidebar-selected)] font-medium text-fg' : 'text-fg-2 hover:bg-hover',
            hint?.pos === 'inside' && 'bg-accent-soft ring-1 ring-accent/50',
            drag?.id === doc.id && 'opacity-40',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {hint && hint.pos !== 'inside' && <DropLine pos={hint.pos} />}
          <RowIcon
            icon={doc.icon ? <PageIcon icon={doc.icon} size={17} /> : <FileText size={16} />}
            expandable
            expanded={expanded}
            onToggle={() => setExpanded(key, !expanded)}
          />
          {renaming ? (
            <InlineRename
              value={doc.title}
              placeholder={t('docs.titlePlaceholder')}
              onDone={(v) => {
                if (v !== null) updateDoc(doc.id, { title: v });
                setRenaming(null);
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{doc.title || t('common.untitled')}</span>
          )}
          {!renaming && (
            <RowActions>
              <EntriesMenu
                entries={entries}
                trigger={
                  <IconButton size="xs" label={t('common.more')}>
                    <MoreHorizontal size={14} />
                  </IconButton>
                }
              />
              <IconButton size="xs" label={t('docs.addSubpage')} onClick={() => onAddChild(doc.id)}>
                <Plus size={14} />
              </IconButton>
            </RowActions>
          )}
        </NavLink>
      </ContextMenu>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {children.length ? (
              children.map((c) => <DocRow key={c.id} doc={c} depth={depth + 1} onAddChild={onAddChild} />)
            ) : (
              <div className="py-1 text-[13px] text-fg-4" style={{ paddingLeft: 36 + (depth + 1) * 14 }}>
                {t('common.empty')}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
