import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useData } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ID, Person } from '@/lib/types';
import { Avatar } from './ui/bits';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keeps only people whose "@Name" is still present in the text. */
export function mentionsInText(text: string, ids: ID[], people: Record<ID, Person>): ID[] {
  return [...new Set(ids)].filter((id) => people[id] && text.includes(`@${people[id].name}`));
}

/** Renders text with @mentions highlighted; a mention of the current member stands out. */
export function MentionText({ text, mentions }: { text: string; mentions?: ID[] }) {
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const parts = useMemo(() => {
    const candidates = (mentions ?? Object.keys(people))
      .map((id) => people[id])
      .filter((p): p is Person => !!p?.name)
      .sort((a, b) => b.name.length - a.name.length);
    if (!candidates.length) return [text];
    const byName = new Map(candidates.map((p) => [p.name, p]));
    const re = new RegExp(`@(${candidates.map((p) => escapeRe(p.name)).join('|')})`, 'g');
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const person = byName.get(m[1])!;
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(
        <span
          key={`${m.index}`}
          className={cn(
            'rounded-[4px] px-[2px] font-medium',
            person.id === meId ? 'bg-[var(--c-yellow-bg)] text-[var(--c-yellow-text)]' : 'text-accent',
          )}
        >
          @{person.name}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, mentions, people, meId]);
  return <>{parts}</>;
}

interface MentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  mentions: ID[];
  onMentionsChange: (ids: ID[]) => void;
  /** Enter without Shift, when the mention list is closed. */
  onSubmit?: () => void;
}

/** Auto-growing textarea that suggests teammates after "@", like Notion comments. */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea(
  { value, onValueChange, mentions, onMentionsChange, onSubmit, className, onKeyDown, onBlur, ...rest },
  outerRef,
) {
  const t = useT();
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [index, setIndex] = useState(0);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    return Object.values(people)
      .filter((p) => p.id !== meId && p.name && !p.removed && !p.access?.suspended)
      .filter((p) => {
        const name = p.name.toLowerCase();
        return !q || name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
      })
      .slice(0, 6);
  }, [query, people, meId]);
  const open = !!query && (matches.length > 0 || !query.text.includes(' '));

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const m = /(?:^|\s)@([^\s@]*(?: [^\s@]*)?)$/u.exec(el.value.slice(0, caret));
    if (!m) {
      setQuery(null);
      return;
    }
    setQuery({ text: m[1], start: caret - m[1].length - 1 });
    setIndex(0);
  };

  const pick = (person: Person) => {
    const el = inner.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `@${person.name} `;
    const next = value.slice(0, query.start) + insert + value.slice(caret);
    onValueChange(next);
    onMentionsChange([...new Set([...mentions, person.id])]);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + insert.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof outerRef === 'function') outerRef(el);
          else if (outerRef) outerRef.current = el;
        }}
        rows={1}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          detect(e.target);
        }}
        onClick={(e) => detect(e.currentTarget)}
        onBlur={(e) => {
          // Let a click on a suggestion land first.
          setTimeout(() => setQuery(null), 120);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (open && matches.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pick(matches[index]);
              return;
            }
          }
          if (open && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setQuery(null);
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && onSubmit) {
            e.preventDefault();
            e.stopPropagation();
            onSubmit();
            return;
          }
          onKeyDown?.(e);
        }}
        className={cn('block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none', className)}
        {...rest}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={t('comments.mentionHint')}
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 2, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full left-0 z-40 mb-2 w-[260px] origin-bottom-left rounded-lg bg-elevated p-1 shadow-md"
          >
            <div className="px-2 pb-1 pt-1 text-[11.5px] font-medium text-fg-3">{t('comments.mentionHint')}</div>
            {matches.length === 0 && <div className="px-2 py-1.5 text-[13px] text-fg-3">{t('comments.noPeople')}</div>}
            {matches.map((p, i) => (
              <button
                key={p.id}
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(p)}
                className={cn('flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px]', i === index && 'bg-hover')}
              >
                <Avatar person={p} size={20} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.role && <span className="truncate text-[12px] text-fg-3">{p.role}</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
