import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownUp, ChevronDown, Eye, EyeOff, Filter, Layers, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useData } from '@/lib/store';
import { useT, type TKey } from '@/lib/i18n';
import { ITEM_TYPES, PRIORITIES, STATUSES } from '@/lib/constants';
import { EMPTY_FILTER, activeFilterCount, type GroupField, type ItemFilter, type ItemSort, type SortField } from '@/lib/itemQuery';
import type { ID } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Popover, EntriesMenu } from './ui/Overlay';
import { Avatar, Switch } from './ui/bits';
import { OptionList, type Option } from './pickers/OptionList';
import { PriorityIcon, StatusIcon, TypeIcon } from './pickers/icons';
import { tagColor } from './pickers/Pickers';
import { BarButton } from './ViewBar';

type FilterKey = 'status' | 'type' | 'priority' | 'assignee' | 'tags';
const FILTER_KEYS: FilterKey[] = ['status', 'type', 'priority', 'assignee', 'tags'];
const FILTER_LABEL: Record<FilterKey, TKey> = {
  status: 'filter.status',
  type: 'filter.type',
  priority: 'filter.priority',
  assignee: 'filter.assignee',
  tags: 'filter.tag',
};

function useFilterOptions(): Record<FilterKey, Option<string>[]> {
  const t = useT();
  const people = useData((s) => s.people);
  const items = useData((s) => s.items);
  return useMemo(() => {
    const tags = new Set<string>();
    Object.values(items).forEach((i) => i.tags.forEach((tg) => tags.add(tg)));
    return {
      status: STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), icon: <StatusIcon status={s} /> })),
      type: ITEM_TYPES.map((ty) => ({ value: ty, label: t(`type.${ty}`), icon: <TypeIcon type={ty} size={14} /> })),
      priority: PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), icon: <PriorityIcon priority={p} /> })),
      assignee: [
        { value: 'none', label: t('prop.unassigned'), icon: <Avatar size={16} /> },
        ...Object.values(people).map((p) => ({ value: p.id as ID, label: p.name, icon: <Avatar person={p} size={16} /> })),
      ],
      tags: [...tags]
        .sort()
        .map((tg) => ({ value: tg, label: tg, icon: <span data-color={tagColor(tg)} className="tint-solid h-2 w-2 rounded-full" /> })),
    };
  }, [people, items, t]);
}

export function FilterButton({ filter, onChange }: { filter: ItemFilter; onChange: (f: ItemFilter) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<FilterKey | null>(null);
  const options = useFilterOptions();
  const count = activeFilterCount(filter);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setKey(null);
      }}
      align="end"
      trigger={
        <BarButton icon={<Filter size={15} />} active={count > 0}>
          {t('filter.filter')}
          {count > 0 && <span className="rounded bg-accent-soft px-1 text-[11.5px] font-semibold">{count}</span>}
        </BarButton>
      }
    >
      {key ? (
        <OptionList
          options={options[key]}
          selected={filter[key] as string[]}
          placeholder={t(FILTER_LABEL[key])}
          onSelect={(v) => {
            const cur = filter[key] as string[];
            onChange({ ...filter, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
          }}
        />
      ) : (
        <div className="w-[240px] p-1">
          {FILTER_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setKey(k)}
              className="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] hover:bg-hover"
            >
              <span className="flex-1">{t(FILTER_LABEL[k])}</span>
              {(filter[k] as string[]).length > 0 && <span className="text-[12px] text-accent">{(filter[k] as string[]).length}</span>}
            </button>
          ))}
          <div className="my-1 h-px bg-line" />
          <label className="flex h-8 cursor-pointer items-center justify-between rounded-[5px] px-2 text-[14px] hover:bg-hover">
            {t('backlog.hideDone')}
            <Switch checked={filter.hideDone} onChange={(v) => onChange({ ...filter, hideDone: v })} />
          </label>
          {count > 0 && (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                onClick={() => onChange({ ...EMPTY_FILTER, search: filter.search })}
                className="flex h-8 w-full items-center rounded-[5px] px-2 text-[14px] text-fg-3 hover:bg-hover"
              >
                {t('filter.clear')}
              </button>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

/** Active filters as pills under the view bar, each editable in place. */
export function FilterPills({ filter, onChange, extra }: { filter: ItemFilter; onChange: (f: ItemFilter) => void; extra?: ReactNode }) {
  const t = useT();
  const options = useFilterOptions();
  const active = FILTER_KEYS.filter((k) => (filter[k] as string[]).length);
  const show = active.length > 0 || filter.hideDone || !!extra;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden"
        >
          <div className="full-width flex flex-wrap items-center gap-1.5 py-2">
            {active.map((k) => {
              const values = filter[k] as string[];
              const labels = values.map((v) => options[k].find((o) => o.value === v)?.label ?? v);
              return (
                <Popover
                  key={k}
                  trigger={
                    <button className="flex h-7 items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 text-[13px] text-accent transition-colors hover:bg-accent/20">
                      <span className="font-medium">{t(FILTER_LABEL[k])}:</span>
                      <span className="max-w-[200px] truncate">{labels.join(', ')}</span>
                      <ChevronDown size={13} />
                    </button>
                  }
                >
                  <OptionList
                    options={options[k]}
                    selected={values}
                    onSelect={(v) => onChange({ ...filter, [k]: values.includes(v) ? values.filter((x) => x !== v) : [...values, v] })}
                  />
                  <div className="border-t border-line p-1">
                    <button
                      onClick={() => onChange({ ...filter, [k]: [] })}
                      className="flex h-8 w-full items-center rounded-[5px] px-2 text-[13.5px] text-fg-3 hover:bg-hover"
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                </Popover>
              );
            })}
            {filter.hideDone && (
              <button
                onClick={() => onChange({ ...filter, hideDone: false })}
                className="flex h-7 items-center gap-1 rounded-full border border-line-strong px-2.5 text-[13px] text-fg-2 hover:bg-hover"
              >
                {t('backlog.hideDone')} <X size={12} />
              </button>
            )}
            {extra}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const SORT_FIELDS: SortField[] = ['manual', 'rice', 'priority', 'due', 'updated', 'created', 'title'];
const SORT_LABEL: Record<SortField, TKey> = {
  manual: 'backlog.sort.manual',
  rice: 'backlog.sort.rice',
  priority: 'backlog.sort.priority',
  due: 'backlog.sort.due',
  updated: 'backlog.sort.updated',
  created: 'prop.created',
  title: 'prop.title',
};

export function SortButton({ sort, onChange }: { sort: ItemSort; onChange: (s: ItemSort) => void }) {
  const t = useT();
  return (
    <EntriesMenu
      align="end"
      trigger={
        <BarButton icon={<ArrowDownUp size={15} />} active={sort.field !== 'manual'}>
          {sort.field === 'manual' ? t('filter.sort') : t(SORT_LABEL[sort.field])}
        </BarButton>
      }
      entries={[
        ...SORT_FIELDS.map((f) => ({ key: f, label: t(SORT_LABEL[f]), checked: sort.field === f, onSelect: () => onChange({ ...sort, field: f }) })),
        { key: 's', separator: true as const },
        { key: 'asc', label: '↑ A → Z, 1 → 9', checked: sort.dir === 'asc', onSelect: () => onChange({ ...sort, dir: 'asc' as const }) },
        { key: 'desc', label: '↓ Z → A, 9 → 1', checked: sort.dir === 'desc', onSelect: () => onChange({ ...sort, dir: 'desc' as const }) },
      ]}
    />
  );
}

const GROUP_FIELDS: GroupField[] = ['none', 'status', 'type', 'priority', 'horizon', 'assignee'];
const GROUP_LABEL: Record<GroupField, TKey> = {
  none: 'backlog.group.none',
  status: 'backlog.group.status',
  type: 'backlog.group.type',
  priority: 'backlog.group.priority',
  horizon: 'backlog.group.horizon',
  assignee: 'filter.assignee',
};

export function GroupButton({
  group,
  onChange,
  fields = GROUP_FIELDS,
}: {
  group: GroupField;
  onChange: (g: GroupField) => void;
  fields?: GroupField[];
}) {
  const t = useT();
  return (
    <EntriesMenu
      align="end"
      trigger={
        <BarButton icon={<Layers size={15} />} active={group !== 'none'}>
          {group === 'none' ? t('filter.group') : t(GROUP_LABEL[group])}
        </BarButton>
      }
      entries={fields.map((g) => ({ key: g, label: t(GROUP_LABEL[g]), checked: group === g, onSelect: () => onChange(g) }))}
    />
  );
}

export function SearchToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(!!value);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center">
      <BarButton
        icon={<Search size={15} />}
        active={!!value}
        onClick={() => {
          setOpen(true);
          setTimeout(() => ref.current?.focus(), 30);
        }}
      />
      <motion.div
        initial={false}
        animate={{ width: open ? 180 : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden"
      >
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => !value && setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onChange('');
              setOpen(false);
            }
          }}
          placeholder={t('filter.search')}
          className="h-7 w-[176px] bg-transparent px-1 text-[14px] outline-none"
        />
      </motion.div>
    </div>
  );
}

export function PropertiesButton<K extends string>({
  columns,
  hidden,
  onChange,
}: {
  columns: { key: K; label: string; icon?: ReactNode }[];
  hidden: K[];
  onChange: (h: K[]) => void;
}) {
  const t = useT();
  return (
    <Popover align="end" trigger={<BarButton icon={<SlidersHorizontal size={15} />} aria-label={t('filter.properties')} />}>
      <div className="w-[240px] p-1">
        <div className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-fg-3">{t('filter.properties')}</div>
        {columns.map((c) => {
          const isHidden = hidden.includes(c.key);
          return (
            <button
              key={c.key}
              onClick={() => onChange(isHidden ? hidden.filter((h) => h !== c.key) : [...hidden, c.key])}
              className="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px] hover:bg-hover"
            >
              <span className="flex w-4 justify-center text-fg-3">{c.icon}</span>
              <span className={cn('flex-1', isHidden && 'text-fg-3')}>{c.label}</span>
              {isHidden ? <EyeOff size={14} className="text-fg-4" /> : <Eye size={14} className="text-fg-2" />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
