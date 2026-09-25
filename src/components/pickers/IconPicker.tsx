import { Search, Shuffle } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Popover } from '@/components/ui/Overlay';
import { Segmented } from '@/components/ui/bits';
import { ALL_EMOJI, EMOJI_GROUPS } from '@/lib/emoji';
import { ICONS } from '@/lib/icons';
import { COLORS, GRADIENTS, SOLID_COVERS } from '@/lib/constants';
import { useLang, useT } from '@/lib/i18n';
import type { ColorName, Cover, IconValue } from '@/lib/types';
import { cn, matches } from '@/lib/utils';

export function IconPicker({
  value,
  onChange,
  children,
  allowRemove = true,
  open: openProp,
  onOpenChange,
}: {
  value?: IconValue;
  onChange: (v: IconValue | undefined) => void;
  children: ReactElement;
  allowRemove?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const [tab, setTab] = useState<'emoji' | 'icons'>(value?.startsWith('icon:') ? 'icons' : 'emoji');
  const [q, setQ] = useState('');
  const [color, setColor] = useState<ColorName>(() => (value?.startsWith('icon:') ? (value.split(':')[2] as ColorName) : 'gray'));

  const emojiResults = useMemo(() => (q ? ALL_EMOJI.filter((e) => matches(e.k, q)) : null), [q]);
  const iconNames = useMemo(() => Object.keys(ICONS).filter((n) => !q || matches(n, q)), [q]);

  const pick = (v: IconValue | undefined) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children}>
      <div className="w-[372px]">
        <div className="flex items-center justify-between border-b border-line px-2 py-1.5">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'emoji', label: lang === 'ru' ? 'Эмодзи' : 'Emoji' },
              { value: 'icons', label: lang === 'ru' ? 'Иконки' : 'Icons' },
            ]}
          />
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (tab === 'emoji') pick(ALL_EMOJI[Math.floor(Math.random() * ALL_EMOJI.length)].e);
                else {
                  const names = Object.keys(ICONS);
                  pick(`icon:${names[Math.floor(Math.random() * names.length)]}:${color}`);
                }
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover"
              title="Random"
            >
              <Shuffle size={15} />
            </button>
            {allowRemove && value && (
              <button onClick={() => pick(undefined)} className="h-7 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover">
                {t('common.remove')}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex h-7 flex-1 items-center gap-2 rounded-md bg-input px-2">
            <Search size={14} className="text-fg-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('common.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
          </div>
          {tab === 'icons' && (
            <div className="flex gap-0.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  data-color={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'tint-solid h-4 w-4 rounded-full transition-transform',
                    color === c ? 'scale-110 ring-2 ring-accent ring-offset-1 ring-offset-[var(--bg-elevated)]' : 'hover:scale-110',
                  )}
                />
              ))}
            </div>
          )}
        </div>
        <div className="h-[280px] overflow-y-auto px-2 pb-2">
          {tab === 'emoji' ? (
            emojiResults ? (
              <EmojiGrid list={emojiResults.map((e) => e.e)} onPick={pick} />
            ) : (
              EMOJI_GROUPS.map((grp) => (
                <div key={grp.id}>
                  <div className="px-1 pb-1 pt-2 text-[11.5px] font-medium text-fg-3">{lang === 'ru' ? grp.ru : grp.en}</div>
                  <EmojiGrid list={grp.items.map((e) => e.e)} onPick={pick} />
                </div>
              ))
            )
          ) : (
            <div className="grid grid-cols-10 gap-0.5 pt-1">
              {iconNames.map((name) => {
                const Cmp = ICONS[name];
                return (
                  <button
                    key={name}
                    title={name}
                    data-color={color}
                    onClick={() => pick(`icon:${name}:${color}`)}
                    className="tint-text flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover"
                  >
                    <Cmp size={18} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Popover>
  );
}

function EmojiGrid({ list, onPick }: { list: string[]; onPick: (e: string) => void }) {
  return (
    <div className="grid grid-cols-10 gap-0.5">
      {[...new Set(list)].map((e) => (
        <button
          key={e}
          onClick={() => onPick(e)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[21px] leading-none transition-transform hover:scale-110 hover:bg-hover"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function CoverPicker({ value, onChange, children }: { value?: Cover; onChange: (c: Cover | undefined) => void; children: ReactElement }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const pick = (c: Cover | undefined) => {
    onChange(c);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children} align="end">
      <div className="w-[380px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-medium text-fg-3">{lang === 'ru' ? 'Градиенты' : 'Gradients'}</div>
          {value && (
            <button onClick={() => pick(undefined)} className="rounded px-1.5 text-[12.5px] text-fg-3 hover:bg-hover">
              {t('project.removeCover')}
            </button>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {GRADIENTS.map((gr) => (
            <button
              key={gr}
              onClick={() => pick({ kind: 'gradient', value: gr })}
              className={cn('h-14 rounded-md transition-transform hover:scale-[1.03]', value?.value === gr && 'ring-2 ring-accent')}
              style={{ background: gr }}
            />
          ))}
        </div>
        <div className="mb-2 mt-3 text-[12px] font-medium text-fg-3">{lang === 'ru' ? 'Цвета' : 'Colors'}</div>
        <div className="grid grid-cols-9 gap-1.5">
          {SOLID_COVERS.map((c) => (
            <button
              key={c}
              onClick={() => pick({ kind: 'color', value: c })}
              className={cn('h-8 rounded-md transition-transform hover:scale-105', value?.value === c && 'ring-2 ring-accent')}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </Popover>
  );
}
