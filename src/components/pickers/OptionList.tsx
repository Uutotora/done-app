import { Check, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn, matches } from '@/lib/utils';

export interface Option<T> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  keywords?: string;
}

/**
 * Searchable, keyboard-driven option list used inside property popovers
 * (status, priority, assignee...). Mirrors Notion's select menus.
 */
export function OptionList<T>({
  options,
  selected,
  onSelect,
  placeholder,
  onCreate,
  createLabel,
  searchable = true,
  emptyLabel = '—',
  className,
}: {
  options: Option<T>[];
  selected?: T | T[];
  onSelect: (v: T) => void;
  placeholder?: string;
  onCreate?: (query: string) => void;
  createLabel?: (q: string) => string;
  searchable?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const isSelected = (v: T) => (Array.isArray(selected) ? selected.includes(v) : selected === v);

  const filtered = useMemo(() => (q ? options.filter((o) => matches(`${o.label} ${o.keywords ?? ''}`, q)) : options), [options, q]);
  const canCreate = !!onCreate && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (idx: number) => {
    if (idx < filtered.length) onSelect(filtered[idx].value);
    else if (canCreate) {
      onCreate!(q.trim());
      setQ('');
    }
  };

  return (
    <div
      className={cn('flex w-[260px] flex-col', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive((a) => (total ? (a + 1) % total : 0));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((a) => (total ? (a - 1 + total) % total : 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          choose(active);
        }
      }}
    >
      {searchable && (
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
          <Search size={14} className="text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
        </div>
      )}
      <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1" tabIndex={searchable ? -1 : 0} autoFocus={!searchable}>
        {filtered.map((o, idx) => (
          <button
            key={String(o.value)}
            data-idx={idx}
            onMouseEnter={() => setActive(idx)}
            onClick={() => choose(idx)}
            className={cn('flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] text-fg', active === idx && 'bg-hover')}
          >
            {o.icon && <span className="flex w-4 shrink-0 items-center justify-center">{o.icon}</span>}
            <span className="flex-1 truncate">{o.label}</span>
            {o.hint && <span className="text-[12px] text-fg-3">{o.hint}</span>}
            {isSelected(o.value) && <Check size={14} className="text-fg-2" />}
          </button>
        ))}
        {canCreate && (
          <button
            data-idx={filtered.length}
            onMouseEnter={() => setActive(filtered.length)}
            onClick={() => choose(filtered.length)}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] text-fg-2',
              active === filtered.length && 'bg-hover',
            )}
          >
            <Plus size={14} />
            <span className="truncate">{createLabel ? createLabel(q.trim()) : q.trim()}</span>
          </button>
        )}
        {!total && <div className="px-2 py-2 text-[13px] text-fg-3">{emptyLabel}</div>}
      </div>
    </div>
  );
}
