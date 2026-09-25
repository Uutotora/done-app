import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, CornerDownLeft, Link2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { defaultLinkName, domainOf, linkService, normalizeUrl } from '@/lib/files';
import { cn } from '@/lib/utils';
import { Dialog } from '../ui/Overlay';
import { Button } from '../ui/Button';
import { Kbd, PageIcon } from '../ui/bits';
import { ProjectPicker } from '../pickers/Pickers';
import { NodeIcon } from './NodeIcon';

/** "Add link" dialog. Plaud share links get their own icon and a sensible name. */
export function LinkDialog() {
  const t = useT();
  const lang = useLang();
  const state = useUI((s) => s.linkDialog);
  const close = useUI((s) => s.closeLinkDialog);
  const createLink = useData((s) => s.createLink);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>();
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.open) return;
    setUrl(state.url ?? '');
    setName('');
    setNameTouched(false);
    setNote('');
    setProjectId(state.projectId);
    setTimeout(() => urlRef.current?.focus(), 40);
  }, [state.open, state.url, state.projectId]);

  const normalized = useMemo(() => normalizeUrl(url), [url]);
  const service = linkService(normalized ?? undefined);
  const suggested = normalized ? defaultLinkName(normalized, lang) : '';
  const finalName = (nameTouched ? name : name || suggested).trim();
  const project = useData((s) => (projectId ? s.projects[projectId] : undefined));

  const submit = () => {
    if (!normalized) return;
    // The parent folder only makes sense inside the drive it was opened from.
    const parentId = projectId === state.projectId ? state.parentId : undefined;
    createLink({ name: finalName || suggested, url: normalized, projectId, parentId, note: note.trim() || undefined });
    toast({ message: t('files.linkAdded'), tone: 'success' });
    close();
  };

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && close()} position="top" className="max-w-[560px]" title={t('files.addLink')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-2 px-5 pt-5 text-[13px] text-fg-3">
          <Link2 size={15} />
          {t('files.addLink')}
        </div>
        <div className="px-5 pt-3">
          <div
            className={cn(
              'flex h-11 items-center gap-2.5 rounded-lg border bg-input px-3 transition-shadow',
              url && !normalized
                ? 'border-[var(--c-red-text)]'
                : 'border-line-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]',
            )}
          >
            {normalized ? (
              <NodeIcon node={{ id: 'x', kind: 'link', url: normalized, name: '', createdAt: '', updatedAt: '' }} size={22} />
            ) : (
              <Link2 size={18} className="text-fg-4" />
            )}
            <input
              ref={urlRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('files.urlPlaceholder')}
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-4"
            />
          </div>
          <AnimatePresence initial={false}>
            {normalized && service === 'plaud' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 rounded-md bg-hover px-3 py-2 text-[12.5px] text-fg-2">{t('files.plaudHint')}</div>
              </motion.div>
            )}
          </AnimatePresence>
          <input
            value={nameTouched ? name : name || suggested}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            placeholder={t('files.linkName')}
            className="mt-3 h-10 w-full rounded-lg border border-line-strong bg-transparent px-3 text-[15px] font-medium outline-none transition-shadow placeholder:font-normal placeholder:text-fg-4 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t('files.notePlaceholder')}
            className="mt-2 w-full resize-none rounded-lg border border-line-strong bg-transparent px-3 py-2 text-[14px] outline-none transition-shadow placeholder:text-fg-4 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-line px-5 py-3">
          <ProjectPicker value={projectId} onChange={setProjectId} allowNone>
            <button
              type="button"
              className="flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[13px] text-fg-2 hover:bg-hover"
            >
              {project ? (
                <>
                  <PageIcon icon={project.icon} size={14} />
                  <span className="max-w-[180px] truncate">{project.name}</span>
                </>
              ) : (
                t('files.workspaceDrive')
              )}
              <ChevronDown size={13} />
            </button>
          </ProjectPicker>
          <span className="min-w-0 flex-1 truncate text-[12px] text-fg-4">{normalized ? domainOf(normalized) : ''}</span>
          <Button type="button" variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!normalized}
            iconRight={
              <Kbd className="border-white/30 text-white/80">
                <CornerDownLeft size={11} />
              </Kbd>
            }
          >
            {t('common.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
