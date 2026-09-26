import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  PenLine,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { useViewState } from '@/lib/viewState';
import { useFileDrop, useHotkey } from '@/lib/hooks';
import { defaultLinkName, domainOf, fileCategory, folderPath, linkService, looksLikeUrl, normalizeUrl, uniqueName, uploadFiles } from '@/lib/files';
import { getFileBlob, getFileUrl } from '@/lib/storage';
import { deleteNodesWithUndo } from '@/lib/actions';
import { formatShortDate } from '@/lib/dates';
import { useProjectsList } from '@/lib/selectors';
import type { FileNode, ID, Project } from '@/lib/types';
import { cn, downloadBlob, formatBytes, isEditableTarget, matches, modKey } from '@/lib/utils';
import { Topbar } from '@/components/Topbar';
import { ViewBar, BarButton, NewButton } from '@/components/ViewBar';
import { SearchToggle } from '@/components/QueryControls';
import { ContextMenu, EntriesMenu, Tooltip, type MenuEntry } from '@/components/ui/Overlay';
import { IconButton } from '@/components/ui/Button';
import { PageIcon } from '@/components/ui/bits';
import { FolderGlyph, NodeIcon } from '@/components/files/NodeIcon';

type ViewMode = 'grid' | 'list';
type SortKey = 'name' | 'updated' | 'size' | 'kind';
const DRAG_MIME = 'application/x-done-nodes';

export function FilesView() {
  const t = useT();
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const files = useData((s) => s.files);
  const project = useData((s) => (projectId ? s.projects[projectId] : undefined));
  const createFolder = useData((s) => s.createFolder);
  const createLink = useData((s) => s.createLink);
  const lang = useLang();
  const openLinkDialog = useUI((s) => s.openLinkDialog);
  const openPreview = useUI((s) => s.openPreview);
  const [settings, setSettings] = useViewState<{ view: ViewMode; sort: SortKey }>(`files:${projectId ?? 'ws'}`, { view: 'grid', sort: 'name' });
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastClicked = useRef<ID | null>(null);

  const rawFolder = params.get('folder') || undefined;
  const folder = rawFolder && files[rawFolder]?.kind === 'folder' && files[rawFolder].projectId === projectId ? files[rawFolder] : undefined;
  const folderId = folder?.id;
  const path = useMemo(() => folderPath(folderId, files), [folderId, files]);

  const openFolder = useCallback(
    (id?: ID) => {
      setSelected(new Set());
      setParams(id ? { folder: id } : {}, { replace: false });
    },
    [setParams],
  );

  // Deep links from search or Home: ?open=<fileId> opens the preview.
  useEffect(() => {
    const open = params.get('open');
    if (open && files[open]) {
      openPreview(open);
      const next = new URLSearchParams(params);
      next.delete('open');
      setParams(next, { replace: true });
    }
  }, [params, files, openPreview, setParams]);

  const drive = useMemo(() => Object.values(files).filter((n) => n.projectId === projectId), [files, projectId]);
  const visible = useMemo(() => {
    const list = q ? drive.filter((n) => matches(`${n.name} ${n.url ?? ''} ${n.note ?? ''}`, q)) : drive.filter((n) => n.parentId === folderId);
    const rank = (n: FileNode) => (n.kind === 'folder' ? 0 : 1);
    const cmp = (a: FileNode, b: FileNode) => {
      switch (settings.sort) {
        case 'updated':
          return b.updatedAt.localeCompare(a.updatedAt);
        case 'size':
          return (b.size ?? 0) - (a.size ?? 0);
        case 'kind':
          return (
            a.kind.localeCompare(b.kind) ||
            fileCategory(a.name, a.mime).localeCompare(fileCategory(b.name, b.mime)) ||
            a.name.localeCompare(b.name, undefined, { numeric: true })
          );
        default:
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
    };
    return list.sort((a, b) => rank(a) - rank(b) || cmp(a, b));
  }, [drive, folderId, q, settings.sort]);

  const upload = async (list: File[]) => {
    if (!list.length) return;
    setUploading((n) => n + list.length);
    await uploadFiles(list, { projectId, parentId: folderId });
    setUploading((n) => Math.max(0, n - list.length));
    toast({ message: t('files.uploaded', { n: list.length }), tone: 'success' });
  };
  const drop = useFileDrop((list) => void upload(list));

  const newFolder = () => {
    const id = createFolder({
      name: uniqueName(
        t('files.newFolder'),
        visible.filter((n) => n.kind === 'folder'),
      ),
      projectId,
      parentId: folderId,
    });
    setRenaming(id);
  };

  // Paste a URL anywhere in the drive to save it as a link, like pasting into Notion.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (looksLikeUrl(text)) {
        const url = normalizeUrl(text)!;
        e.preventDefault();
        createLink({ name: defaultLinkName(url, lang), url, projectId, parentId: folderId });
        toast({ message: t('files.linkAdded'), tone: 'success' });
        return;
      }
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        void upload(pasted);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  useHotkey('escape', () => setSelected(new Set()), { enabled: selected.size > 0 });

  const toggleSelect = (id: ID, e: { shiftKey: boolean }) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClicked.current) {
        const ids = visible.map((n) => n.id);
        const a = ids.indexOf(lastClicked.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClicked.current = id;
  };

  const openNode = (n: FileNode) => {
    if (n.kind === 'folder') openFolder(n.id);
    else if (n.kind === 'link' && n.url) window.open(n.url, '_blank', 'noopener,noreferrer');
    else openPreview(n.id);
  };

  const rootLabel = project ? project.name : t('files.workspaceDrive');
  const showDrives = !projectId && !folderId && !q;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...drop.bind}>
      {!projectId && <Topbar crumbs={[{ label: t('files.title'), icon: '🗂️' }]} />}
      {!projectId && (
        <div className="full-width pb-1 pt-6">
          <h1 className="text-[32px] font-bold tracking-[-0.02em]">{t('files.title')}</h1>
        </div>
      )}
      <ViewBar
        value={settings.view}
        onChange={(view) => setSettings((s) => ({ ...s, view }))}
        tabs={[
          { value: 'grid', label: t('files.grid'), icon: <LayoutGrid size={15} /> },
          { value: 'list', label: t('files.list'), icon: <List size={15} /> },
        ]}
      >
        <SearchToggle value={q} onChange={setQ} />
        <EntriesMenu
          align="end"
          trigger={<BarButton icon={<ArrowUpDown size={15} />}>{t(`files.sort.${settings.sort}` as TKey)}</BarButton>}
          entries={(['name', 'updated', 'size', 'kind'] as SortKey[]).map((k) => ({
            key: k,
            label: t(`files.sort.${k}` as TKey),
            checked: settings.sort === k,
            onSelect: () => setSettings((s) => ({ ...s, sort: k })),
          }))}
        />
        <BarButton icon={<FolderPlus size={15} />} onClick={newFolder}>
          {t('files.newFolder')}
        </BarButton>
        <BarButton icon={<Link2 size={15} />} onClick={() => openLinkDialog({ projectId, parentId: folderId })}>
          {t('files.link')}
        </BarButton>
        <NewButton onClick={() => inputRef.current?.click()}>
          <Upload size={14} /> {t('common.upload')}
        </NewButton>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </ViewBar>

      {/* Breadcrumbs: each crumb is also a drop target */}
      <div className="full-width flex h-11 shrink-0 items-center gap-0.5 text-[14px]">
        <Crumb
          label={rootLabel}
          icon={project ? <PageIcon icon={project.icon} size={15} /> : <FolderGlyph size={16} color="gray" />}
          active={!folderId && !q}
          onClick={() => openFolder(undefined)}
          dropTarget={{ parentId: undefined, projectId }}
        />
        {!q &&
          path.map((f) => (
            <span key={f.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight size={14} className="shrink-0 text-fg-4" />
              <Crumb
                label={f.name}
                icon={<FolderGlyph size={16} />}
                active={f.id === folderId}
                onClick={() => openFolder(f.id)}
                dropTarget={{ parentId: f.id, projectId }}
              />
            </span>
          ))}
        {q && (
          <span className="flex items-center gap-0.5 text-fg-3">
            <ChevronRight size={14} className="text-fg-4" />
            {t('files.searchResults', { n: visible.length })}
          </span>
        )}
        <span className="flex-1" />
        <AnimatePresence>
          {uploading > 0 && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="shimmer-text text-[13px] font-medium">
              {t('files.uploading', { n: uploading })}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
        <div className="full-width pb-32">
          {showDrives && <DrivesRow />}
          {visible.length === 0 ? (
            <EmptyDrive
              q={q}
              onUpload={() => inputRef.current?.click()}
              onFolder={newFolder}
              onLink={() => openLinkDialog({ projectId, parentId: folderId })}
            />
          ) : settings.view === 'grid' ? (
            <div className={FILE_GRID}>
              <AnimatePresence initial={false}>
                {visible.map((n) => (
                  <NodeCard
                    key={n.id}
                    node={n}
                    selected={selected.has(n.id)}
                    selection={selected}
                    renaming={renaming === n.id}
                    onRenamed={() => setRenaming(null)}
                    onRename={() => setRenaming(n.id)}
                    onOpen={() => openNode(n)}
                    onSelect={(e) => toggleSelect(n.id, e)}
                    showPath={!!q}
                  />
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="flex h-9 items-center border-b border-line bg-subtle/60 pr-3 text-[12.5px] text-fg-3">
                <span className="w-11" />
                <span className="flex-1">{t('files.col.name')}</span>
                <span className="hidden w-[160px] md:block">{t('files.col.kind')}</span>
                <span className="w-[110px] text-right">{t('files.col.size')}</span>
                <span className="w-[120px] text-right">{t('files.col.updated')}</span>
                <span className="w-9" />
              </div>
              <AnimatePresence initial={false}>
                {visible.map((n) => (
                  <NodeRow
                    key={n.id}
                    node={n}
                    selected={selected.has(n.id)}
                    selection={selected}
                    renaming={renaming === n.id}
                    onRenamed={() => setRenaming(null)}
                    onRename={() => setRenaming(n.id)}
                    onOpen={() => openNode(n)}
                    onSelect={(e) => toggleSelect(n.id, e)}
                    showPath={!!q}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <SelectionBar selected={[...selected].filter((id) => files[id])} onClear={() => setSelected(new Set())} />

      <AnimatePresence>
        {drop.over && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/80 backdrop-blur-sm"
          >
            <motion.div initial={{ y: 6 }} animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 1.4 }} className="text-accent">
              <Upload size={34} />
            </motion.div>
            <div className="mt-3 text-[16px] font-semibold text-accent">{t('files.dropTo', { name: folder?.name ?? rootLabel })}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------------- Pieces ---------------------------------- */

function useNodeDrop(target: { parentId?: ID; projectId?: ID }, disabled?: boolean) {
  const moveNodes = useData((s) => s.moveNodes);
  const [over, setOver] = useState(false);
  return {
    over,
    bind: disabled
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            setOver(true);
          },
          onDragLeave: () => setOver(false),
          onDrop: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            const ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME) || '[]') as ID[];
            const valid = ids.filter((id) => id !== target.parentId);
            if (valid.length) moveNodes(valid, target.parentId, target.projectId);
          },
        },
  };
}

function Crumb({
  label,
  icon,
  active,
  onClick,
  dropTarget,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  dropTarget: { parentId?: ID; projectId?: ID };
}) {
  const drop = useNodeDrop(dropTarget);
  return (
    <button
      {...drop.bind}
      onClick={onClick}
      className={cn(
        'flex min-w-0 max-w-[240px] items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-hover',
        active ? 'font-medium text-fg' : 'text-fg-3',
        drop.over && 'bg-accent-soft ring-1 ring-accent/50',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

/** One column grid for project drives and files, so every card lines up like a Notion gallery. */
const FILE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3';

function DrivesRow() {
  const t = useT();
  const projects = useProjectsList();
  const files = useData((s) => s.files);
  return (
    <section className="mb-6">
      <div className="mb-2 text-[12.5px] font-medium text-fg-3">{t('files.projectDrives')}</div>
      <div className={FILE_GRID}>
        {projects.map((p) => (
          <DriveCard key={p.id} project={p} count={Object.values(files).filter((f) => f.projectId === p.id && f.kind !== 'folder').length} />
        ))}
      </div>
    </section>
  );
}

function DriveCard({ project, count }: { project: Project; count: number }) {
  const t = useT();
  const drop = useNodeDrop({ parentId: undefined, projectId: project.id });
  return (
    <Link
      {...drop.bind}
      to={`/p/${project.id}/files`}
      className={cn(
        'group flex h-[60px] items-center gap-3 rounded-lg border border-line px-3 transition-colors duration-100 hover:bg-hover',
        drop.over && 'border-accent bg-accent-soft',
      )}
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
        <FolderGlyph size={34} color={project.color} />
        <span className="absolute bottom-0 right-[-2px] rounded-[4px] bg-bg px-[1px] leading-none">
          <PageIcon icon={project.icon} size={14} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{project.name || t('project.untitled')}</span>
        <span className="text-[12px] text-fg-3">{t('files.count', { n: count })}</span>
      </span>
    </Link>
  );
}

function EmptyDrive({ q, onUpload, onFolder, onLink }: { q: string; onUpload: () => void; onFolder: () => void; onLink: () => void }) {
  const t = useT();
  if (q) return <div className="py-16 text-center text-[14px] text-fg-3">{t('backlog.noMatches')}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center rounded-2xl border-2 border-dashed border-line-strong px-6 py-14 text-center"
    >
      <FolderGlyph size={52} color="gray" />
      <div className="mt-4 text-[16px] font-semibold">{t('files.emptyTitle')}</div>
      <div className="mt-1 max-w-[460px] text-[14px] text-fg-3">{t('files.empty')}</div>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          onClick={onUpload}
          className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[14px] font-medium text-white hover:bg-accent-hover"
        >
          <Upload size={15} /> {t('common.upload')}
        </button>
        <button onClick={onLink} className="flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[14px] hover:bg-hover">
          <Link2 size={15} /> {t('files.addLink')}
        </button>
        <button onClick={onFolder} className="flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[14px] hover:bg-hover">
          <FolderPlus size={15} /> {t('files.newFolder')}
        </button>
      </div>
      <div className="mt-4 text-[12.5px] text-fg-4">{t('files.pasteHint', { key: `${modKey()}+V` })}</div>
    </motion.div>
  );
}

/* ------------------------------ Node actions ------------------------------- */

function useMoveTargets(nodeIds: ID[]): MenuEntry[] {
  const t = useT();
  const files = useData((s) => s.files);
  const projects = useProjectsList();
  const moveNodes = useData((s) => s.moveNodes);
  const first = files[nodeIds[0]];
  if (!first) return [];
  const projectId = first.projectId;
  // Exclude the moved folders and everything inside them.
  const blocked = new Set(nodeIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of Object.values(files)) if (n.parentId && blocked.has(n.parentId) && !blocked.has(n.id)) (blocked.add(n.id), (grew = true));
  }
  const folders = Object.values(files).filter((n) => n.kind === 'folder' && n.projectId === projectId && !blocked.has(n.id));
  const depthOf = (n: FileNode) => folderPath(n.id, files).length - 1;
  const ordered: FileNode[] = [];
  const walk = (parent?: ID) =>
    folders
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((f) => {
        ordered.push(f);
        walk(f.id);
      });
  walk(undefined);
  const entries: MenuEntry[] = [
    {
      key: 'root',
      icon: <FolderGlyph size={15} color="gray" />,
      label: projectId ? (projects.find((p) => p.id === projectId)?.name ?? '') : t('files.workspaceDrive'),
      checked: nodeIds.every((id) => !files[id]?.parentId),
      onSelect: () => moveNodes(nodeIds, undefined, projectId),
    },
    ...ordered.map<MenuEntry>((f) => ({
      key: f.id,
      icon: (
        <span style={{ paddingLeft: depthOf(f) * 12 }} className="flex">
          <FolderGlyph size={15} />
        </span>
      ),
      label: f.name,
      checked: nodeIds.every((id) => files[id]?.parentId === f.id),
      onSelect: () => moveNodes(nodeIds, f.id, projectId),
    })),
    { key: 'sep', separator: true },
    { key: 'h', heading: t('files.otherDrives') },
    ...(projectId
      ? [
          {
            key: 'ws',
            icon: <FolderGlyph size={15} color="gray" />,
            label: t('files.workspaceDrive'),
            onSelect: () => moveNodes(nodeIds, undefined, undefined),
          } as MenuEntry,
        ]
      : []),
    ...projects
      .filter((p) => p.id !== projectId)
      .map<MenuEntry>((p) => ({
        key: p.id,
        icon: <PageIcon icon={p.icon} size={15} />,
        label: p.name,
        onSelect: () => moveNodes(nodeIds, undefined, p.id),
      })),
  ];
  return entries;
}

function useNodeMenu(node: FileNode, onRename: () => void, onOpen: () => void, selection: Set<ID>): MenuEntry[] {
  const t = useT();
  const ids = selection.has(node.id) && selection.size > 1 ? [...selection] : [node.id];
  const moveTargets = useMoveTargets(ids);
  const entries: MenuEntry[] = [];
  if (node.kind === 'folder') entries.push({ key: 'open', icon: <FolderInput size={15} />, label: t('common.open'), onSelect: onOpen });
  if (node.kind === 'file') entries.push({ key: 'open', icon: <Eye size={15} />, label: t('common.preview'), onSelect: onOpen });
  if (node.kind === 'link') {
    entries.push({ key: 'open', icon: <ExternalLink size={15} />, label: t('files.openLink'), onSelect: onOpen });
    entries.push({
      key: 'copy',
      icon: <Copy size={15} />,
      label: t('common.copyLink'),
      onSelect: () => {
        void navigator.clipboard?.writeText(node.url ?? '');
        toast({ message: t('common.copied') });
      },
    });
  }
  if (node.kind === 'file')
    entries.push({
      key: 'dl',
      icon: <Download size={15} />,
      label: t('common.download'),
      onSelect: async () => {
        const blob = await getFileBlob(node.id);
        if (blob) downloadBlob(blob, node.name);
        else toast({ message: t('files.missing'), tone: 'error' });
      },
    });
  entries.push(
    { key: 'rename', icon: <PenLine size={15} />, label: t('common.rename'), onSelect: onRename },
    { key: 'move', icon: <FolderInput size={15} />, label: t('files.moveTo'), children: moveTargets },
    { key: 's', separator: true },
    { key: 'del', icon: <Trash2 size={15} />, label: t('common.delete'), danger: true, onSelect: () => deleteNodesWithUndo(ids) },
  );
  return entries;
}

interface NodeViewProps {
  node: FileNode;
  selected: boolean;
  selection: Set<ID>;
  renaming: boolean;
  onRename: () => void;
  onRenamed: () => void;
  onOpen: () => void;
  onSelect: (e: { shiftKey: boolean }) => void;
  showPath: boolean;
}

function useDragSource(node: FileNode, selection: Set<ID>) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    bind: {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        const ids = selection.has(node.id) ? [...selection] : [node.id];
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
        if (node.kind === 'link' && node.url) e.dataTransfer.setData('text/uri-list', node.url);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      },
      onDragEnd: () => setDragging(false),
    },
  };
}

function RenameInput({ node, onDone, className }: { node: FileNode; onDone: () => void; className?: string }) {
  const updateNode = useData((s) => s.updateNode);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the name without the extension, like Finder.
    const dot = node.kind === 'file' ? node.name.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : node.name.length);
  }, [node]);
  return (
    <input
      ref={ref}
      defaultValue={node.name}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== node.name) updateNode(node.id, { name: v });
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onDone();
      }}
      className={cn('w-full rounded-[4px] border border-accent bg-bg px-1 shadow-[0_0_0_2px_var(--accent-soft)] outline-none', className)}
    />
  );
}

function NodeMeta({ node }: { node: FileNode }) {
  const t = useT();
  const count = useData((s) => (node.kind === 'folder' ? Object.values(s.files).filter((f) => f.parentId === node.id).length : 0));
  if (node.kind === 'folder') return <>{t('files.items', { n: count })}</>;
  if (node.kind === 'link') return <>{linkService(node.url) === 'plaud' ? 'Plaud' : domainOf(node.url)}</>;
  return <>{node.size != null ? formatBytes(node.size) : ''}</>;
}

function Thumb({ node }: { node: FileNode }) {
  const [url, setUrl] = useState<string>();
  const isImage = node.kind === 'file' && fileCategory(node.name, node.mime) === 'image';
  useEffect(() => {
    if (isImage) void getFileUrl(node.id).then(setUrl);
  }, [isImage, node.id]);
  if (isImage && url) return <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />;
  return (
    <div className="flex h-full w-full items-center justify-center bg-subtle">
      <NodeIcon node={node} size={node.kind === 'folder' ? 52 : 36} />
    </div>
  );
}

function NodeCard(props: NodeViewProps) {
  const { node, selected, selection, renaming, onRename, onRenamed, onOpen, onSelect, showPath } = props;
  const t = useT();
  const files = useData((s) => s.files);
  const drop = useNodeDrop({ parentId: node.id, projectId: node.projectId }, node.kind !== 'folder');
  const drag = useDragSource(node, selection);
  const entries = useNodeMenu(node, onRename, onOpen, selection);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
      <ContextMenu entries={entries}>
        <div
          {...drag.bind}
          {...drop.bind}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) onSelect(e);
            else if (!renaming) onOpen();
          }}
          title={node.note}
          className={cn(
            'group/card relative cursor-pointer select-none overflow-hidden rounded-lg border bg-elevated transition-colors duration-100',
            selected ? 'border-accent ring-2 ring-accent/30' : 'border-line',
            drop.over && 'border-accent bg-accent-soft ring-2 ring-accent/40',
            drag.dragging && 'opacity-40',
          )}
        >
          <div className="relative h-[120px] overflow-hidden border-b border-line">
            <Thumb node={node} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect(e);
              }}
              className={cn(
                'absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-[5px] border shadow-sm transition-opacity',
                selected ? 'border-accent bg-accent text-white opacity-100' : 'border-line-strong bg-elevated opacity-0 group-hover/card:opacity-100',
              )}
            >
              {selected && (
                <svg viewBox="0 0 12 12" className="h-3 w-3">
                  <path d="M2.5 6.2l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <div
              className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/card:opacity-100 has-[[data-state=open]]:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <EntriesMenu
                align="end"
                entries={entries}
                trigger={
                  <IconButton size="sm" className="bg-elevated shadow-sm" label={t('common.more')}>
                    <MoreHorizontal size={14} />
                  </IconButton>
                }
              />
            </div>
          </div>
          {/* Fixed height footer: names stay on one line so every card is the same size. */}
          <div className="flex h-[56px] items-center gap-2 px-3 transition-colors duration-100 group-hover/card:bg-hover">
            <NodeIcon node={node} size={16} />
            <div className="min-w-0 flex-1">
              {renaming ? (
                <RenameInput node={node} onDone={onRenamed} className="h-6 text-[13.5px]" />
              ) : (
                <div className="truncate text-[13.5px] font-medium leading-snug" title={node.name}>
                  {node.name}
                </div>
              )}
              <div className="mt-0.5 truncate text-[12px] text-fg-3">
                {showPath && node.parentId
                  ? `${folderPath(node.parentId, files)
                      .map((f) => f.name)
                      .join(' / ')} · `
                  : ''}
                <NodeMeta node={node} />
              </div>
            </div>
          </div>
        </div>
      </ContextMenu>
    </motion.div>
  );
}

function NodeRow(props: NodeViewProps) {
  const { node, selected, selection, renaming, onRename, onRenamed, onOpen, onSelect, showPath } = props;
  const t = useT();
  const lang = useLang();
  const files = useData((s) => s.files);
  const drop = useNodeDrop({ parentId: node.id, projectId: node.projectId }, node.kind !== 'folder');
  const drag = useDragSource(node, selection);
  const entries = useNodeMenu(node, onRename, onOpen, selection);
  const kindLabel =
    node.kind === 'folder'
      ? t('files.kind.folder')
      : node.kind === 'link'
        ? linkService(node.url) === 'plaud'
          ? t('files.kind.plaud')
          : domainOf(node.url)
        : t(`files.cat.${fileCategory(node.name, node.mime)}` as TKey);
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      className="border-b border-line last:border-b-0"
    >
      <ContextMenu entries={entries}>
        <div
          {...drag.bind}
          {...drop.bind}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) onSelect(e);
            else if (!renaming) onOpen();
          }}
          className={cn(
            'group/row flex h-11 cursor-pointer select-none items-center pr-3 text-[14px] transition-colors',
            selected ? 'bg-accent-soft' : 'hover:bg-hover',
            drop.over && 'bg-accent-soft ring-1 ring-inset ring-accent/50',
            drag.dragging && 'opacity-40',
          )}
        >
          <span className="flex w-11 justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect(e);
              }}
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded-[3px] border transition-opacity',
                selected ? 'border-accent bg-accent text-white' : 'border-fg-4 opacity-0 group-hover/row:opacity-100',
              )}
            >
              {selected && (
                <svg viewBox="0 0 12 12" className="h-3 w-3">
                  <path d="M2.5 6.2l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <NodeIcon node={node} size={18} />
            <span className="min-w-0 flex-1">
              {renaming ? (
                <RenameInput node={node} onDone={onRenamed} className="h-7 text-[14px]" />
              ) : (
                <span className="block truncate font-medium">{node.name}</span>
              )}
              {(node.note || (showPath && node.parentId)) && !renaming && (
                <span className="block truncate text-[12px] text-fg-3">
                  {showPath && node.parentId
                    ? folderPath(node.parentId, files)
                        .map((f) => f.name)
                        .join(' / ')
                    : node.note}
                </span>
              )}
            </span>
          </span>
          <span className="hidden w-[160px] truncate text-[13px] text-fg-3 md:block">{kindLabel}</span>
          <span className="w-[110px] truncate text-right text-[13px] text-fg-3">{node.kind === 'link' ? '—' : <NodeMeta node={node} />}</span>
          <span className="w-[120px] text-right text-[13px] text-fg-3">{formatShortDate(node.updatedAt.slice(0, 10), lang)}</span>
          <span
            className="flex w-9 justify-end opacity-0 transition-opacity group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <EntriesMenu
              align="end"
              entries={entries}
              trigger={
                <IconButton size="sm" label={t('common.more')}>
                  <MoreHorizontal size={15} />
                </IconButton>
              }
            />
          </span>
        </div>
      </ContextMenu>
    </motion.div>
  );
}

function SelectionBar({ selected, onClear }: { selected: ID[]; onClear: () => void }) {
  const t = useT();
  const moveTargets = useMoveTargets(selected);
  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          initial={{ y: 40, opacity: 0, x: '-50%' }}
          animate={{ y: 0, opacity: 1, x: '-50%' }}
          exit={{ y: 30, opacity: 0, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          className="fixed bottom-6 left-1/2 z-40 flex h-11 items-center gap-1 rounded-xl bg-elevated px-2 text-[14px] shadow-lg"
        >
          <span className="px-2 font-medium text-accent">{t('backlog.selected', { n: selected.length })}</span>
          <span className="h-5 w-px bg-line" />
          <EntriesMenu
            side="top"
            entries={moveTargets}
            trigger={
              <button className="flex h-8 items-center gap-1.5 rounded-md px-2 text-fg-2 hover:bg-hover">
                <FolderInput size={15} /> {t('files.moveTo')}
              </button>
            }
          />
          <button
            onClick={() => {
              deleteNodesWithUndo(selected);
              onClear();
            }}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[var(--c-red-text)] hover:bg-[var(--c-red-bg)]"
          >
            <Trash2 size={15} /> {t('common.delete')}
          </button>
          <span className="h-5 w-px bg-line" />
          <Tooltip content={t('backlog.clearSelection')} shortcut="Esc">
            <button onClick={onClear} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-3 hover:bg-hover">
              <X size={16} />
            </button>
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function useOpenFileNode() {
  const navigate = useNavigate();
  const openPreview = useUI((s) => s.openPreview);
  return (n: FileNode) => {
    if (n.kind === 'link' && n.url) window.open(n.url, '_blank', 'noopener,noreferrer');
    else if (n.kind === 'folder') navigate(`${n.projectId ? `/p/${n.projectId}/files` : '/files'}?folder=${n.id}`);
    else openPreview(n.id);
  };
}
