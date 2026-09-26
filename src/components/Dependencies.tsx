import { GitBranch, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useT } from '@/lib/i18n';
import { blockersOf, canDependOn, isFinished } from '@/lib/work';
import { matches } from '@/lib/utils';
import type { Item } from '@/lib/types';
import { Popover } from './ui/Overlay';
import { IconButton } from './ui/Button';
import { StatusIcon } from './pickers/icons';

export function Dependencies({ item }: { item: Item }) {
  const t = useT();
  const items = useData((s) => s.items);
  const projects = useData((s) => s.projects);
  const update = useData((s) => s.updateItem);
  const openPeek = useUI((s) => s.openPeek);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const dependencies = (item.dependsOn ?? []).flatMap((id) => (items[id] ? [items[id]] : []));
  const blocking = Object.values(items).filter((i) => i.dependsOn?.includes(item.id) && !isFinished(i));
  const waiting = blockersOf(item, items);
  const candidates = Object.values(items)
    .filter(
      (i) =>
        !(item.dependsOn ?? []).includes(i.id) &&
        !projects[i.projectId]?.archived &&
        canDependOn(item.id, i.id, items) &&
        matches(`${i.title} ${projects[i.projectId]?.name ?? ''}`, query),
    )
    .slice(0, 30);
  return (
    <section className="mt-6 rounded-lg border border-line p-3" aria-label={t('dep.title')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <GitBranch size={14} className="text-fg-3" />
          {t('dep.title')}
        </h2>
        <Popover
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setQuery('');
          }}
          trigger={
            <button className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-fg-3 hover:bg-hover">
              <Plus size={13} />
              {t('dep.add')}
            </button>
          }
          align="end"
        >
          <div className="w-[min(340px,85vw)] p-1">
            <input
              aria-label={t('dep.search')}
              placeholder={t('dep.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mb-1 h-9 w-full border-b border-line bg-transparent px-2 text-[13px]"
            />
            <div className="max-h-64 overflow-y-auto">
              {candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => {
                    update(item.id, { dependsOn: [...(item.dependsOn ?? []), candidate.id] });
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-hover"
                >
                  <StatusIcon status={candidate.status} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{candidate.title}</span>
                    <span className="block truncate text-[11px] text-fg-3">{projects[candidate.projectId]?.name}</span>
                  </span>
                </button>
              ))}
              {!candidates.length && <p className="p-3 text-[13px] text-fg-3">{t('dep.empty')}</p>}
            </div>
          </div>
        </Popover>
      </div>
      {dependencies.length > 0 && (
        <p className="mb-2 mt-1 text-[12px] text-fg-3">{waiting.length ? t('dep.waiting', { n: waiting.length }) : t('dep.ready')}</p>
      )}
      {dependencies.map((dep) => (
        <div key={dep.id} className="flex items-center gap-1">
          <button
            data-peek-keep
            onClick={() => openPeek(dep.id)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1.5 text-left text-[13px] hover:bg-hover"
          >
            <StatusIcon status={dep.status} />
            <span className="truncate">{dep.title}</span>
          </button>
          <IconButton label={t('dep.remove')} onClick={() => update(item.id, { dependsOn: item.dependsOn?.filter((id) => id !== dep.id) })}>
            <X size={13} />
          </IconButton>
        </div>
      ))}
      {blocking.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="mb-1 text-[11px] text-fg-3">{t('dep.blocks')}</p>
          {blocking.map((dep) => (
            <button
              data-peek-keep
              key={dep.id}
              onClick={() => openPeek(dep.id)}
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-hover"
            >
              <StatusIcon status={dep.status} />
              <span className="truncate">{dep.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
