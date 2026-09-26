import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays,
  ChartGantt,
  ChevronRight,
  CircleDot,
  Copy,
  FileText,
  FolderInput,
  FolderOpen,
  FolderPlus,
  House,
  Inbox,
  IterationCw,
  KanbanSquare,
  Link2,
  ListTodo,
  MoreHorizontal,
  Network,
  PanelLeft,
  PenLine,
  Plus,
  SmilePlus,
  SquarePen,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import { create } from 'zustand';
import { useData } from '@/lib/store';
import { useUI, toast, showSidebarPeek, hideSidebarPeek } from '@/lib/ui';
import { useUnreadCount } from '@/lib/inbox';
import { usePresence } from '@/lib/presence';
import { useT, type TKey } from '@/lib/i18n';
import { cn, modKey } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';
import { deleteDocWithUndo, deleteGroupWithUndo, deleteProjectWithUndo } from '@/lib/actions';
import { Avatar, Kbd, PageIcon } from './ui/bits';
import { ContextMenu, EntriesMenu, Tooltip, type MenuEntry } from './ui/Overlay';
import { IconPicker } from './pickers/IconPicker';
import { WorkspaceBar } from './AccountStatus';
import { TrashButton } from './Trash';
import { SIDEBAR_ICON_BUTTON, sidebarRow } from './sidebarStyles';
import type { Doc, ID, Project, ProjectGroup, Ref } from '@/lib/types';

export const PROJECT_TABS: { key: string; icon: typeof House; label: TKey }[] = [
  { key: 'overview', icon: CircleDot, label: 'tab.overview' },
  { key: 'roadmap', icon: ChartGantt, label: 'tab.roadmap' },
  { key: 'backlog', icon: ListTodo, label: 'tab.backlog' },
  { key: 'board', icon: KanbanSquare, label: 'tab.board' },
  { key: 'sprints', icon: IterationCw, label: 'tab.sprints' },
  { key: 'calendar', icon: CalendarDays, label: 'tab.calendar' },
  { key: 'map', icon: Network, label: 'tab.map' },
  { key: 'docs', icon: FileText, label: 'tab.docs' },
  { key: 'files', icon: FolderOpen, label: 'tab.files' },
];

/** Where a row lives. The same page can show up in Recents, Favorites and the tree at once. */
type Scope = 'tree' | 'recent' | 'fav';

/* ------------------------------ Sidebar UI state ------------------------------ */

type DragKind = 'project' | 'doc';
type DropPos = 'before' | 'after' | 'inside';
interface SidebarUI {
  drag: { kind: DragKind; id: ID } | null;
  hint: { id: ID; pos: DropPos } | null;
  /** `${scope}:${id}` of the row being renamed inline. */
  renaming: string | null;
  setDrag: (d: SidebarUI['drag']) => void;
  setHint: (h: SidebarUI['hint']) => void;
  setRenaming: (key: string | null) => void;
}
const useSidebarUI = create<SidebarUI>()((set) => ({
  drag: null,
  hint: null,
  renaming: null,
  setDrag: (drag) => set({ drag, hint: null }),
  setHint: (hint) => set((s) => (s.hint?.id === hint?.id && s.hint?.pos === hint?.pos ? s : { hint })),
  setRenaming: (renaming) => set({ renaming }),
}));

const expandKey = (scope: Scope, kind: string, id: ID) => (scope === 'tree' ? `${kind}:${id}` : `${scope}:${kind}:${id}`);

/* ---------------------------------- Sidebar ---------------------------------- */

export function Sidebar() {
  const t = useT();
  const desktopCollapsed = useData((s) => s.prefs.sidebarCollapsed);
  const mobile = useMediaQuery('(max-width: 767px)');
  const mobileOpen = useUI((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUI((s) => s.setMobileSidebar);
  const peek = useUI((s) => s.sidebarPeek);
  const collapsed = mobile ? !mobileOpen : desktopCollapsed;
  const floating = !mobile && desktopCollapsed;
  const location = useLocation();
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);
  useEffect(() => {
    if (!floating) useUI.setState({ sidebarPeek: false });
  }, [floating]);
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

  return (
    <>
      {mobile && mobileOpen && (
        <button aria-label={t('nav.collapse')} onClick={() => setMobileOpen(false)} className="fixed inset-0 z-20 bg-black/25" />
      )}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 0 : width }}
        transition={resizing ? { duration: 0 } : { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        inert={collapsed}
        aria-hidden={collapsed}
        aria-label={t('nav.projects')}
        className={cn(
          'workspace-sidebar z-20 h-full shrink-0 overflow-hidden bg-sidebar',
          !collapsed && 'shadow-[inset_-1px_0_0_var(--sb-divider)]',
          mobile ? 'fixed inset-y-0 left-0 shadow-lg' : 'relative',
        )}
      >
        <SidebarBody width={width} />

        {/* Resize handle: Notion shows a thin line on the edge while hovering it. */}
        <div
          onPointerDown={startResize}
          onDoubleClick={() => setPrefs({ sidebarWidth: 256 })}
          className="group/resize absolute right-0 top-0 z-10 flex h-full w-1.5 cursor-col-resize justify-end"
        >
          <span className={cn('h-full w-[2px] group-hover/resize:bg-[var(--sb-border)]', resizing && 'bg-accent!')} />
        </div>
      </motion.aside>

      {floating && (
        <>
          {/* Hot zone along the left edge that brings the sidebar in while it is closed. */}
          <div
            aria-hidden
            className="fixed inset-y-0 left-0 z-30 w-2.5"
            onPointerEnter={() => showSidebarPeek(80)}
            onPointerLeave={() => hideSidebarPeek(400)}
          />
          <AnimatePresence>
            {peek && (
              <motion.aside
                key="peek"
                aria-label={t('nav.projects')}
                initial={{ x: -width - 16 }}
                animate={{ x: 0 }}
                exit={{ x: -width - 16 }}
                transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
                onPointerEnter={() => showSidebarPeek()}
                onPointerLeave={() => hideSidebarPeek()}
                className="sidebar-floating fixed bottom-2 left-0 top-11 z-40 overflow-hidden rounded-r-[10px] bg-sidebar shadow-lg"
                style={{ width }}
              >
                <SidebarBody width={width} floating />
              </motion.aside>
            )}
          </AnimatePresence>
        </>
      )}
    </>
  );
}

function SidebarBody({ width, floating }: { width: number; floating?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const mobile = useMediaQuery('(max-width: 767px)');
  const setMobileOpen = useUI((s) => s.setMobileSidebar);
  const setPrefs = useData((s) => s.setPrefs);
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
  const unread = useUnreadCount();
  const inboxActive = !!useMatch('/inbox');
  const setRenaming = useSidebarUI((s) => s.setRenaming);
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

  const newProject = (groupId?: ID) => {
    const id = createProject({ name: '', groupId });
    if (!id) return;
    navigate(`/p/${id}/overview`);
  };
  const newGroup = () => {
    const id = createGroup({ name: '' });
    if (id) setRenaming(`tree:${id}`);
  };
  const newPage = (parentId?: ID) => {
    const id = createDoc({ parentId });
    if (!id) return;
    if (parentId) useData.getState().setExpanded(`doc:${parentId}`, true);
    navigate(`/docs/${id}`);
  };
  const toggleSidebar = () => {
    if (mobile) setMobileOpen(false);
    else if (floating) {
      useUI.setState({ sidebarPeek: false });
      setPrefs({ sidebarCollapsed: false });
    } else setPrefs({ sidebarCollapsed: true });
  };

  return (
    <div className="flex h-full flex-col" style={{ width }}>
      {/* Top row: sidebar toggle, inbox and a new page, like Notion. */}
      <div className="flex h-12 shrink-0 items-center gap-0.5 px-2 pt-1.5">
        <Tooltip content={floating ? t('nav.pin') : t('nav.collapse')} shortcut={`${modKey()} \\`}>
          <button aria-label={floating ? t('nav.pin') : t('nav.collapse')} onClick={toggleSidebar} className={SIDEBAR_ICON_BUTTON}>
            <PanelLeft size={18} strokeWidth={1.7} />
          </button>
        </Tooltip>
        <span className="flex-1" />
        <Tooltip content={t('nav.inbox')} shortcut="G I">
          {/* Radix Slot (tooltip trigger) cannot merge NavLink's function className, so pass a string. */}
          <NavLink
            to="/inbox"
            aria-label={t('nav.inbox')}
            className={cn(SIDEBAR_ICON_BUTTON, 'relative', inboxActive && 'bg-[var(--sb-selected)] text-[var(--sb-text-strong)]')}
          >
            <Inbox size={18} strokeWidth={1.7} />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#eb5757] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[var(--bg-sidebar)]">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
        </Tooltip>
        <Tooltip content={t('nav.newPage')}>
          <button aria-label={t('nav.newPage')} onClick={() => newPage()} className={SIDEBAR_ICON_BUTTON}>
            <SquarePen size={17} strokeWidth={1.7} />
          </button>
        </Tooltip>
      </div>

      <div className="shrink-0 px-2">
        <button
          onClick={() => setPalette(true)}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-[var(--sb-border)] px-2.5 text-[14px] text-[var(--sb-placeholder)] transition-colors duration-[20ms] hover:bg-[var(--sb-hover)]"
        >
          <span className="flex-1 text-left">{t('nav.search')}</span>
          <Kbd className="border-0 bg-[var(--sb-hover)] text-[var(--sb-placeholder)]">{modKey()}K</Kbd>
        </button>
        <nav aria-label={t('nav.home')} className="mt-3 flex items-center gap-1">
          <Tab to="/" end icon={<House size={17} strokeWidth={1.8} />} label={t('nav.home')} primary />
          <Tab to="/my-work" icon={<ListTodo size={17} strokeWidth={1.8} />} label={t('nav.myWork')} />
          <Tab to="/calendar" icon={<CalendarDays size={17} strokeWidth={1.8} />} label={t('nav.calendar')} />
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-3">
        <NavRow to="/roadmap" icon={<ChartGantt size={18} strokeWidth={1.7} />} label={t('nav.roadmap')} />
        <NavRow to="/files" icon={<FolderOpen size={18} strokeWidth={1.7} />} label={t('nav.files')} />

        {recent.length > 0 && (
          <Section id="recent" title={t('nav.recent')}>
            {recent.slice(0, 5).map((ref) => (
              <RefRow key={`${ref.kind}:${ref.id}`} refItem={ref} scope="recent" onAddChild={newPage} />
            ))}
          </Section>
        )}
        {favorites.length > 0 && (
          <Section id="favorites" title={t('nav.favorites')}>
            {favorites.map((ref) => (
              <RefRow key={`${ref.kind}:${ref.id}`} refItem={ref} scope="fav" onAddChild={newPage} />
            ))}
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
          {rootPages.length === 0 && <div className="flex h-[30px] items-center pl-2.5 text-[13px] text-[var(--sb-muted)]">{t('nav.noPages')}</div>}
          {rootPages.map((d) => (
            <DocRow key={d.id} doc={d} depth={0} onAddChild={newPage} />
          ))}
        </Section>

        <div className="mt-4">
          <TrashButton />
          <NavLink to="/settings/plane" className={({ isActive }) => sidebarRow(isActive)} style={{ paddingLeft: 8 }}>
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
              <span className={cn('h-2 w-2 rounded-full', planeConfigured ? 'bg-[var(--c-green-solid)]' : 'bg-[var(--sb-icon)] opacity-60')} />
            </span>
            <span className="min-w-0 flex-1 truncate">{planeConfigured ? t('nav.planeConnected') : t('nav.planeNotConnected')}</span>
          </NavLink>
        </div>
      </div>

      <WorkspaceBar />
    </div>
  );
}

/* ---------------------------------- Pieces ----------------------------------- */

/** Home / My tasks / Calendar: the active one shows its label in a pill, the rest are icons. */
function Tab({ to, icon, label, end, primary }: { to: string; icon: ReactNode; label: string; end?: boolean; primary?: boolean }) {
  const active = !!useMatch({ path: to, end: !!end });
  const onHome = !!useMatch({ path: '/', end: true });
  const onMyWork = !!useMatch('/my-work');
  const onCalendar = !!useMatch('/calendar');
  const onAnyTab = onHome || onMyWork || onCalendar;
  // Like Notion's Home tab, the primary tab stays selected while you are elsewhere in the workspace.
  const selected = active || (!!primary && !onAnyTab);
  const showLabel = selected;
  const link = (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={cn(
        'flex h-8 shrink-0 items-center gap-2 rounded-lg text-[14px] font-medium transition-colors duration-[20ms] ease-in',
        showLabel ? 'px-2.5' : 'w-8 justify-center',
        selected ? 'bg-[var(--sb-selected)] text-[var(--sb-text-strong)]' : 'text-[var(--sb-icon)] hover:bg-[var(--sb-hover)]',
      )}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </NavLink>
  );
  return showLabel ? link : <Tooltip content={label}>{link}</Tooltip>;
}

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
    <button aria-label={addLabel} onClick={onAdd} className={cn(ACTION_BUTTON, 'hidden group-hover/sec:flex data-[state=open]:flex')}>
      <Plus size={16} strokeWidth={1.8} />
    </button>
  );
  return (
    <div className="mt-3.5">
      <div className="group/sec mb-px flex h-[30px] items-center rounded-md pl-2 pr-1 transition-colors duration-[20ms] ease-in hover:bg-[var(--sb-hover)]">
        <button
          onClick={() => setExpanded(key, collapsed)}
          aria-expanded={!collapsed}
          className="flex h-full flex-1 items-center text-left text-[12px] font-medium text-[var(--sb-muted)]"
        >
          {title}
        </button>
        {addMenu ? <EntriesMenu trigger={addButton} entries={addMenu} /> : onAdd && addButton}
      </div>
      {!collapsed && children}
    </div>
  );
}

const ACTION_BUTTON =
  'h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--sb-icon)] transition-colors duration-[20ms] hover:bg-[var(--sb-hover-strong)] hover:text-[var(--sb-text)] flex';

function NavRow({ to, icon, label, end }: { to: string; icon: ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => sidebarRow(isActive)} style={{ paddingLeft: 8 }}>
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[var(--sb-icon)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </NavLink>
  );
}

/**
 * Leading icon of a row. As in Notion, hovering the row swaps the icon for a
 * disclosure arrow right away, without fading.
 */
function RowIcon({ icon, expandable, expanded, onToggle }: { icon: ReactNode; expandable?: boolean; expanded?: boolean; onToggle?: () => void }) {
  const t = useT();
  return (
    <span className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[var(--sb-icon)]">
      <span className={cn('flex items-center justify-center', expandable && 'group-hover/row:invisible group-has-[:focus-visible]/row:invisible')}>
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
          className="absolute inset-0 hidden items-center justify-center rounded-[5px] hover:bg-[var(--sb-hover-strong)] group-hover/row:flex group-has-[:focus-visible]/row:flex"
        >
          <ChevronRight size={16} strokeWidth={1.8} className={cn('transition-transform duration-150 ease-out', expanded && 'rotate-90')} />
        </button>
      )}
    </span>
  );
}

/** "+" and "•••" on the right of a hovered row. */
function RowActions({ children }: { children: ReactNode }) {
  return (
    <span
      className="hidden shrink-0 items-center group-hover/row:flex group-has-[:focus-visible]/row:flex has-[[data-state=open]]:flex"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </span>
  );
}

function MoreButton({ entries, label }: { entries: MenuEntry[]; label: string }) {
  return (
    <EntriesMenu
      entries={entries}
      trigger={
        <button aria-label={label} className={ACTION_BUTTON}>
          <MoreHorizontal size={16} strokeWidth={1.8} />
        </button>
      }
    />
  );
}

/** Teammates currently looking at something inside this project. */
function ProjectPresence({ projectId }: { projectId: ID }) {
  const peers = usePresence((s) => s.peers);
  const meId = useData((s) => s.meId);
  const people = useData((s) => s.people);
  const here = peers.filter((p) => p.id !== meId && peerProjectId(p.path) === projectId && people[p.id]);
  if (!here.length) return null;
  return (
    <span className="mr-1 flex items-center group-hover/row:hidden" title={here.map((p) => p.name).join(', ')}>
      {here.slice(0, 3).map((p, i) => (
        <Avatar key={p.id} person={people[p.id]} size={16} ring className={i ? '-ml-1' : ''} />
      ))}
    </span>
  );
}

function peerProjectId(path: string): ID | undefined {
  const [, section, id] = /^\/(p|items|docs)\/([^/?#]+)/.exec(path) ?? [];
  if (section === 'p') return id;
  const s = useData.getState();
  if (section === 'items') return s.items[id]?.projectId;
  if (section === 'docs') return s.docs[id]?.projectId;
  return undefined;
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
      className="h-6 min-w-0 flex-1 rounded-[4px] border border-accent bg-bg px-1.5 text-[14px] shadow-[0_0_0_2px_var(--accent-soft)] outline-none"
    />
  );
}

function DropLine({ pos }: { pos: 'before' | 'after' }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute inset-x-1 z-10 h-[3px] rounded-full bg-accent/70',
        pos === 'before' ? '-top-[2px]' : '-bottom-[2px]',
      )}
    />
  );
}

/** A project or page from Recents or Favorites, with the same hover controls as in the tree. */
function RefRow({ refItem, scope, onAddChild }: { refItem: Ref; scope: Scope; onAddChild: (parentId: ID) => void }) {
  const project = useData((s) => (refItem.kind === 'project' ? s.projects[refItem.id] : undefined));
  const doc = useData((s) => (refItem.kind === 'doc' ? s.docs[refItem.id] : undefined));
  if (project) return <ProjectRow project={project} scope={scope} />;
  if (doc) return <DocRow doc={doc} depth={0} scope={scope} onAddChild={onAddChild} />;
  return null;
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
  const renaming = useSidebarUI((s) => s.renaming === `tree:${group.id}`);
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
    { key: 'rename', icon: <PenLine size={15} />, label: t('common.rename'), onSelect: () => setRenaming(`tree:${group.id}`) },
    { key: 'icon', icon: <SmilePlus size={15} />, label: t('group.changeIcon'), onSelect: () => setTimeout(() => setIconOpen(true), 60) },
    { key: 'new', icon: <Plus size={15} />, label: t('group.addProject'), onSelect: onNewProject },
    { key: 's', separator: true },
    { key: 'delete', icon: <Trash2 size={15} />, label: t('group.delete'), danger: true, onSelect: () => deleteGroupWithUndo(group.id) },
  ];

  return (
    <div>
      <ContextMenu entries={entries}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => !renaming && setExpanded(key, !expanded)}
          onKeyDown={(e) => {
            if (!renaming && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setExpanded(key, !expanded);
            }
          }}
          onDoubleClick={() => setRenaming(`tree:${group.id}`)}
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
          className={cn(sidebarRow(false), 'cursor-pointer text-[var(--sb-text-group)]', hint && 'bg-accent-soft ring-1 ring-accent/50')}
          style={{ paddingLeft: 8 }}
        >
          <IconPicker
            open={iconOpen}
            onOpenChange={setIconOpen}
            value={group.icon}
            onChange={(v) => updateGroup(group.id, { icon: v ?? '📂' })}
            allowRemove={false}
          >
            <span
              onClick={(e) => e.stopPropagation()}
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[var(--sb-hover)]"
            >
              <PageIcon icon={group.icon} size={15} />
            </span>
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
            <span className="min-w-0 flex-1 truncate">{group.name || t('group.untitled')}</span>
          )}
          {!renaming && (
            <RowActions>
              <button aria-label={t('group.addProject')} onClick={onNewProject} className={ACTION_BUTTON}>
                <Plus size={16} strokeWidth={1.8} />
              </button>
              <MoreButton entries={entries} label={t('common.more')} />
            </RowActions>
          )}
        </div>
      </ContextMenu>
      {expanded && (
        <>
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} depth={1} />
          ))}
          {projects.length === 0 && (
            <div className="flex h-[30px] items-center text-[13px] text-[var(--sb-muted)]" style={{ paddingLeft: 8 + 12 + 30 }}>
              {t('group.empty')}
            </div>
          )}
        </>
      )}
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
    <div
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
        'mt-1 flex h-[30px] items-center justify-center rounded-md border border-dashed text-[12.5px] text-[var(--sb-muted)]',
        over ? 'border-accent bg-accent-soft' : 'border-[var(--sb-border)]',
      )}
    >
      {t('group.none')}
    </div>
  );
}

/* --------------------------------- Projects ---------------------------------- */

function ProjectRow({ project, depth = 0, scope = 'tree' }: { project: Project; depth?: number; scope?: Scope }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const key = expandKey(scope, 'project', project.id);
  const renameKey = `${scope}:${project.id}`;
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
  const renaming = useSidebarUI((s) => s.renaming === renameKey);
  const setRenaming = useSidebarUI((s) => s.setRenaming);
  const drag = useSidebarUI((s) => s.drag);
  const hint = useSidebarUI((s) => (scope === 'tree' && s.hint?.id === project.id ? s.hint : null));
  const setHint = useSidebarUI((s) => s.setHint);
  const setDrag = useSidebarUI((s) => s.setDrag);
  const base = `/p/${project.id}`;
  const inProject = location.pathname.startsWith(`${base}/`) || location.pathname === base;
  const draggable = scope === 'tree' && !renaming;

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
    { key: 'rename', icon: <PenLine size={15} />, label: t('common.rename'), onSelect: () => setRenaming(renameKey) },
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
          draggable={draggable}
          onDragStart={(e) => {
            if (!draggable) return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', project.name);
            setDrag({ kind: 'project', id: project.id });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (scope !== 'tree' || drag?.kind !== 'project' || drag.id === project.id) return;
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
            setRenaming(renameKey);
          }}
          className={cn(sidebarRow(inProject && !expanded), drag?.id === project.id && 'opacity-40')}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          {hint && hint.pos !== 'inside' && <DropLine pos={hint.pos} />}
          <RowIcon icon={<PageIcon icon={project.icon} size={19} />} expandable expanded={expanded} onToggle={() => setExpanded(key, !expanded)} />
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
          {!renaming && scope === 'tree' && <ProjectPresence projectId={project.id} />}
          {!renaming && (
            <RowActions>
              <button aria-label={t('item.new')} onClick={() => openCreateItem({ projectId: project.id })} className={ACTION_BUTTON}>
                <Plus size={16} strokeWidth={1.8} />
              </button>
              <MoreButton entries={entries} label={t('common.more')} />
            </RowActions>
          )}
        </NavLink>
      </ContextMenu>
      {expanded &&
        PROJECT_TABS.map((tab) => (
          <NavLink
            key={tab.key}
            to={`${base}/${tab.key}`}
            className={({ isActive }) => sidebarRow(isActive)}
            style={{ paddingLeft: 8 + (depth + 1) * 12 }}
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[var(--sb-icon)]">
              <tab.icon size={16} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1 truncate">{t(tab.label)}</span>
          </NavLink>
        ))}
    </div>
  );
}

/* ----------------------------------- Pages ----------------------------------- */

function DocRow({ doc, depth, onAddChild, scope = 'tree' }: { doc: Doc; depth: number; onAddChild: (parentId: ID) => void; scope?: Scope }) {
  const t = useT();
  const navigate = useNavigate();
  const isActive = !!useMatch(`/docs/${doc.id}`);
  const key = expandKey(scope, 'doc', doc.id);
  const renameKey = `${scope}:${doc.id}`;
  const expanded = useData((s) => !!s.prefs.expanded[key]);
  const setExpanded = useData((s) => s.setExpanded);
  const docs = useData((s) => s.docs);
  const isFav = useData((s) => s.prefs.favorites.some((f) => f.id === doc.id));
  const toggleFavorite = useData((s) => s.toggleFavorite);
  const updateDoc = useData((s) => s.updateDoc);
  const moveDoc = useData((s) => s.moveDoc);
  const duplicateDoc = useData((s) => s.duplicateDoc);
  const renaming = useSidebarUI((s) => s.renaming === renameKey);
  const setRenaming = useSidebarUI((s) => s.setRenaming);
  const drag = useSidebarUI((s) => s.drag);
  const hint = useSidebarUI((s) => (scope === 'tree' && s.hint?.id === doc.id ? s.hint : null));
  const setHint = useSidebarUI((s) => s.setHint);
  const setDrag = useSidebarUI((s) => s.setDrag);
  const draggable = scope === 'tree' && !renaming;
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
    { key: 'rename', icon: <PenLine size={15} />, label: t('common.rename'), onSelect: () => setRenaming(renameKey) },
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
          draggable={draggable}
          onDragStart={(e) => {
            if (!draggable) return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', doc.title);
            setDrag({ kind: 'doc', id: doc.id });
          }}
          onDragEnd={() => setDrag(null)}
          onDragOver={(e) => {
            if (scope !== 'tree' || drag?.kind !== 'doc' || drag.id === doc.id) return;
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
            setRenaming(renameKey);
          }}
          // Radix Slot (context menu trigger) can't merge NavLink's function className, so compute it here.
          className={cn(sidebarRow(isActive), hint?.pos === 'inside' && 'bg-accent-soft ring-1 ring-accent/50', drag?.id === doc.id && 'opacity-40')}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          {hint && hint.pos !== 'inside' && <DropLine pos={hint.pos} />}
          <RowIcon
            icon={doc.icon ? <PageIcon icon={doc.icon} size={19} /> : <FileText size={18} strokeWidth={1.7} />}
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
              <button aria-label={t('docs.addSubpage')} onClick={() => onAddChild(doc.id)} className={ACTION_BUTTON}>
                <Plus size={16} strokeWidth={1.8} />
              </button>
              <MoreButton entries={entries} label={t('common.more')} />
            </RowActions>
          )}
        </NavLink>
      </ContextMenu>
      {expanded &&
        (children.length ? (
          children.map((c) => <DocRow key={c.id} doc={c} depth={depth + 1} onAddChild={onAddChild} scope={scope} />)
        ) : (
          <div className="flex h-[30px] items-center text-[13px] text-[var(--sb-muted)]" style={{ paddingLeft: 8 + (depth + 1) * 12 + 30 }}>
            {t('docs.noSubpages')}
          </div>
        ))}
    </div>
  );
}
