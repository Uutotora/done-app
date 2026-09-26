import { AnimatePresence, motion } from 'motion/react';
import { Copy, FileText, FolderInput, Link2, MessageSquare, MoreHorizontal, Plus, SmilePlus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { timeAgo } from '@/lib/dates';
import { deleteDocWithUndo } from '@/lib/actions';
import { useProjectsList } from '@/lib/selectors';
import { blocksToText, cn } from '@/lib/utils';
import type { Doc, DocFont, ID } from '@/lib/types';
import { Topbar, type Crumb } from '@/components/Topbar';
import { Editor } from '@/components/Editor';
import { Comments } from '@/components/Comments';
import { AutoTextarea, PageIcon, Switch } from '@/components/ui/bits';
import { IconButton } from '@/components/ui/Button';
import { EntriesMenu, Popover, type MenuEntry } from '@/components/ui/Overlay';
import { IconPicker } from '@/components/pickers/IconPicker';
import { NotFound } from './NotFound';

export default function DocPage() {
  const { docId } = useParams();
  const doc = useData((s) => (docId ? s.docs[docId] : undefined));
  const touchRecent = useData((s) => s.touchRecent);
  useEffect(() => {
    if (docId && doc) touchRecent({ kind: 'doc', id: docId });
    // Record the visit once per page.
  }, [docId]);
  if (!doc) return <NotFound />;
  return <DocView key={doc.id} doc={doc} />;
}

function DocView({ doc }: { doc: Doc }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const docs = useData((s) => s.docs);
  const project = useData((s) => (doc.projectId ? s.projects[doc.projectId] : undefined));
  const update = useData((s) => s.updateDoc);
  const createDoc = useData((s) => s.createDoc);
  const hasComments = useData((s) => Object.values(s.comments).some((c) => c.targetKind === 'doc' && c.targetId === doc.id));
  const [showComments, setShowComments] = useState(hasComments);
  const [iconOpen, setIconOpen] = useState(false);
  const set = (patch: Partial<Doc>) => update(doc.id, patch);

  const crumbs = useMemo<Crumb[]>(() => {
    const chain: Doc[] = [];
    let cur = doc.parentId ? docs[doc.parentId] : undefined;
    while (cur && chain.length < 10) {
      chain.unshift(cur);
      cur = cur.parentId ? docs[cur.parentId] : undefined;
    }
    return [
      ...(project ? [{ label: project.name, icon: project.icon, to: `/p/${project.id}/docs` }] : []),
      ...chain.map((d) => ({ label: d.title || t('common.untitled'), icon: d.icon ?? '📄', to: `/docs/${d.id}` })),
      { label: doc.title || t('common.untitled'), icon: doc.icon ?? '📄' },
    ];
  }, [doc, docs, project, t]);

  const children = useMemo(
    () =>
      Object.values(docs)
        .filter((d) => d.parentId === doc.id)
        .sort((a, b) => a.order - b.order),
    [docs, doc.id],
  );
  const words = useMemo(() => blocksToText(doc.content, 100000).split(/\s+/).filter(Boolean).length, [doc.content]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Topbar
        crumbs={crumbs}
        favorite={{ kind: 'doc', id: doc.id }}
        actions={
          <>
            <span className="mr-1 hidden text-[13px] text-fg-4 md:inline">{t('docs.edited', { time: timeAgo(doc.updatedAt, lang) })}</span>
            <IconButton size="md" label={t('docs.addComment')} onClick={() => setShowComments(true)}>
              <MessageSquare size={17} />
            </IconButton>
            <PageMenu doc={doc} words={words} />
          </>
        }
      />

      <div className={cn('group/header pb-40', doc.fullWidth ? 'full-width' : 'page-width')}>
        <div className="relative z-10 mt-10">
          {doc.icon && (
            <IconPicker value={doc.icon} onChange={(v) => set({ icon: v })} open={iconOpen} onOpenChange={setIconOpen}>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="flex h-[78px] w-[78px] items-center justify-center rounded-lg hover:bg-hover"
              >
                <PageIcon icon={doc.icon} size={72} />
              </motion.button>
            </IconPicker>
          )}
        </div>

        {/* Hover actions like Notion: add icon and add comment */}
        <div className="flex h-9 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/header:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
          {!doc.icon && (
            <IconPicker value={doc.icon} onChange={(v) => set({ icon: v })}>
              <HeaderAction icon={<SmilePlus size={15} />}>{t('docs.addIcon')}</HeaderAction>
            </IconPicker>
          )}
          {!showComments && (
            <HeaderAction icon={<MessageSquare size={15} />} onClick={() => setShowComments(true)}>
              {t('docs.addComment')}
            </HeaderAction>
          )}
        </div>

        <AutoTextarea
          defaultValue={doc.title}
          autoFocus={!doc.title}
          placeholder={t('docs.titlePlaceholder')}
          onChange={(e) => set({ title: e.target.value })}
          className={cn(
            'font-bold leading-[1.2] tracking-[-0.02em] placeholder:text-fg-4',
            doc.smallText ? 'text-[32px]' : 'text-[40px]',
            doc.font === 'serif' && 'font-serif',
            doc.font === 'mono' && 'font-mono',
          )}
        />

        <AnimatePresence initial={false}>
          {showComments && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 overflow-hidden border-b border-line pb-3"
            >
              <Comments targetKind="doc" targetId={doc.id} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-5">
          <Editor
            key={doc.id}
            initial={doc.content}
            onChange={(blocks) => useData.getState().updateDoc(doc.id, { content: blocks })}
            placeholder={t('docs.bodyPlaceholder')}
            className={cn(doc.smallText && 'small', doc.font === 'serif' && 'serif', doc.font === 'mono' && 'mono')}
          />
        </div>

        {/* Sub-pages */}
        <div className="mt-10">
          {children.length > 0 && <div className="mb-1 text-[13px] font-semibold text-fg-3">{t('docs.subpages')}</div>}
          {children.map((c) => (
            <Link
              key={c.id}
              to={`/docs/${c.id}`}
              className="group flex h-9 items-center gap-2 rounded-md px-1.5 text-[15px] transition-colors hover:bg-hover"
            >
              {c.icon ? <PageIcon icon={c.icon} size={18} /> : <FileText size={17} className="text-fg-3" />}
              <span className="truncate border-b border-line-strong font-medium">{c.title || t('common.untitled')}</span>
            </Link>
          ))}
          <button
            onClick={() => navigate(`/docs/${createDoc({ parentId: doc.id, projectId: doc.projectId })}`)}
            className="mt-1 flex h-8 items-center gap-2 rounded-md px-1.5 text-[14px] text-fg-4 transition-colors hover:bg-hover hover:text-fg-3"
          >
            <Plus size={16} /> {t('docs.addSubpage')}
          </button>
        </div>
      </div>
    </div>
  );
}

function HeaderAction({ icon, children, ...rest }: { icon: React.ReactNode; children: React.ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button {...rest} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[14px] text-fg-3 transition-colors hover:bg-hover">
      {icon}
      {children}
    </button>
  );
}

/** Notion's page "..." menu: text style, small text, full width, then actions. */
function PageMenu({ doc, words }: { doc: Doc; words: number }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const update = useData((s) => s.updateDoc);
  const moveDoc = useData((s) => s.moveDoc);
  const duplicateDoc = useData((s) => s.duplicateDoc);
  const projects = useProjectsList();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Doc>) => update(doc.id, patch);
  const moveToProject = (projectId?: ID) => {
    // The page and all of its sub-pages change their project together.
    useData.setState((s) => {
      const docs = { ...s.docs };
      const walk = (id: ID) => {
        docs[id] = { ...docs[id], projectId };
        for (const d of Object.values(s.docs)) if (d.parentId === id) walk(d.id);
      };
      walk(doc.id);
      docs[doc.id] = { ...docs[doc.id], parentId: undefined };
      return { docs };
    });
    moveDoc(doc.id, undefined);
  };
  const moveEntries: MenuEntry[] = [
    { key: 'root', label: t('docs.moveToRoot'), checked: !doc.projectId && !doc.parentId, onSelect: () => moveToProject(undefined) },
    ...projects.map<MenuEntry>((p) => ({
      key: p.id,
      icon: <PageIcon icon={p.icon} size={15} />,
      label: p.name,
      checked: doc.projectId === p.id && !doc.parentId,
      onSelect: () => moveToProject(p.id),
    })),
  ];
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <IconButton size="md" label={t('common.more')}>
          <MoreHorizontal size={17} />
        </IconButton>
      }
    >
      <div className="w-[260px] p-1">
        <div className="px-2 pb-1.5 pt-1.5 text-[11.5px] font-medium text-fg-3">{t('docs.style')}</div>
        <div className="grid grid-cols-3 gap-1 px-1 pb-1">
          {(['default', 'serif', 'mono'] as DocFont[]).map((f) => (
            <button
              key={f}
              onClick={() => set({ font: f })}
              className={cn(
                'flex flex-col items-center rounded-md py-2 transition-colors hover:bg-hover',
                (doc.font ?? 'default') === f && 'bg-accent-soft text-accent',
              )}
            >
              <span className={cn('text-[22px] leading-none', f === 'serif' && 'font-serif', f === 'mono' && 'font-mono')}>Ag</span>
              <span className="mt-1 text-[11.5px] text-fg-3">{t(`docs.font.${f}`)}</span>
            </button>
          ))}
        </div>
        <div className="my-1 h-px bg-line" />
        <label className="flex h-8 cursor-pointer items-center justify-between rounded-[5px] px-2 text-[14px] hover:bg-hover">
          {t('docs.smallText')}
          <Switch checked={!!doc.smallText} onChange={(v) => set({ smallText: v })} />
        </label>
        <label className="flex h-8 cursor-pointer items-center justify-between rounded-[5px] px-2 text-[14px] hover:bg-hover">
          {t('docs.fullWidth')}
          <Switch checked={!!doc.fullWidth} onChange={(v) => set({ fullWidth: v })} />
        </label>
        <div className="my-1 h-px bg-line" />
        <MenuButton
          icon={<Link2 size={15} />}
          onClick={() => {
            void navigator.clipboard?.writeText(`${window.location.origin}/docs/${doc.id}`);
            toast({ message: t('common.copied') });
            setOpen(false);
          }}
        >
          {t('common.copyLink')}
        </MenuButton>
        <MenuButton
          icon={<Copy size={15} />}
          onClick={() => {
            const id = duplicateDoc(doc.id);
            setOpen(false);
            if (id) navigate(`/docs/${id}`);
          }}
        >
          {t('docs.duplicate')}
        </MenuButton>
        <EntriesMenu
          side="left"
          align="start"
          entries={moveEntries}
          trigger={<MenuButton icon={<FolderInput size={15} />}>{t('docs.moveTo')}</MenuButton>}
        />
        <MenuButton
          icon={<Trash2 size={15} />}
          danger
          onClick={() => {
            setOpen(false);
            navigate(doc.projectId ? `/p/${doc.projectId}/docs` : '/');
            deleteDocWithUndo(doc.id);
          }}
        >
          {t('docs.delete')}
        </MenuButton>
        <div className="my-1 h-px bg-line" />
        <div className="px-2 pb-1 pt-0.5 text-[12px] leading-relaxed text-fg-4">
          {t('docs.words', { n: words })}
          <br />
          {t('docs.edited', { time: timeAgo(doc.updatedAt, lang) })}
        </div>
      </div>
    </Popover>
  );
}

function MenuButton({
  icon,
  children,
  danger,
  ...rest
}: { icon: React.ReactNode; children: React.ReactNode; danger?: boolean } & React.ComponentProps<'button'>) {
  return (
    <button
      {...rest}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] hover:bg-hover',
        danger && 'text-[var(--c-red-text)] hover:bg-[var(--c-red-bg)]',
      )}
    >
      <span className={cn('flex w-4 justify-center text-fg-2', danger && 'text-inherit')}>{icon}</span>
      {children}
    </button>
  );
}
