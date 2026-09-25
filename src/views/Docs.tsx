import { motion } from 'motion/react';
import { FileText, LayoutGrid, List, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useData } from '@/lib/store';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { useViewState } from '@/lib/viewState';
import { timeAgo } from '@/lib/dates';
import { templates, type TemplateId } from '@/lib/blocks';
import { blocksToText, matches } from '@/lib/utils';
import { deleteDocWithUndo } from '@/lib/actions';
import type { Doc, ID } from '@/lib/types';
import { ViewBar, NewButton } from '@/components/ViewBar';
import { SearchToggle } from '@/components/QueryControls';
import { ContextMenu } from '@/components/ui/Overlay';
import { PageIcon } from '@/components/ui/bits';
import { Copy, Link2, Trash2 } from 'lucide-react';
import { toast } from '@/lib/ui';

const TPL_DESC: Record<TemplateId, TKey> = {
  prd: 'docs.tpl.prdDesc',
  brief: 'docs.tpl.briefDesc',
  retro: 'docs.tpl.retroDesc',
  release: 'docs.tpl.releaseDesc',
  oneOnOne: 'docs.tpl.oneOnOneDesc',
  decision: 'docs.tpl.decisionDesc',
};
const TPL_NAME: Record<TemplateId, TKey> = {
  prd: 'docs.tpl.prd',
  brief: 'docs.tpl.brief',
  retro: 'docs.tpl.retro',
  release: 'docs.tpl.release',
  oneOnOne: 'docs.tpl.oneOnOne',
  decision: 'docs.tpl.decision',
};

/** Project docs: templates on top, then a gallery or list of pages (Notion database style). */
export function DocsView() {
  const t = useT();
  const lang = useLang();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const docsRec = useData((s) => s.docs);
  const createDoc = useData((s) => s.createDoc);
  const [q, setQ] = useState('');
  const [view, setView] = useViewState<{ mode: 'gallery' | 'list' }>(`docs:${projectId}`, { mode: 'gallery' });
  const docs = useMemo(
    () =>
      Object.values(docsRec)
        .filter((d) => d.projectId === projectId && !d.parentId)
        .filter((d) => !q || matches(`${d.title} ${blocksToText(d.content, 800)}`, q))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [docsRec, projectId, q],
  );

  const create = (tpl?: TemplateId) => {
    const template = tpl ? templates(lang).find((x) => x.id === tpl) : undefined;
    const id = createDoc({ projectId, title: template?.title ?? '', icon: template?.icon, content: template?.content });
    navigate(`/docs/${id}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewBar
        value={view.mode}
        onChange={(mode) => setView({ mode })}
        tabs={[
          { value: 'gallery', label: t('files.grid'), icon: <LayoutGrid size={15} /> },
          { value: 'list', label: t('files.list'), icon: <List size={15} /> },
        ]}
      >
        <SearchToggle value={q} onChange={setQ} />
        <NewButton onClick={() => create()}>{t('common.new')}</NewButton>
      </ViewBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="full-width pb-24 pt-5">
          <div className="mb-2 text-[12.5px] font-medium text-fg-3">{t('docs.templates')}</div>
          <div className="no-scrollbar -mx-1 mb-8 flex gap-2 overflow-x-auto px-1 pb-1">
            <TemplateCard icon={<Plus size={18} />} title={t('docs.blank')} desc={t('docs.new')} onClick={() => create()} />
            {templates(lang).map((tpl) => (
              <TemplateCard
                key={tpl.id}
                icon={<span className="text-[20px]">{tpl.icon}</span>}
                title={t(TPL_NAME[tpl.id])}
                desc={t(TPL_DESC[tpl.id])}
                onClick={() => create(tpl.id)}
              />
            ))}
          </div>

          {docs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-strong py-12 text-center text-[14px] text-fg-3">
              {q ? t('backlog.noMatches') : t('docs.empty')}
            </div>
          ) : view.mode === 'gallery' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
              {docs.map((d, i) => (
                <DocMenu key={d.id} doc={d}>
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}>
                    <Link
                      to={`/docs/${d.id}`}
                      className="group block overflow-hidden rounded-xl border border-line bg-elevated transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="relative h-[120px] overflow-hidden border-b border-line bg-subtle px-4 pt-4">
                        {d.cover && <div className="absolute inset-x-0 top-0 h-10" style={{ background: d.cover.value }} />}
                        <div className="relative line-clamp-5 text-[11.5px] leading-[1.55] text-fg-3">{blocksToText(d.content, 400) || ' '}</div>
                      </div>
                      <div className="flex items-center gap-2 px-3.5 py-3">
                        {d.icon ? <PageIcon icon={d.icon} size={18} /> : <FileText size={17} className="text-fg-3" />}
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{d.title || t('common.untitled')}</span>
                      </div>
                      <div className="-mt-2 px-3.5 pb-3 text-[12px] text-fg-4">{t('docs.edited', { time: timeAgo(d.updatedAt, lang) })}</div>
                    </Link>
                  </motion.div>
                </DocMenu>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              {docs.map((d) => (
                <DocMenu key={d.id} doc={d}>
                  <Link
                    to={`/docs/${d.id}`}
                    className="flex h-11 items-center gap-3 border-b border-line px-4 text-[14px] transition-colors last:border-b-0 hover:bg-hover"
                  >
                    {d.icon ? <PageIcon icon={d.icon} size={18} /> : <FileText size={17} className="text-fg-3" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{d.title || t('common.untitled')}</span>
                    <span className="text-[12.5px] text-fg-4">{timeAgo(d.updatedAt, lang)}</span>
                  </Link>
                </DocMenu>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="flex w-[180px] shrink-0 flex-col items-start rounded-xl border border-line p-3 text-left transition-shadow hover:shadow-sm"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-hover text-fg-2">{icon}</span>
      <span className="mt-2 text-[14px] font-medium">{title}</span>
      <span className="mt-0.5 line-clamp-1 text-[12.5px] text-fg-3">{desc}</span>
    </motion.button>
  );
}

function DocMenu({ doc, children }: { doc: Doc; children: React.ReactElement }) {
  const t = useT();
  const navigate = useNavigate();
  const duplicateDoc = useData((s) => s.duplicateDoc);
  return (
    <ContextMenu
      entries={[
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
          label: t('docs.duplicate'),
          onSelect: () => {
            const id: ID | undefined = duplicateDoc(doc.id);
            if (id) navigate(`/docs/${id}`);
          },
        },
        { key: 's', separator: true },
        { key: 'del', icon: <Trash2 size={15} />, label: t('docs.delete'), danger: true, onSelect: () => deleteDocWithUndo(doc.id) },
      ]}
    >
      {children}
    </ContextMenu>
  );
}
