import { AnimatePresence, motion } from 'motion/react';
import { Search, SmilePlus } from 'lucide-react';
import { forwardRef, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactElement } from 'react';
import { useData } from '@/lib/store';
import { useLang, useT } from '@/lib/i18n';
import { ALL_EMOJI, EMOJI_GROUPS } from '@/lib/emoji';
import { QUICK_REACTIONS, isReactionKey, reactionList } from '@/lib/comments';
import type { Comment } from '@/lib/types';
import { cn, matches } from '@/lib/utils';
import { Popover, Tooltip } from './ui/Overlay';

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const NAMES_SHOWN = 10;

/** Reaction pills under a comment, like Notion: "👍 2", highlighted when you reacted. */
export function Reactions({ comment, canReact }: { comment: Comment; canReact: boolean }) {
  const t = useT();
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const toggle = useData((s) => s.toggleReaction);
  const list = reactionList(comment.reactions);
  if (!list.length) return null;
  const names = (ids: string[]) => {
    const shown = ids.slice(0, NAMES_SHOWN).map((id) => (id === meId ? t('comments.you') : (people[id]?.name ?? '—')));
    const rest = ids.length - shown.length;
    return rest > 0 ? `${shown.join(', ')} ${t('comments.andMore', { n: rest })}` : shown.join(', ');
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <AnimatePresence initial={false}>
        {list.map(([emoji, ids]) => {
          const mine = ids.includes(meId);
          const who = names(ids);
          return (
            <motion.span
              key={emoji}
              layout="position"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex"
            >
              <Tooltip content={who} side="top">
                <button
                  type="button"
                  aria-pressed={mine}
                  aria-disabled={!canReact}
                  aria-label={`${emoji} ${ids.length}: ${who}`}
                  onClick={() => canReact && toggle(comment.id, emoji)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[12.5px] font-medium tabular-nums transition-colors duration-100',
                    mine
                      ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-accent-soft text-[var(--c-blue-text)]'
                      : 'border-line text-fg-2',
                    canReact ? (mine ? 'hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]' : 'hover:bg-hover') : 'cursor-default',
                  )}
                >
                  <span className="text-[14px] leading-none" style={{ fontFamily: EMOJI_FONT }} aria-hidden>
                    {emoji}
                  </span>
                  <span aria-hidden>{ids.length}</span>
                </button>
              </Tooltip>
            </motion.span>
          );
        })}
      </AnimatePresence>
      {canReact && (
        <ReactionPicker onPick={(emoji) => toggle(comment.id, emoji)}>
          <AddReactionButton label={t('comments.addReaction')} className="h-6 w-7 rounded-full border border-line" />
        </ReactionPicker>
      )}
    </div>
  );
}

/** The smile button that opens the reaction picker. */
export const AddReactionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function AddReactionButton({ label, className, ...rest }, ref) {
    return (
      <Tooltip content={label}>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex shrink-0 items-center justify-center text-fg-3 transition-colors duration-100 hover:bg-hover hover:text-fg-2 data-[state=open]:bg-hover data-[state=open]:text-fg-2',
            className,
          )}
          {...rest}
        >
          <SmilePlus size={14} />
        </button>
      </Tooltip>
    );
  },
);

/** Compact emoji picker: quick reactions first, then the whole catalogue with search. Arrow keys move between emoji. */
export function ReactionPicker({ children, onPick }: { children: ReactElement; onPick: (emoji: string) => void }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    if (!q.trim()) return null;
    const seen = new Set<string>();
    return [...QUICK_REACTIONS, ...ALL_EMOJI]
      .filter((e) => isReactionKey(e.e) && matches(e.k, q) && !seen.has(e.e) && !!seen.add(e.e))
      .map((e) => e.e);
  }, [q]);

  const setOpenState = (o: boolean) => {
    setOpen(o);
    if (!o) setQ('');
  };
  const pick = (emoji: string) => {
    onPick(emoji);
    setOpenState(false);
  };

  const buttons = () => [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]') ?? [])];
  const focus = (el: HTMLElement | undefined) => {
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };
  // Grid navigation: left/right walk the list, up/down jump to the closest emoji in the next row.
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = buttons();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'ArrowRight') return focus(all[i + 1]);
    if (e.key === 'ArrowLeft') return focus(i === 0 ? (search.current ?? undefined) : all[i - 1]);
    const from = all[i].getBoundingClientRect();
    const down = e.key === 'ArrowDown';
    const rows = all.filter((b) => (down ? b.getBoundingClientRect().top > from.top + 4 : b.getBoundingClientRect().top < from.top - 4));
    if (!rows.length) return down ? undefined : focus(search.current ?? undefined);
    const tops = rows.map((b) => b.getBoundingClientRect().top);
    const rowTop = down ? Math.min(...tops) : Math.max(...tops);
    const center = (r: DOMRect) => r.left + r.width / 2;
    const target = rows
      .filter((b) => Math.abs(b.getBoundingClientRect().top - rowTop) < 4)
      .reduce((best, b) =>
        Math.abs(center(b.getBoundingClientRect()) - center(from)) < Math.abs(center(best.getBoundingClientRect()) - center(from)) ? b : best,
      );
    focus(target);
  };

  // One tab stop for the whole grid: Tab from the search lands on the first emoji, arrows do the rest.
  const grid = (list: string[], first = false) => (
    <div className="grid grid-cols-8 gap-0.5">
      {list.map((emoji, i) => (
        <button
          key={emoji}
          type="button"
          data-emoji={emoji}
          aria-label={emoji}
          tabIndex={first && i === 0 ? 0 : -1}
          onClick={() => pick(emoji)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none outline-none transition-transform hover:scale-110 hover:bg-hover focus-visible:bg-hover focus-visible:shadow-[0_0_0_2px_var(--accent-soft)]"
          style={{ fontFamily: EMOJI_FONT }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
  const heading = (text: string) => <div className="px-1 pb-1 pt-2 text-[11.5px] font-medium text-fg-3">{text}</div>;

  return (
    <Popover open={open} onOpenChange={setOpenState} trigger={children} side="bottom" align="start" className="w-[292px] max-w-[calc(100vw-24px)]">
      <div className="px-2 pt-2">
        <div className="flex h-7 items-center gap-2 rounded-md bg-input px-2">
          <Search size={14} className="shrink-0 text-fg-3" />
          <input
            ref={search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                const first = results ? results[0] : undefined;
                if (first) pick(first);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                focus(buttons()[0]);
              }
            }}
            placeholder={t('comments.searchEmoji')}
            aria-label={t('comments.searchEmoji')}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4"
          />
        </div>
      </div>
      <div ref={gridRef} onKeyDown={onGridKey} className="max-h-[248px] overflow-y-auto px-2 pb-2">
        {results ? (
          results.length ? (
            <div className="pt-2">{grid(results, true)}</div>
          ) : (
            <div className="px-1 py-6 text-center text-[13px] text-fg-3">{t('comments.noEmoji')}</div>
          )
        ) : (
          <>
            {heading(t('comments.quickReactions'))}
            {grid(
              QUICK_REACTIONS.map((e) => e.e),
              true,
            )}
            {EMOJI_GROUPS.map((group) => (
              <div key={group.id}>
                {heading(lang === 'ru' ? group.ru : group.en)}
                {grid([...new Set(group.items.map((e) => e.e))].filter(isReactionKey))}
              </div>
            ))}
          </>
        )}
      </div>
    </Popover>
  );
}
