import type { Comment, CommentRef, Doc, ID, Item, Project } from './types';
import { matches, normalize } from './utils';

/** Offered first in the reaction picker, like Notion. Keywords make them searchable in both languages. */
export const QUICK_REACTIONS: { e: string; k: string }[] = [
  { e: '👍', k: 'thumbs up like yes ok класс лайк да' },
  { e: '❤️', k: 'heart love сердце любовь' },
  { e: '🎉', k: 'party tada congrats праздник ура поздравляю' },
  { e: '😄', k: 'smile laugh happy улыбка смех радость' },
  { e: '👀', k: 'eyes look watching смотреть посмотрю' },
  { e: '🙏', k: 'pray thanks please спасибо пожалуйста' },
  { e: '✅', k: 'check done ok готово галочка' },
  { e: '🔥', k: 'fire hot огонь' },
  { e: '🚀', k: 'rocket launch ship ракета запуск' },
  { e: '😢', k: 'sad cry грусть слеза печаль' },
];

/** Different emoji on one comment, and links in one comment. The server enforces the same limits. */
export const REACTION_LIMIT = 50;
export const COMMENT_REF_LIMIT = 50;
const LABEL_LIMIT = 200;
const REACTION_KEY = /^(?=.*[\p{Extended_Pictographic}\p{Regional_Indicator}])[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;

/** Same rule as the server (server/access.mjs): one emoji with its modifiers, never arbitrary text. */
export const isReactionKey = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key.length <= 16 && REACTION_KEY.test(key);

/**
 * Adds or removes one person's reaction, keeping the order of emoji and of people.
 * Empty lists are dropped and an empty result is undefined. A new emoji over the limit changes nothing.
 */
export function toggleReactionIn(reactions: Comment['reactions'], emoji: string, personId: ID): Comment['reactions'] {
  const current = reactions ?? {};
  const had = Object.hasOwn(current, emoji);
  if (!had && Object.keys(current).length >= REACTION_LIMIT) return reactions;
  const list = had ? current[emoji] : [];
  const nextList = list.includes(personId) ? list.filter((id) => id !== personId) : [...list, personId];
  const entries = Object.entries(current)
    .map(([key, ids]): [string, ID[]] => [key, key === emoji ? nextList : ids])
    .concat(had ? [] : [[emoji, nextList]])
    .filter(([, ids]) => ids.length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Reactions to show, in order, without empty lists. */
export const reactionList = (reactions: Comment['reactions']): [string, ID[]][] =>
  Object.entries(reactions ?? {}).filter(([emoji, ids]) => isReactionKey(emoji) && Array.isArray(ids) && ids.length > 0);

/** Text inserted for a linked task or page: its title on one line, without "@". */
export const linkLabel = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, LABEL_LIMIT);

const BAD_IDS = ['__proto__', 'prototype', 'constructor'];
/** Same shape the server accepts: a task or page id and a one-line label of at most 200 characters. */
const validRef = (r: CommentRef | undefined): r is CommentRef =>
  !!r &&
  (r.kind === 'item' || r.kind === 'doc') &&
  typeof r.id === 'string' &&
  r.id.length > 0 &&
  r.id.length <= 200 &&
  !BAD_IDS.includes(r.id) &&
  typeof r.label === 'string' &&
  r.label.length > 0 &&
  r.label.length <= LABEL_LIMIT;

function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count++;
  return count;
}

/**
 * Keeps the links whose "@label" is still in the text, like mentionsInText does for people:
 * as many links per label as the label occurs (the latest ones), each target once, in text order.
 */
export function refsInText(text: string, refs: CommentRef[] | undefined): CommentRef[] {
  const byLabel = new Map<string, CommentRef[]>();
  for (const r of refs ?? []) {
    if (!validRef(r)) continue;
    const list = byLabel.get(r.label) ?? [];
    if (!list.some((x) => x.kind === r.kind && x.id === r.id)) list.push({ kind: r.kind, id: r.id, label: r.label });
    byLabel.set(r.label, list);
  }
  const kept: CommentRef[] = [];
  for (const [label, list] of byLabel) {
    const count = occurrences(text, `@${label}`);
    if (count) kept.push(...list.slice(Math.max(0, list.length - count)));
  }
  return kept
    .map((r, order) => ({ r, order, at: text.indexOf(`@${r.label}`) }))
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((x) => x.r)
    .slice(0, COMMENT_REF_LIMIT);
}

export interface LinkTargets {
  items: Item[];
  docs: Doc[];
}

/**
 * Tasks and pages to suggest after "@": matching titles, the current project first,
 * archived projects last, then the most recently updated. Only what is in the store,
 * which in account mode is exactly what the member may see.
 */
export function findLinkTargets(
  query: string,
  data: { items: Record<ID, Item>; docs: Record<ID, Doc>; projects: Record<ID, Project> },
  projectId?: ID,
  limit = 5,
): LinkTargets {
  const q = normalize(query);
  const rank = <T extends { title: string; projectId?: ID; updatedAt: string }>(records: T[]): T[] =>
    records
      .filter((r) => r.title.trim() && (!q || matches(r.title, q)))
      .map((r) => {
        const title = normalize(r.title);
        return {
          r,
          score: [
            r.projectId === projectId ? 0 : 1,
            r.projectId && data.projects[r.projectId]?.archived ? 1 : 0,
            !q || title.startsWith(q) || title.split(/\s+/).some((w) => w.startsWith(q)) ? 0 : 1,
          ],
        };
      })
      .sort(
        (a, b) =>
          a.score[0] - b.score[0] ||
          a.score[1] - b.score[1] ||
          a.score[2] - b.score[2] ||
          b.r.updatedAt.localeCompare(a.r.updatedAt) ||
          a.r.title.localeCompare(b.r.title),
      )
      .slice(0, limit)
      .map((x) => x.r);
  return { items: rank(Object.values(data.items)), docs: rank(Object.values(data.docs)) };
}
