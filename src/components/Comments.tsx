import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, AtSign, MoreHorizontal, PenLine, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useData } from '@/lib/store';
import { useLang, useT } from '@/lib/i18n';
import { timeAgo } from '@/lib/dates';
import { useMe } from '@/lib/selectors';
import type { Comment, CommentTarget, ID } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar, AutoTextarea } from './ui/bits';
import { EntriesMenu } from './ui/Overlay';
import { IconButton } from './ui/Button';
import { MentionText, MentionTextarea, mentionsInText } from './Mentions';

/** Notion-style comment thread under the page properties. */
export function Comments({ targetKind, targetId }: { targetKind: CommentTarget; targetId: ID }) {
  const allComments = useData((s) => s.comments);
  const comments = useMemo(
    () =>
      Object.values(allComments)
        .filter((c) => c.targetKind === targetKind && c.targetId === targetId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [allComments, targetKind, targetId],
  );
  return (
    <div className="space-y-1">
      <AnimatePresence initial={false}>
        {comments.map((c) => (
          <CommentView key={c.id} comment={c} />
        ))}
      </AnimatePresence>
      <Composer targetKind={targetKind} targetId={targetId} />
    </div>
  );
}

function CommentView({ comment }: { comment: Comment }) {
  const t = useT();
  const lang = useLang();
  const author = useData((s) => s.people[comment.authorId]);
  const meId = useData((s) => s.meId);
  const update = useData((s) => s.updateComment);
  const remove = useData((s) => s.deleteComment);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group/comment relative flex gap-2.5 rounded-lg px-2 py-2 hover:bg-hover"
    >
      <Avatar person={author} size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-semibold">{author?.name ?? '—'}</span>
          <span className="text-[12px] text-fg-3">
            {timeAgo(comment.createdAt, lang)}
            {comment.editedAt && ` · ${t('comments.edited')}`}
          </span>
        </div>
        {editing ? (
          <div className="mt-1">
            <AutoTextarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft.trim() && draft !== comment.text) update(comment.id, draft.trim());
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setDraft(comment.text);
                  setEditing(false);
                }
              }}
              className="rounded-md bg-bg px-2 py-1 text-[14px] shadow-[0_0_0_2px_var(--accent-soft)]"
            />
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
            <MentionText text={comment.text} mentions={comment.mentions} />
          </div>
        )}
      </div>
      {comment.authorId === meId && !editing && (
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/comment:opacity-100 has-[[data-state=open]]:opacity-100">
          <EntriesMenu
            align="end"
            trigger={
              <IconButton size="sm" label={t('common.more')} className="bg-elevated shadow-sm">
                <MoreHorizontal size={14} />
              </IconButton>
            }
            entries={[
              {
                key: 'edit',
                icon: <PenLine size={15} />,
                label: t('comments.edit'),
                onSelect: () => {
                  setDraft(comment.text);
                  setEditing(true);
                },
              },
              { key: 'del', icon: <Trash2 size={15} />, label: t('comments.delete'), danger: true, onSelect: () => remove(comment.id) },
            ]}
          />
        </div>
      )}
    </motion.div>
  );
}

function Composer({ targetKind, targetId }: { targetKind: CommentTarget; targetId: ID }) {
  const t = useT();
  const me = useMe();
  const add = useData((s) => s.addComment);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<ID[]>([]);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const v = text.trim();
    if (!v) return;
    add(targetKind, targetId, v, mentionsInText(v, mentions, useData.getState().people));
    setText('');
    setMentions([]);
  };
  const insertAt = () => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const prefix = caret > 0 && !/\s/.test(text[caret - 1]) ? ' @' : '@';
    const next = text.slice(0, caret) + prefix + text.slice(caret);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret + prefix.length, caret + prefix.length);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors', focused && 'bg-hover')}>
      <Avatar person={me} size={24} className="mt-1" />
      <MentionTextarea
        ref={ref}
        value={text}
        onValueChange={setText}
        mentions={mentions}
        onMentionsChange={setMentions}
        onSubmit={send}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={t('comments.placeholder')}
        className="min-h-8 py-1.5 text-[14px] leading-relaxed placeholder:text-fg-4"
      />
      <IconButton
        size="sm"
        label={t('comments.mentionHint')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={insertAt}
        className={cn('mt-1 transition-opacity', focused || text ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100')}
      >
        <AtSign size={14} />
      </IconButton>
      <AnimatePresence>
        {text.trim() && (
          <motion.button
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={send}
            aria-label={t('comments.send')}
            className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
