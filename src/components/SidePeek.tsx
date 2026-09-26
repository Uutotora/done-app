import { AnimatePresence, motion } from 'motion/react';
import { ChevronsRight, Link2, Maximize2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useT } from '@/lib/i18n';
import { deleteItemsWithUndo } from '@/lib/actions';
import { IconButton } from './ui/Button';
import { Menu, MenuItem, MenuSeparator, Tooltip } from './ui/Overlay';
import { PageIcon } from './ui/bits';
import { ItemDetail } from './ItemDetail';
import { TypeIcon } from './pickers/icons';

/** Notion's "side peek": the item slides over the current view without losing context. */
export function SidePeek() {
  const t = useT();
  const navigate = useNavigate();
  const id = useUI((s) => s.peekItemId);
  const openPeek = useUI((s) => s.openPeek);
  const item = useData((s) => (id ? s.items[id] : undefined));
  const project = useData((s) => (item ? s.projects[item.projectId] : undefined));
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Leave Escape to open popovers/menus/dialogs first.
      if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
      openPeek(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, openPeek]);

  useEffect(() => {
    if (id && !item) openPeek(undefined);
  }, [id, item, openPeek]);

  // Clicking outside closes the peek, except on other item rows (they switch the peek)
  // and on floating UI rendered in portals (pickers, menus, toasts).
  useEffect(() => {
    if (!id) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || panelRef.current?.contains(target)) return;
      if (target.closest('[data-peek-keep], [data-radix-popper-content-wrapper], [role="dialog"], [role="menu"]')) return;
      openPeek(undefined);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [id, openPeek]);

  return (
    <AnimatePresence>
      {item && (
        <motion.aside
          ref={panelRef}
          key="peek"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="fixed bottom-0 right-0 top-0 z-30 flex w-[min(760px,92vw)] flex-col border-l border-line bg-bg shadow-[rgba(15,15,15,0.04)_0_0_0_1px,rgba(15,15,15,0.08)_-6px_0_24px]"
        >
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
            <Tooltip content={t('item.close')} shortcut="Esc">
              <IconButton size="md" onClick={() => openPeek(undefined)} label={t('item.close')}>
                <ChevronsRight size={18} />
              </IconButton>
            </Tooltip>
            <Tooltip content={t('item.openFull')}>
              <IconButton
                size="md"
                label={t('item.openFull')}
                onClick={() => {
                  openPeek(undefined);
                  navigate(`/items/${item.id}`);
                }}
              >
                <Maximize2 size={15} />
              </IconButton>
            </Tooltip>
            <div className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-fg-3">
              {project && (
                <button
                  onClick={() => {
                    openPeek(undefined);
                    navigate(`/p/${project.id}/overview`);
                  }}
                  className="flex min-w-0 items-center gap-1.5 truncate rounded px-1 hover:bg-hover"
                >
                  <PageIcon icon={project.icon} size={14} />
                  <span className="truncate">{project.name}</span>
                </button>
              )}
              <span className="text-fg-4">/</span>
              <TypeIcon type={item.type} size={13} />
              <span className="truncate">{item.plane?.key ?? t(`type.${item.type}`)}</span>
            </div>
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
                  void navigator.clipboard?.writeText(`${location.origin}/items/${item.id}`);
                  toast({ message: t('common.copied') });
                }}
              >
                {t('item.copyId')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => deleteItemsWithUndo([item.id])}>
                {t('item.delete')}
              </MenuItem>
            </Menu>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              <ItemDetail item={item} />
            </motion.div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
