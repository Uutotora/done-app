import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Popover } from '@/components/ui/Overlay';
import { Segmented } from '@/components/ui/bits';
import { dateLocale, useLang, useT } from '@/lib/i18n';
import { fromISODate, shiftISO, toISODate, todayISO, weekStartsOn } from '@/lib/dates';
import type { ISODate } from '@/lib/types';
import { cn } from '@/lib/utils';

export function MiniCalendar({
  start,
  end,
  range,
  onPick,
}: {
  start?: ISODate;
  end?: ISODate;
  range: boolean;
  onPick: (start?: ISODate, end?: ISODate) => void;
}) {
  const lang = useLang();
  const [month, setMonth] = useState(() => startOfMonth(fromISODate(end || start || todayISO())));
  const [anchor, setAnchor] = useState<ISODate | null>(null);
  const [hover, setHover] = useState<ISODate | null>(null);
  const ws = weekStartsOn(lang);
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: ws }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: ws }),
  });
  const today = todayISO();

  let lo = start;
  let hi = end;
  if (range && anchor) {
    const other = hover ?? anchor;
    lo = anchor < other ? anchor : other;
    hi = anchor < other ? other : anchor;
  }

  const pick = (iso: ISODate) => {
    if (!range) {
      onPick(undefined, iso);
      return;
    }
    if (!anchor) {
      setAnchor(iso);
      return;
    }
    const a = anchor < iso ? anchor : iso;
    const b = anchor < iso ? iso : anchor;
    setAnchor(null);
    onPick(a, b);
  };

  return (
    <div className="w-[252px] select-none">
      <div className="mb-1 flex items-center justify-between px-1">
        <div className="text-[14px] font-semibold capitalize">{format(month, 'LLLL yyyy', { locale: dateLocale(lang) })}</div>
        <div className="flex">
          <button className="rounded p-1 text-fg-3 hover:bg-hover" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft size={16} />
          </button>
          <button className="rounded p-1 text-fg-3 hover:bg-hover" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11.5px] text-fg-3">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="py-1 capitalize">
            {format(d, 'EEEEEE', { locale: dateLocale(lang) })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
        {days.map((d) => {
          const iso = toISODate(d);
          const inRange = lo && hi && iso >= lo && iso <= hi;
          const isEdge = iso === lo || iso === hi;
          return (
            <button
              key={iso}
              onMouseEnter={() => setHover(iso)}
              onClick={() => pick(iso)}
              className={cn(
                'relative h-8 text-[13px] transition-colors',
                !isSameMonth(d, month) && 'text-fg-4',
                inRange && !isEdge && 'bg-accent-soft',
                iso === lo && hi && lo !== hi && 'rounded-l-md bg-accent-soft',
                iso === hi && lo && lo !== hi && 'rounded-r-md bg-accent-soft',
              )}
            >
              <span
                className={cn(
                  'mx-auto flex h-7 w-7 items-center justify-center rounded-md',
                  isEdge ? 'bg-accent font-semibold text-white' : 'hover:bg-hover',
                  iso === today && !isEdge && 'font-semibold text-[var(--c-red-text)]',
                )}
              >
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DatePicker({
  start,
  end,
  onChange,
  children,
  allowRange = true,
  align = 'start',
}: {
  start?: ISODate;
  end?: ISODate;
  onChange: (start?: ISODate, end?: ISODate) => void;
  children: ReactElement;
  allowRange?: boolean;
  align?: 'start' | 'center' | 'end';
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(!!start && allowRange);
  const today = todayISO();
  const quick = [
    { label: t('common.today'), v: today },
    { label: t('common.tomorrow'), v: shiftISO(today, 1) },
    { label: '+7', v: shiftISO(today, 7) },
    { label: '+14', v: shiftISO(today, 14) },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children} align={align}>
      <div className="p-3">
        {allowRange && (
          <div className="mb-3 flex justify-center">
            <Segmented
              value={range ? 'range' : 'single'}
              onChange={(v) => setRange(v === 'range')}
              options={[
                { value: 'single', label: t('prop.single') },
                { value: 'range', label: t('prop.range') },
              ]}
            />
          </div>
        )}
        {!range && (
          <div className="mb-2 flex gap-1">
            {quick.map((q) => (
              <button
                key={q.label}
                onClick={() => {
                  onChange(undefined, q.v);
                  setOpen(false);
                }}
                className="h-6 flex-1 rounded-[5px] bg-hover text-[12px] font-medium text-fg-2 hover:bg-active"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        <MiniCalendar
          start={range ? start : undefined}
          end={end}
          range={range}
          onPick={(s, e) => {
            onChange(range ? s : undefined, e);
            setOpen(false);
          }}
        />
        {(start || end) && (
          <button
            onClick={() => {
              onChange(undefined, undefined);
              setOpen(false);
            }}
            className="mt-2 h-7 w-full rounded-[5px] text-[13px] text-fg-3 hover:bg-hover"
          >
            {t('prop.clearDates')}
          </button>
        )}
      </div>
    </Popover>
  );
}
