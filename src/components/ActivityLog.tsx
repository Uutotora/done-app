import { ChevronRight, History } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useData } from '@/lib/store';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { formatShortDate, timeAgo } from '@/lib/dates';
import type { Activity, ID } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar } from './ui/bits';
import { PlaneLogo } from './PlanePanel';

export function ActivityLog({ itemId }: { itemId: ID }) {
  const t = useT();
  const lang = useLang();
  const activity = useData((s) => s.activity);
  const people = useData((s) => s.people);
  const projects = useData((s) => s.projects);
  const [open, setOpen] = useState(false);
  const list = useMemo(() => activity.filter((a) => a.itemId === itemId).reverse(), [activity, itemId]);
  if (!list.length) return null;

  const value = (a: Activity, v?: string): string => {
    if (!v) return t('activity.none');
    switch (a.kind) {
      case 'status':
        return t(`status.${v}` as TKey);
      case 'priority':
        return t(`priority.${v}` as TKey);
      case 'type':
        return t(`type.${v}` as TKey);
      case 'assignee':
        return people[v]?.name ?? '—';
      case 'due':
        return formatShortDate(v, lang);
      case 'project':
        return projects[v]?.name ?? '—';
      default:
        return v;
    }
  };

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] font-semibold text-fg-2 hover:bg-hover"
      >
        <ChevronRight size={14} className={cn('text-fg-3 transition-transform duration-150', open && 'rotate-90')} />
        <History size={14} className="text-fg-3" />
        {t('activity.section')}
        <span className="font-normal text-fg-4">{list.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="relative ml-3 mt-2 overflow-hidden border-l border-line pl-4"
          >
            {list.map((a) => {
              const actor = people[a.actorId];
              return (
                <li key={a.id} className="relative flex items-center gap-2 py-1.5 text-[13px] text-fg-2">
                  <span className="absolute -left-[21px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-bg bg-line-strong" />
                  {a.actorId === 'plane' ? <PlaneLogo size={16} /> : <Avatar person={actor} size={16} />}
                  <span className="font-medium text-fg">{a.actorId === 'plane' ? t('activity.plane') : (actor?.name ?? '—')}</span>
                  <span className="min-w-0 truncate">{t(`activity.k.${a.kind}` as TKey, { from: value(a, a.from), to: value(a, a.to) })}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-fg-4">{timeAgo(a.at, lang)}</span>
                </li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
