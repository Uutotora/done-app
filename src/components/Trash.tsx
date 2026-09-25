import { AnimatePresence, motion } from 'motion/react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { timeAgo } from '@/lib/dates';
import { matches } from '@/lib/utils';
import { Popover } from './ui/Overlay';
import { IconButton } from './ui/Button';
import { PageIcon } from './ui/bits';
import { Tooltip } from './ui/Overlay';

/** Notion-style trash: a popover with everything deleted in the last 30 days. */
export function TrashButton() {
  const t = useT();
  const lang = useLang();
  const trash = useData((s) => s.trash);
  const restoreTrash = useData((s) => s.restoreTrash);
  const purgeTrash = useData((s) => s.purgeTrash);
  const emptyTrash = useData((s) => s.emptyTrash);
  const [q, setQ] = useState('');
  const list = useMemo(() => (q ? trash.filter((e) => matches(e.title, q)) : trash), [trash, q]);

  return (
    <Popover
      side="right"
      align="end"
      sideOffset={10}
      trigger={
        <button className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[14px] text-fg-2 transition-colors hover:bg-hover">
          <Trash2 size={17} className="text-fg-3" />
          <span className="flex-1 truncate text-left">{t('nav.trash')}</span>
          {trash.length > 0 && <span className="text-[12px] text-fg-4">{trash.length}</span>}
        </button>
      }
    >
      <div className="flex max-h-[460px] w-[400px] flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search size={14} className="text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('trash.search')}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
        </div>
        <div className="min-h-[120px] flex-1 overflow-y-auto p-1">
          {list.length === 0 && (
            <div className="flex h-[140px] flex-col items-center justify-center gap-2 text-[13.5px] text-fg-3">
              <Trash2 size={28} className="text-fg-4" />
              {t('trash.empty')}
            </div>
          )}
          <AnimatePresence initial={false}>
            {list.map((e) => (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, height: 0 }}
                className="group flex h-11 items-center gap-2.5 rounded-md px-2 hover:bg-hover"
              >
                <PageIcon icon={e.icon ?? '📄'} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]">{e.title}</div>
                  <div className="text-[11.5px] text-fg-3">
                    {t(`trash.kind.${e.kind}` as TKey)} · {timeAgo(e.deletedAt, lang)}
                  </div>
                </div>
                <Tooltip content={t('trash.restore')}>
                  <IconButton
                    size="sm"
                    label={t('trash.restore')}
                    onClick={() => {
                      restoreTrash(e.id);
                      toast({ message: t('trash.restored', { title: e.title }), tone: 'success' });
                    }}
                  >
                    <RotateCcw size={15} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t('trash.purge')}>
                  <IconButton size="sm" label={t('trash.purge')} onClick={() => purgeTrash(e.id)}>
                    <Trash2 size={15} />
                  </IconButton>
                </Tooltip>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[12px] text-fg-3">
          <span>{t('trash.hint')}</span>
          {trash.length > 0 && (
            <button onClick={emptyTrash} className="rounded px-1.5 py-0.5 text-[12.5px] text-[var(--c-red-text)] hover:bg-[var(--c-red-bg)]">
              {t('trash.emptyAll')}
            </button>
          )}
        </div>
      </div>
    </Popover>
  );
}
