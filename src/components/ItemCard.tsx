import { CalendarDays, ListTree, MessageSquare, MoreHorizontal } from 'lucide-react';
import { forwardRef, useMemo, type HTMLAttributes } from 'react';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { formatShortDate, todayISO } from '@/lib/dates';
import { formatScore, riceScore } from '@/lib/rice';
import { PLANE_GROUP_COLOR } from '@/lib/constants';
import { setItemStatus } from '@/lib/actions';
import type { Item } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar, PageIcon } from './ui/bits';
import { ContextMenu, EntriesMenu } from './ui/Overlay';
import { IconButton } from './ui/Button';
import { PriorityIcon, StatusIcon, TypeIcon } from './pickers/icons';
import { TagChip } from './pickers/Pickers';
import { blockersOf, isFinished } from '@/lib/work';
import { itemMenuEntries } from './itemMenu';

export interface CardOptions {
  project?: boolean;
  status?: boolean;
  rice?: boolean;
}

/** Notion-style board card. Forward ref so dnd-kit can attach listeners. */
export const ItemCard = forwardRef<
  HTMLDivElement,
  { item: Item; show?: CardOptions; overlay?: boolean; ghost?: boolean } & HTMLAttributes<HTMLDivElement>
>(function ItemCard({ item, show = {}, overlay, ghost, className, ...rest }, ref) {
  const t = useT();
  const lang = useLang();
  const people = useData((s) => s.people);
  const project = useData((s) => s.projects[item.projectId]);
  const itemsRec = useData((s) => s.items);
  const commentCount = useData((s) => Object.values(s.comments).filter((c) => c.targetId === item.id).length);
  const openPeek = useUI((s) => s.openPeek);
  const sub = useMemo(() => {
    const kids = Object.values(itemsRec).filter((i) => i.parentId === item.id);
    return { total: kids.length, done: kids.filter((k) => k.status === 'done').length };
  }, [itemsRec, item.id]);
  const score = riceScore(item.rice);
  const overdue = item.dueDate && item.dueDate < todayISO() && !isFinished(item);

  return (
    <ContextMenu entries={itemMenuEntries(item)} disabled={overlay}>
      <div
        ref={ref}
        data-peek-keep
        onClick={() => openPeek(item.id)}
        className={cn(
          'group/card relative cursor-pointer select-none rounded-lg border border-line bg-elevated p-2.5 shadow-sm transition-[box-shadow,background-color,translate,border-color] duration-150 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-md',
          overlay && 'rotate-[1.5deg] cursor-grabbing shadow-lg ring-1 ring-accent/30',
          ghost && 'opacity-40',
          className,
        )}
        {...rest}
      >
        <div
          className="absolute right-1.5 top-1.5 translate-x-1 opacity-0 transition-[opacity,translate] duration-150 group-hover/card:translate-x-0 group-hover/card:opacity-100 has-[[data-state=open]]:translate-x-0 has-[[data-state=open]]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <EntriesMenu
            align="end"
            entries={itemMenuEntries(item)}
            trigger={
              <IconButton size="sm" className="bg-elevated shadow-sm" label={t('item.moreActions')} onPointerDown={(e) => e.stopPropagation()}>
                <MoreHorizontal size={14} />
              </IconButton>
            }
          />
        </div>
        {show.project && project && (
          <div className="mb-1 flex items-center gap-1 text-[11.5px] text-fg-3">
            <PageIcon icon={project.icon} size={12} />
            <span className="truncate">{project.name}</span>
          </div>
        )}
        <div className="flex items-start gap-2 pr-5">
          {show.status ? (
            <button
              className="mt-[3px] shrink-0 rounded hover:bg-active"
              onClick={(e) => {
                e.stopPropagation();
                setItemStatus(item.id, item.status === 'done' ? 'in_progress' : 'done', e);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <StatusIcon status={item.status} />
            </button>
          ) : (
            <span className="mt-[3px] shrink-0">
              <TypeIcon type={item.type} size={14} />
            </span>
          )}
          <div
            className={cn('min-w-0 flex-1 text-[14px] font-medium leading-snug', item.status === 'done' && 'text-fg-3 line-through decoration-fg-4')}
          >
            {item.title || t('common.untitled')}
          </div>
        </div>
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tg) => (
              <TagChip key={tg} tag={tg} />
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap text-[12px] text-fg-3">
          {blockersOf(item, itemsRec).length > 0 && !isFinished(item) && (
            <span className="rounded bg-[var(--c-orange-bg)] px-1.5 text-[var(--c-orange-text)]">{t('work.blocked')}</span>
          )}
          {item.priority !== 'none' && <PriorityIcon priority={item.priority} />}
          {show.rice && score != null && (
            <span className="rounded bg-hover px-1.5 py-[1px] font-medium tabular-nums text-fg-2" title="RICE">
              {formatScore(score)}
            </span>
          )}
          {item.dueDate && (
            <span className={cn('flex items-center gap-1', overdue && 'font-medium text-[var(--c-red-text)]')}>
              <CalendarDays size={12} />
              {formatShortDate(item.dueDate, lang)}
            </span>
          )}
          {sub.total > 0 && (
            <span className="flex items-center gap-1">
              <ListTree size={12} />
              {sub.done}/{sub.total}
            </span>
          )}
          {commentCount > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare size={12} />
              {commentCount}
            </span>
          )}
          {item.plane && (
            <span
              data-color={item.plane.stateGroup ? PLANE_GROUP_COLOR[item.plane.stateGroup] : 'gray'}
              className="tint-text font-mono text-[11px] font-medium"
            >
              {item.plane.key}
            </span>
          )}
          <span className="flex-1" />
          {item.assigneeId && <Avatar person={people[item.assigneeId]} size={20} />}
        </div>
      </div>
    </ContextMenu>
  );
});
