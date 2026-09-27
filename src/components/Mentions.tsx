import * as RPopover from '@radix-ui/react-popover';
import { FileText } from 'lucide-react';
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { useData } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { useUI } from '@/lib/ui';
import { findLinkTargets, linkLabel } from '@/lib/comments';
import { cn } from '@/lib/utils';
import type { CommentRef, Doc, ID, Item, Person } from '@/lib/types';
import { Avatar, PageIcon } from './ui/bits';
import { Tooltip } from './ui/Overlay';
import { TypeIcon } from './pickers/icons';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keeps only people whose "@Name" is still present in the text. */
export function mentionsInText(text: string, ids: ID[], people: Record<ID, Person>): ID[] {
  return [...new Set(ids)].filter((id) => people[id] && text.includes(`@${people[id].name}`));
}

/**
 * Renders text with @mentions highlighted; a mention of the current member stands out.
 * Linked tasks and pages (`refs`) become chips with their current title, like Notion page mentions.
 */
export function MentionText({ text, mentions, refs }: { text: string; mentions?: ID[]; refs?: CommentRef[] }) {
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const parts = useMemo(() => {
    const links = new Map<string, CommentRef[]>();
    for (const r of refs ?? []) if (r?.label) links.set(`@${r.label}`, [...(links.get(`@${r.label}`) ?? []), r]);
    const byName = new Map<string, Person>();
    for (const p of (mentions ?? Object.keys(people)).map((id) => people[id])) if (p?.name && !links.has(`@${p.name}`)) byName.set(`@${p.name}`, p);
    const needles = [...links.keys(), ...byName.keys()].sort((a, b) => b.length - a.length);
    if (!needles.length) return [text];
    const re = new RegExp(needles.map(escapeRe).join('|'), 'g');
    // Several links can share a label: occurrences take them in order.
    const used = new Map<string, number>();
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const shared = links.get(m[0]);
      if (shared) {
        const n = used.get(m[0]) ?? 0;
        used.set(m[0], n + 1);
        out.push(<RefChip key={m.index} link={shared[Math.min(n, shared.length - 1)]} />);
      } else {
        const person = byName.get(m[0])!;
        out.push(
          <span
            key={m.index}
            className={cn(
              'rounded-[4px] px-[2px] font-medium',
              person.id === meId ? 'bg-[var(--c-yellow-bg)] text-[var(--c-yellow-text)]' : 'text-accent',
            )}
          >
            @{person.name}
          </span>,
        );
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, mentions, refs, people, meId]);
  return <>{parts}</>;
}

/** A linked task or page: its icon and current title. Tasks open in the side peek, pages navigate. */
function RefChip({ link }: { link: CommentRef }) {
  const t = useT();
  const item = useData((s) => (link.kind === 'item' && Object.hasOwn(s.items, link.id) ? s.items[link.id] : undefined));
  const doc = useData((s) => (link.kind === 'doc' && Object.hasOwn(s.docs, link.id) ? s.docs[link.id] : undefined));
  const target = item ?? doc;
  if (!target)
    return (
      <Tooltip content={t('comments.noAccess')}>
        <span tabIndex={0} className="rounded-[4px] px-[2px] text-fg-3 outline-none focus-visible:bg-hover">
          @{link.label}
        </span>
      </Tooltip>
    );
  const title = target.title.trim() || t('common.untitled');
  return (
    <Link
      to={item ? `/items/${item.id}` : `/docs/${doc!.id}`}
      onClick={(e) => {
        e.stopPropagation();
        if (item) {
          // A plain click opens the side peek; Cmd/Ctrl-click still opens the page in a new tab.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          useUI.getState().openPeek(item.id);
        } else useUI.getState().openPeek(undefined);
      }}
      className="rounded-[4px] px-[2px] font-medium text-fg transition-colors hover:bg-hover"
    >
      <span className="mr-[3px] inline-flex align-[-2px]">
        {item ? (
          <TypeIcon type={item.type} size={14} />
        ) : doc!.icon ? (
          <PageIcon icon={doc!.icon} size={14} />
        ) : (
          <FileText size={14} className="text-fg-3" />
        )}
      </span>
      <span className="underline decoration-[var(--border-strong)] decoration-1 underline-offset-[3px]">{title}</span>
    </Link>
  );
}

type Suggestion =
  { key: string; kind: 'person'; person: Person } | { key: string; kind: 'item'; item: Item } | { key: string; kind: 'doc'; doc: Doc };

interface MentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  mentions: ID[];
  onMentionsChange: (ids: ID[]) => void;
  /** With `onRefsChange`, "@" also suggests tasks and pages and records them as links. */
  refs?: CommentRef[];
  onRefsChange?: (refs: CommentRef[]) => void;
  /** Tasks and pages of this project come first. */
  projectId?: ID;
  /** Enter without Shift, when the mention list is closed. */
  onSubmit?: () => void;
}

/** Auto-growing textarea that suggests teammates, tasks and pages after "@", like Notion comments. */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea(
  { value, onValueChange, mentions, onMentionsChange, refs, onRefsChange, projectId, onSubmit, className, onKeyDown, onBlur, ...rest },
  outerRef,
) {
  const t = useT();
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const items = useData((s) => s.items);
  const docs = useData((s) => s.docs);
  const projects = useData((s) => s.projects);
  const withLinks = !!onRefsChange;
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [index, setIndex] = useState(0);

  // Where the caret goes after a suggestion is inserted: set before the next keystroke can land.
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
    if (caretAfter.current !== null) {
      el.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
  }, [value]);

  const options = useMemo<Suggestion[]>(() => {
    if (!query) return [];
    const q = query.text.toLowerCase();
    const found: Suggestion[] = Object.values(people)
      .filter((p) => p.id !== meId && p.name && !p.removed && !p.access?.suspended)
      .filter((p) => {
        const name = p.name.toLowerCase();
        return !q || name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
      })
      .slice(0, withLinks ? 5 : 6)
      .map((person) => ({ key: `p:${person.id}`, kind: 'person', person }));
    if (!withLinks) return found;
    const targets = findLinkTargets(query.text, { items, docs, projects }, projectId, q ? 5 : 3);
    return [
      ...found,
      ...targets.items.map((item): Suggestion => ({ key: `i:${item.id}`, kind: 'item', item })),
      ...targets.docs.map((doc): Suggestion => ({ key: `d:${doc.id}`, kind: 'doc', doc })),
    ];
  }, [query, people, meId, withLinks, items, docs, projects, projectId]);
  const open = !!query && (options.length > 0 || !query.text.includes(' '));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

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

  const pick = (option: Suggestion) => {
    const el = inner.current;
    if (!el || !query) return;
    const caret = el.selectionStart ?? value.length;
    const label = option.kind === 'person' ? option.person.name : linkLabel((option.kind === 'item' ? option.item : option.doc).title);
    const insert = `@${label} `;
    const next = value.slice(0, query.start) + insert + value.slice(caret);
    caretAfter.current = query.start + insert.length;
    onValueChange(next);
    if (option.kind === 'person') onMentionsChange([...new Set([...mentions, option.person.id])]);
    else onRefsChange?.([...(refs ?? []), { kind: option.kind, id: option.kind === 'item' ? option.item.id : option.doc.id, label }]);
    setQuery(null);
    if (document.activeElement !== el) el.focus();
  };

  const heading = (kind: Suggestion['kind']) =>
    !withLinks ? null : kind === 'person' ? t('comments.people') : kind === 'item' ? t('comments.tasks') : t('comments.pages');

  return (
    <RPopover.Root open={open} onOpenChange={(o) => !o && setQuery(null)}>
      <RPopover.Anchor asChild>
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={(el) => {
              inner.current = el;
              if (typeof outerRef === 'function') outerRef(el);
              else if (outerRef) outerRef.current = el;
            }}
            rows={1}
            value={value}
            aria-autocomplete="list"
            aria-expanded={open}
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
              if (open && options.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                  return;
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  pick(options[Math.min(index, options.length - 1)]);
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
        </div>
      </RPopover.Anchor>
      <RPopover.Portal>
        <RPopover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          // Typing continues in the textarea while the list is open.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (inner.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className="anim-pop z-50 rounded-lg bg-elevated p-1 shadow-md outline-none"
        >
          <div
            ref={list}
            // Clicks inside the list keep focus in the textarea.
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
            aria-label={withLinks ? t('comments.linkHint') : t('comments.mentionHint')}
            className={cn('max-h-[min(340px,var(--radix-popover-content-available-height))] overflow-y-auto', withLinks ? 'w-[300px]' : 'w-[260px]')}
            style={{ maxWidth: 'calc(100vw - 24px)' }}
          >
            {!withLinks && <div className="px-2 pb-1 pt-1 text-[11.5px] font-medium text-fg-3">{t('comments.mentionHint')}</div>}
            {options.length === 0 && (
              <div className="px-2 py-1.5 text-[13px] text-fg-3">{withLinks ? t('comments.noMatches') : t('comments.noPeople')}</div>
            )}
            {options.map((o, i) => (
              <div key={o.key}>
                {heading(o.kind) && o.kind !== options[i - 1]?.kind && (
                  <div className={cn('px-2 pb-1 text-[11.5px] font-medium text-fg-3', i === 0 ? 'pt-1' : 'pt-2')}>{heading(o.kind)}</div>
                )}
                <button
                  type="button"
                  role="option"
                  data-index={i}
                  aria-selected={i === index}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(o)}
                  className={cn('flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[14px]', i === index && 'bg-hover')}
                >
                  {o.kind === 'person' ? (
                    <>
                      <Avatar person={o.person} size={20} />
                      <span className="min-w-0 flex-1 truncate">{o.person.name}</span>
                      {o.person.role && <span className="max-w-[45%] truncate text-[12px] text-fg-3">{o.person.role}</span>}
                    </>
                  ) : (
                    <>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {o.kind === 'item' ? (
                          <TypeIcon type={o.item.type} size={15} />
                        ) : o.doc.icon ? (
                          <PageIcon icon={o.doc.icon} size={16} />
                        ) : (
                          <FileText size={15} className="text-fg-3" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{(o.kind === 'item' ? o.item : o.doc).title}</span>
                      {(() => {
                        const pid = o.kind === 'item' ? o.item.projectId : o.doc.projectId;
                        const name = pid ? projects[pid]?.name : undefined;
                        return name ? <span className="max-w-[40%] truncate text-[12px] text-fg-3">{name}</span> : null;
                      })()}
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
});
