import { useMemo, useState, type ReactElement } from 'react';
import { Repeat } from 'lucide-react';
import { Popover } from '@/components/ui/Overlay';
import { useT, type TFunction } from '@/lib/i18n';
import { RECURRENCE_PRESETS, normalizeRecurrence, presetOf, type RecurrencePreset } from '@/lib/recurrence';
import type { Recurrence } from '@/lib/types';
import { cn } from '@/lib/utils';
import { OptionList, type Option } from './OptionList';

/** "Every week", "Every 3 days"... or undefined for a task that does not repeat. */
export function recurrenceLabel(t: TFunction, rule?: Recurrence): string | undefined {
  const r = normalizeRecurrence(rule);
  if (!r) return undefined;
  const preset = presetOf(r);
  if (preset !== 'custom' && preset !== 'none') return t(`repeat.${preset}`);
  return t(`repeat.every.${r.freq as Exclude<Recurrence['freq'], 'weekdays'>}`, { n: r.interval });
}

type Choice = RecurrencePreset | 'custom' | 'none';

/** Repeat rule picker with Notion-like presets: every day, every weekday, every week... */
export function RecurrencePicker({
  value,
  onChange,
  children,
  align,
}: {
  value?: Recurrence;
  onChange: (rule: Recurrence | undefined) => void;
  children: ReactElement;
  align?: 'start' | 'center' | 'end';
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = presetOf(value);
  const options = useMemo<Option<Choice>[]>(() => {
    const list: Option<Choice>[] = RECURRENCE_PRESETS.map((p) => ({ value: p.key, label: t(`repeat.${p.key}`) }));
    // A rule set elsewhere (e.g. every 3 days) stays visible and selected.
    if (current === 'custom') list.push({ value: 'custom', label: recurrenceLabel(t, value) ?? '' });
    list.push({ value: 'none', label: t('repeat.none') });
    return list;
  }, [t, current, value]);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children} align={align}>
      <div className="w-[240px]">
        <OptionList
          options={options}
          selected={current}
          searchable={false}
          onSelect={(choice) => {
            if (choice !== 'custom') onChange(choice === 'none' ? undefined : RECURRENCE_PRESETS.find((p) => p.key === choice)?.rule);
            setOpen(false);
          }}
        />
        <div className="border-t border-line px-3 py-2 text-[12px] leading-snug text-fg-3">{t('repeat.hint')}</div>
      </div>
    </Popover>
  );
}

/** Small repeat sign shown next to the due date of a recurring task. */
export function RecurrenceMark({ rule, size = 12, className }: { rule?: Recurrence; size?: number; className?: string }) {
  const t = useT();
  const label = recurrenceLabel(t, rule);
  if (!label) return null;
  return (
    <span title={label} aria-label={label} role="img" className={cn('inline-flex shrink-0 items-center text-fg-3', className)}>
      <Repeat size={size} />
    </span>
  );
}
