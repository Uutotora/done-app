import { AnimatePresence, motion } from 'motion/react';
import { Archive, ArchiveRestore, CheckCheck, Circle, CircleCheck, Inbox as InboxIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { isToday, isYesterday, parseISO } from 'date-fns';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { timeAgo } from '@/lib/dates';
import { notificationHeadline, notificationTarget, useMyNotifications } from '@/lib/inbox';
import { cn } from '@/lib/utils';
import type { AppNotification } from '@/lib/types';
import { Topbar } from '@/components/Topbar';
import { Button, IconButton } from '@/components/ui/Button';
import { Avatar, PageIcon } from '@/components/ui/bits';
import { Tooltip } from '@/components/ui/Overlay';
import { TypeIcon } from '@/components/pickers/icons';
import { MentionText } from '@/components/Mentions';

type Tab = 'unread' | 'all' | 'archived';

export function InboxView() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = (['unread', 'all', 'archived'].includes(params.get('tab') ?? '') ? params.get('tab') : 'unread') as Tab;
  const mine = useMyNotifications();
  const mark = useData((s) => s.markNotifications);
  const archive = useData((s) => s.archiveNotifications);
  const [focus, setFocus] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keyboard shortcuts work right away, without clicking into the list first.
  useEffect(() => scrollRef.current?.focus({ preventScroll: true }), []);

  // Rows read in this visit stay in the unread tab until you leave, so the list does not jump.
  const [keep, setKeep] = useState<Set<string>>(() => new Set());
  const counts = {
    unread: mine.filter((n) => !n.readAt && !n.archivedAt).length,
    all: mine.filter((n) => !n.archivedAt).length,
    archived: mine.filter((n) => n.archivedAt).length,
  };
  const list = mine.filter((n) => (tab === 'archived' ? n.archivedAt : !n.archivedAt && (tab === 'all' || !n.readAt || keep.has(n.id))));
  const groups = useMemo(() => {
    const out: { key: 'today' | 'yesterday' | 'earlier'; items: AppNotification[] }[] = [];
    for (const n of list) {
      const d = parseISO(n.createdAt);
      const key = isToday(d) ? 'today' : isYesterday(d) ? 'yesterday' : 'earlier';
      const last = out.at(-1);
      if (last?.key === key) last.items.push(n);
      else out.push({ key, items: [n] });
    }
    return out;
  }, [list]);

  useEffect(() => setFocus((f) => Math.min(f, Math.max(0, list.length - 1))), [list.length]);

  const setTab = (next: Tab) => {
    setKeep(new Set());
    setFocus(0);
    setParams(next === 'unread' ? {} : { tab: next }, { replace: true });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // Leave ⌘K, ⌘\ and other global shortcuts alone.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const n = list[focus];
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setFocus((f) => Math.min(list.length - 1, f + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setFocus((f) => Math.max(0, f - 1));
    } else if (n && e.key.toLowerCase() === 'e') {
      archive([n.id], !n.archivedAt);
    } else if (n && e.key.toLowerCase() === 'u') {
      setKeep((k) => new Set(k).add(n.id));
      mark([n.id], !n.readAt);
    }
  };
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar crumbs={[{ label: t('inbox.title'), icon: 'icon:inbox:gray' }]} />
      <div ref={scrollRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none" onKeyDown={onKey}>
        <div className="mx-auto w-full max-w-[820px] px-4 pb-24 pt-7 sm:px-10">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-[30px] font-bold tracking-tight">{t('inbox.title')}</h1>
              <p className="mt-1 text-[14px] text-fg-3">{t('inbox.subtitle')}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<CheckCheck size={15} />}
              disabled={!counts.unread}
              onClick={() => {
                setKeep(new Set(list.map((n) => n.id)));
                mark(
                  mine.filter((n) => !n.readAt).map((n) => n.id),
                  true,
                );
                toast({ message: t('inbox.allRead'), tone: 'success' });
              }}
            >
              {t('inbox.markAllRead')}
            </Button>
          </div>
          <div role="tablist" className="mt-5 flex gap-4 border-b border-line">
            {(['unread', 'all', 'archived'] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'relative flex items-center gap-1.5 py-2.5 text-[13px]',
                  tab === key ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg',
                )}
              >
                {t(`inbox.${key}`)}
                {counts[key] > 0 && <span className="text-[11px] tabular-nums text-fg-4">{counts[key]}</span>}
                {tab === key && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-fg" />}
              </button>
            ))}
            <span className="ml-auto hidden self-center text-[11.5px] text-fg-4 md:block">{t('inbox.shortcuts')}</span>
          </div>

          {list.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center py-20 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-hover text-fg-3">
                <InboxIcon size={26} strokeWidth={1.6} />
              </div>
              <h2 className="text-[15px] font-semibold">
                {tab === 'unread' ? t('inbox.emptyUnread') : tab === 'archived' ? t('inbox.emptyArchived') : t('inbox.emptyAll')}
              </h2>
              {tab === 'unread' && <p className="mt-1 max-w-sm text-[13px] text-fg-3">{t('inbox.emptyUnreadHint')}</p>}
            </motion.div>
          ) : (
            <div ref={listRef} className="pt-2">
              {groups.map((g) => (
                <section key={g.key} className="mt-4">
                  <h2 className="mb-1 px-3 text-[12px] font-medium text-fg-3">{t(`inbox.${g.key}`)}</h2>
                  <AnimatePresence initial={false}>
                    {g.items.map((n) => {
                      const index = list.indexOf(n);
                      return (
                        <InboxRow
                          key={n.id}
                          n={n}
                          index={index}
                          focused={index === focus}
                          onFocus={() => setFocus(index)}
                          onToggleRead={() => {
                            setKeep((k) => new Set(k).add(n.id));
                            mark([n.id], !n.readAt);
                          }}
                          onOpened={() => setKeep((k) => new Set(k).add(n.id))}
                        />
                      );
                    })}
                  </AnimatePresence>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxRow({
  n,
  index,
  focused,
  onFocus,
  onToggleRead,
  onOpened,
}: {
  n: AppNotification;
  index: number;
  focused: boolean;
  onFocus: () => void;
  onToggleRead: () => void;
  onOpened: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const actor = useData((s) => s.people[n.actorId]);
  const project = useData((s) => (n.projectId ? s.projects[n.projectId] : undefined));
  const entity = useData((s) => (n.targetKind === 'item' ? s.items : n.targetKind === 'doc' ? s.docs : s.projects)[n.targetId]);
  const target = useMemo(() => notificationTarget(n, useData.getState(), lang), [n, entity, lang]);
  const mark = useData((s) => s.markNotifications);
  const archive = useData((s) => s.archiveNotifications);
  const openPeek = useUI((s) => s.openPeek);
  const unread = !n.readAt && !n.archivedAt;

  const open = () => {
    onOpened();
    mark([n.id], true);
    if (!target.exists) return;
    if (target.peekItemId) openPeek(target.peekItemId);
    else navigate(target.path);
  };

  return (
    <motion.div
      data-index={index}
      data-peek-keep
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.1 }}
      onMouseEnter={onFocus}
      className={cn('group/inbox relative flex cursor-pointer gap-3 rounded-lg px-3 py-3', focused ? 'bg-hover' : 'hover:bg-hover')}
      onClick={open}
    >
      <span aria-hidden className={cn('absolute left-0 top-[22px] h-1.5 w-1.5 rounded-full bg-accent', unread ? 'opacity-100' : 'opacity-0')} />
      <Avatar person={actor} size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[14px] leading-snug">
          <span className={cn('font-semibold', !unread && 'font-medium text-fg-2')}>{actor?.name ?? '—'}</span>
          <span className={cn(unread ? 'text-fg-2' : 'text-fg-3')}>{notificationHeadline(n, lang)}</span>
          <span className="text-[12px] text-fg-4">{timeAgo(n.createdAt, lang)}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13.5px]">
          {target.itemType ? <TypeIcon type={target.itemType} size={14} /> : target.icon ? <PageIcon icon={target.icon} size={15} /> : null}
          <span
            className={cn('truncate', target.exists ? 'text-fg underline decoration-line-strong underline-offset-[3px]' : 'text-fg-3 line-through')}
          >
            {target.title}
          </span>
          {project && n.targetKind !== 'project' && (
            <span className="flex min-w-0 shrink items-center gap-1 truncate text-[12px] text-fg-3">
              <span className="text-fg-4">·</span>
              <PageIcon icon={project.icon} size={12} />
              <span className="truncate">{project.name}</span>
            </span>
          )}
        </div>
        {n.text && (n.kind === 'mention' || n.kind === 'comment') && (
          <div className="mt-2 line-clamp-3 whitespace-pre-wrap border-l-2 border-line-strong pl-3 text-[13.5px] leading-relaxed text-fg-2">
            <MentionText text={n.text} />
          </div>
        )}
      </div>
      <div
        className="absolute right-2 top-2 flex items-center gap-0.5 rounded-md bg-elevated opacity-0 shadow-sm group-hover/inbox:opacity-100 group-focus-within/inbox:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        {!n.archivedAt && (
          <Tooltip content={unread ? t('inbox.markRead') : t('inbox.markUnread')} shortcut="U">
            <IconButton size="md" label={unread ? t('inbox.markRead') : t('inbox.markUnread')} onClick={onToggleRead}>
              {unread ? <CircleCheck size={15} /> : <Circle size={15} />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content={n.archivedAt ? t('inbox.unarchive') : t('inbox.archive')} shortcut="E">
          <IconButton size="md" label={n.archivedAt ? t('inbox.unarchive') : t('inbox.archive')} onClick={() => archive([n.id], !n.archivedAt)}>
            {n.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </IconButton>
        </Tooltip>
      </div>
    </motion.div>
  );
}
