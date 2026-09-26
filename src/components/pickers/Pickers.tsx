import { useMemo, useState, type ReactElement } from 'react';
import { IterationCw } from 'lucide-react';
import { useProjectSprints } from '@/lib/sprints';
import { Popover } from '@/components/ui/Overlay';
import { Avatar, Chip, PageIcon } from '@/components/ui/bits';
import { OptionList, type Option } from './OptionList';
import { PriorityIcon, StatusIcon, TypeIcon } from './icons';
import { HORIZONS, HORIZON_COLOR, ITEM_TYPES, PRIORITIES, STATUSES, PROJECT_STATUSES, PROJECT_STATUS_COLOR } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { useData } from '@/lib/store';
import type { Horizon, ID, ItemStatus, ItemType, Priority, ProjectStatus } from '@/lib/types';

type PickerProps<T> = {
  value: T;
  onChange: (v: T) => void;
  children: ReactElement;
  align?: 'start' | 'center' | 'end';
};

function PickerShell<T>({
  children,
  align,
  options,
  value,
  onChange,
  placeholder,
  searchable,
}: {
  children: ReactElement;
  align?: 'start' | 'center' | 'end';
  options: Option<T>[];
  value: T | T[];
  onChange: (v: T) => void;
  placeholder?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children} align={align}>
      <OptionList
        options={options}
        selected={value}
        placeholder={placeholder}
        searchable={searchable}
        onSelect={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
    </Popover>
  );
}

export function StatusPicker({ value, onChange, children, align }: PickerProps<ItemStatus>) {
  const t = useT();
  const options = useMemo(() => STATUSES.map((s) => ({ value: s, label: t(`status.${s}`), icon: <StatusIcon status={s} /> })), [t]);
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} placeholder={t('prop.status')}>
      {children}
    </PickerShell>
  );
}

export function PriorityPicker({ value, onChange, children, align }: PickerProps<Priority>) {
  const t = useT();
  const options = useMemo(() => PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), icon: <PriorityIcon priority={p} /> })), [t]);
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} placeholder={t('prop.priority')}>
      {children}
    </PickerShell>
  );
}

export function TypePicker({ value, onChange, children, align }: PickerProps<ItemType>) {
  const t = useT();
  const options = useMemo(() => ITEM_TYPES.map((ty) => ({ value: ty, label: t(`type.${ty}`), icon: <TypeIcon type={ty} size={14} /> })), [t]);
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} searchable={false}>
      {children}
    </PickerShell>
  );
}

export function HorizonPicker({ value, onChange, children, align }: PickerProps<Horizon | undefined>) {
  const t = useT();
  const options = useMemo<Option<Horizon | undefined>[]>(
    () => [
      ...HORIZONS.map((h) => ({
        value: h as Horizon | undefined,
        label: t(`horizon.${h}`),
        icon: <span data-color={HORIZON_COLOR[h]} className="tint-solid h-2 w-2 rounded-full" />,
      })),
      { value: undefined, label: t('horizon.unsorted'), icon: <span className="h-2 w-2 rounded-full border border-fg-4" /> },
    ],
    [t],
  );
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} searchable={false}>
      {children}
    </PickerShell>
  );
}

export function ProjectStatusPicker({ value, onChange, children, align }: PickerProps<ProjectStatus>) {
  const t = useT();
  const options = useMemo(
    () =>
      PROJECT_STATUSES.map((s) => ({
        value: s,
        label: t(`pstatus.${s}`),
        icon: <span data-color={PROJECT_STATUS_COLOR[s]} className="tint-solid h-2 w-2 rounded-full" />,
      })),
    [t],
  );
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} searchable={false}>
      {children}
    </PickerShell>
  );
}

export function PersonPicker({ value, onChange, children, align }: PickerProps<ID | undefined>) {
  const t = useT();
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const options = useMemo<Option<ID | undefined>[]>(
    () => [
      { value: undefined, label: t('prop.unassigned'), icon: <Avatar size={16} /> },
      ...Object.values(people)
        .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name)))
        .map((p) => ({
          value: p.id as ID | undefined,
          label: p.name,
          hint: p.id === meId ? t('settings.you') : p.role,
          icon: <Avatar person={p} size={16} />,
        })),
    ],
    [people, meId, t],
  );
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} placeholder={t('prop.assignee')}>
      {children}
    </PickerShell>
  );
}

export function ProjectPicker({ value, onChange, children, align, allowNone }: PickerProps<ID | undefined> & { allowNone?: boolean }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const options = useMemo<Option<ID | undefined>[]>(() => {
    const list: Option<ID | undefined>[] = Object.values(projects)
      .filter((p) => !p.archived)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ value: p.id, label: p.name || t('common.untitled'), icon: <PageIcon icon={p.icon} size={16} /> }));
    if (allowNone) list.unshift({ value: undefined, label: t('common.noProject') });
    return list;
  }, [projects, t, allowNone]);
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} placeholder={t('prop.project')}>
      {children}
    </PickerShell>
  );
}

export function ParentPicker({
  value,
  onChange,
  children,
  align,
  projectId,
  excludeId,
}: PickerProps<ID | undefined> & { projectId: ID; excludeId?: ID }) {
  const t = useT();
  const items = useData((s) => s.items);
  const options = useMemo<Option<ID | undefined>[]>(() => {
    // An item can't become a child of itself or of its own descendants.
    const blocked = new Set<ID>();
    if (excludeId) {
      blocked.add(excludeId);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of Object.values(items)) {
          if (it.parentId && blocked.has(it.parentId) && !blocked.has(it.id)) {
            blocked.add(it.id);
            grew = true;
          }
        }
      }
    }
    return [
      { value: undefined, label: t('prop.noParent') },
      ...Object.values(items)
        .filter((i) => i.projectId === projectId && !blocked.has(i.id) && ['initiative', 'epic', 'feature'].includes(i.type))
        .sort((a, b) => ITEM_TYPES.indexOf(a.type) - ITEM_TYPES.indexOf(b.type) || a.title.localeCompare(b.title))
        .map((i) => ({ value: i.id as ID | undefined, label: i.title || t('common.untitled'), icon: <TypeIcon type={i.type} size={14} /> })),
    ];
  }, [items, projectId, excludeId, t]);
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} placeholder={t('prop.parent')}>
      {children}
    </PickerShell>
  );
}

const TAG_COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow', 'brown', 'red', 'gray'] as const;

export function tagColor(tag: string) {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

export function TagChip({ tag }: { tag: string }) {
  return <Chip color={tagColor(tag)}>{tag}</Chip>;
}

export function TagPicker({ value, onChange, children, align }: PickerProps<string[]>) {
  const t = useT();
  const items = useData((s) => s.items);
  const all = useMemo(() => {
    const set = new Set<string>();
    for (const it of Object.values(items)) it.tags.forEach((tg) => set.add(tg));
    value.forEach((tg) => set.add(tg));
    return [...set].sort();
  }, [items, value]);
  const [open, setOpen] = useState(false);
  const toggle = (tag: string) => onChange(value.includes(tag) ? value.filter((x) => x !== tag) : [...value, tag]);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children} align={align}>
      <OptionList
        options={all.map((tg) => ({ value: tg, label: tg, icon: <span data-color={tagColor(tg)} className="tint-solid h-2 w-2 rounded-full" /> }))}
        selected={value}
        placeholder={t('prop.addTag')}
        onSelect={toggle}
        onCreate={(q) => onChange([...value, q.toLowerCase()])}
        createLabel={(q) => t('prop.createTag', { tag: q })}
      />
    </Popover>
  );
}

/** Sprint of the item's project. Finished sprints are listed only when already selected. */
export function SprintPicker({ projectId, value, onChange, children, align }: PickerProps<ID | undefined> & { projectId: ID }) {
  const t = useT();
  const sprints = useProjectSprints(projectId);
  const options = useMemo<Option<ID | undefined>[]>(
    () => [
      ...sprints
        .filter((sp) => sp.status !== 'completed' || sp.id === value)
        .map((sp) => ({
          value: sp.id as ID | undefined,
          label: sp.name,
          hint: t(`sprint.status.${sp.status}`),
          icon: <IterationCw size={14} className={sp.status === 'active' ? 'text-accent' : 'text-fg-3'} />,
        })),
      { value: undefined, label: t('sprint.none'), icon: <IterationCw size={14} className="text-fg-4" /> },
    ],
    [sprints, value, t],
  );
  return (
    <PickerShell options={options} value={value} onChange={onChange} align={align} placeholder={t('prop.sprint')}>
      {children}
    </PickerShell>
  );
}
