import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error shared Node server
import { applyChanges, validateState } from '../server/access.mjs';
import { applyShared, diffShared, mergeFields, mergeReactions } from '../server/merge.mjs';
import { createEmptyData, useData } from '@/lib/store';
import { ALL_EMOJI } from '@/lib/emoji';
import { findLinkTargets, isReactionKey, linkLabel, refsInText, toggleReactionIn } from '@/lib/comments';
import type { Comment, CommentRef, DataState } from '@/lib/types';

const ts = '2026-09-01T00:00:00.000Z';

describe('comment reactions merge', () => {
  it('keeps reactions two teammates add at the same time', () => {
    // Both saw no reactions; Ann's reaction is already saved when Ben's arrives.
    expect(mergeReactions({ '👍': ['ann'] }, undefined, { '👍': ['ben'] })).toEqual({ '👍': ['ann', 'ben'] });
    expect(mergeReactions({ '👍': ['ann'] }, {}, { '🎉': ['ben'] })).toEqual({ '👍': ['ann'], '🎉': ['ben'] });
  });

  it('removes only what the client removed and keeps the reaction order', () => {
    const current = { '👍': ['ann', 'ben', 'cat'], '👀': ['dan'] };
    expect(mergeReactions(current, { '👍': ['ann', 'ben'] }, { '👍': ['ann'] })).toEqual({ '👍': ['ann', 'cat'], '👀': ['dan'] });
    // A reaction someone else removed meanwhile stays removed.
    expect(mergeReactions({ '👍': ['ann'] }, { '👍': ['ann', 'ben'] }, { '👍': ['ann', 'ben', 'cat'] })).toEqual({ '👍': ['ann', 'cat'] });
  });

  it('drops empty lists and the whole field when nothing is left', () => {
    expect(mergeReactions({ '👍': ['ann'] }, { '👍': ['ann'] }, undefined)).toBeUndefined();
    expect(mergeReactions({ '👍': ['ann'], '🔥': ['ben'] }, { '👍': ['ann'] }, {})).toEqual({ '🔥': ['ben'] });
    const merged = mergeFields({ id: 'c', text: 'x', reactions: { '👍': ['ann'] } }, { reactions: { '👍': ['ann'] } }, {});
    expect(merged).toEqual({ id: 'c', text: 'x' });
    expect('reactions' in merged).toBe(false);
  });

  it('merges reactions field by field while other fields keep the client value', () => {
    const current = { id: 'c', text: 'server', reactions: { '👍': ['ann'] } };
    const merged = mergeFields(current, { text: 'old', reactions: {} }, { text: 'mine', reactions: { '❤️': ['ben'] } });
    expect(merged).toEqual({ id: 'c', text: 'mine', reactions: { '👍': ['ann'], '❤️': ['ben'] } });
  });

  it('rebases an unsaved reaction on fresh data from the server', () => {
    const comment = { id: 'c1', targetKind: 'item', targetId: 't1', authorId: 'ann', text: 'Hi', createdAt: ts };
    const base = { comments: { c1: comment } };
    const local = { comments: { c1: { ...comment, reactions: { '👍': ['ben'] } } } };
    const fresh = { comments: { c1: { ...comment, reactions: { '👍': ['cat'], '🎉': ['ann'] } } } };
    const rebased = applyShared(fresh, diffShared(base, local)!);
    expect(rebased.comments.c1.reactions).toEqual({ '👍': ['cat', 'ben'], '🎉': ['ann'] });
  });
});

describe('comment helpers', () => {
  it('toggles one person reaction and drops empty lists', () => {
    const one = toggleReactionIn(undefined, '👍', 'ann');
    expect(one).toEqual({ '👍': ['ann'] });
    const two = toggleReactionIn(one, '👍', 'ben');
    expect(two).toEqual({ '👍': ['ann', 'ben'] });
    expect(toggleReactionIn(two, '🎉', 'ann')).toEqual({ '👍': ['ann', 'ben'], '🎉': ['ann'] });
    expect(toggleReactionIn(two, '👍', 'ann')).toEqual({ '👍': ['ben'] });
    expect(toggleReactionIn({ '👍': ['ann'] }, '👍', 'ann')).toBeUndefined();
  });

  it('accepts one emoji as a reaction key, never arbitrary text', () => {
    for (const ok of ['👍', '❤️', '👍🏽', '🇷🇺', '👩‍💻', '✅']) expect(isReactionKey(ok)).toBe(true);
    for (const bad of ['', 'ok', '<b>', '1', '👍x', 'a'.repeat(20), '👍'.repeat(9), null, 5]) expect(isReactionKey(bad)).toBe(false);
  });

  it('keeps links whose "@label" is still in the text, in text order', () => {
    const refs: CommentRef[] = [
      { kind: 'doc', id: 'd1', label: 'Spec' },
      { kind: 'item', id: 'i1', label: 'Fix login' },
      { kind: 'item', id: 'i2', label: 'Gone' },
    ];
    expect(refsInText('See @Fix login and @Spec', refs)).toEqual([refs[1], refs[0]]);
    expect(refsInText('Nothing here', refs)).toEqual([]);
    // The same target linked twice counts once; a label typed twice keeps both targets.
    const twice: CommentRef[] = [
      { kind: 'item', id: 'i1', label: 'Bug' },
      { kind: 'item', id: 'i1', label: 'Bug' },
      { kind: 'item', id: 'i3', label: 'Bug' },
    ];
    expect(refsInText('@Bug', twice)).toEqual([{ kind: 'item', id: 'i3', label: 'Bug' }]);
    expect(refsInText('@Bug and @Bug', twice)).toEqual([
      { kind: 'item', id: 'i1', label: 'Bug' },
      { kind: 'item', id: 'i3', label: 'Bug' },
    ]);
  });

  it('drops malformed links the server would reject', () => {
    const bad = [
      { kind: 'person', id: 'p1', label: 'Ann' },
      { kind: 'item', id: '__proto__', label: 'Proto' },
      { kind: 'doc', id: 'd1', label: 'x'.repeat(201) },
      { kind: 'doc', id: 7, label: 'Seven' },
    ] as unknown as CommentRef[];
    expect(refsInText(`@Ann @Proto @${'x'.repeat(201)} @Seven`, bad)).toEqual([]);
  });

  it('makes a one-line label from a title', () => {
    expect(linkLabel('  Launch \n plan  ')).toBe('Launch plan');
    expect(linkLabel('x'.repeat(300))).toHaveLength(200);
  });

  it('suggests matching tasks and pages, the current project first', () => {
    const data = createEmptyData('en');
    const at = (n: number) => `2026-09-0${n}T00:00:00.000Z`;
    data.projects = {
      a: { id: 'a', name: 'Alpha' },
      b: { id: 'b', name: 'Beta', archived: true },
    } as unknown as DataState['projects'];
    data.items = {
      i1: { id: 'i1', projectId: 'b', title: 'Login bug', updatedAt: at(3) },
      i2: { id: 'i2', projectId: 'a', title: 'Fix login', updatedAt: at(1) },
      i3: { id: 'i3', projectId: 'a', title: 'Signup', updatedAt: at(2) },
      i4: { id: 'i4', projectId: 'a', title: '   ', updatedAt: at(4) },
    } as unknown as DataState['items'];
    data.docs = {
      d1: { id: 'd1', title: 'Login flow', updatedAt: at(1) },
      d2: { id: 'd2', projectId: 'a', title: 'Roadmap', updatedAt: at(2) },
    } as unknown as DataState['docs'];
    const found = findLinkTargets('log', data, 'a');
    expect(found.items.map((i) => i.id)).toEqual(['i2', 'i1']);
    expect(found.docs.map((d) => d.id)).toEqual(['d1']);
    const all = findLinkTargets('', data, 'a', 2);
    expect(all.items.map((i) => i.id)).toEqual(['i3', 'i2']);
    expect(all.docs.map((d) => d.id)).toEqual(['d2', 'd1']);
  });
});

describe('comments in the store', () => {
  const s = () => useData.getState();
  let task = '';
  let doc = '';
  beforeEach(() => {
    const data = createEmptyData('en', 'Tester');
    data.onboarded = true;
    s().replaceAll(data);
    const p = s().createProject({ name: 'P' });
    task = s().createItem({ projectId: p, title: 'Fix login' });
    doc = s().createDoc({ projectId: p, title: 'Spec' });
  });

  it('saves links to tasks and pages that are still in the text', () => {
    const refs: CommentRef[] = [
      { kind: 'item', id: task, label: 'Fix login' },
      { kind: 'doc', id: doc, label: 'Spec' },
    ];
    const id = s().addComment('item', task, 'See @Fix login', [], refs);
    expect(s().comments[id].refs).toEqual([refs[0]]);
    // Older callers without links keep working and store no empty field.
    const plain = s().addComment('item', task, 'hello');
    expect('refs' in s().comments[plain]).toBe(false);
    // No notifications for links to tasks and pages.
    expect(Object.keys(s().notifications)).toHaveLength(0);
  });

  it('keeps links on edit while their label stays and takes new ones', () => {
    const link: CommentRef = { kind: 'item', id: task, label: 'Fix login' };
    const id = s().addComment('item', task, 'See @Fix login', [], [link]);
    s().updateComment(id, 'See @Fix login now');
    expect(s().comments[id].refs).toEqual([link]);
    s().updateComment(id, 'See it now');
    expect('refs' in s().comments[id]).toBe(false);
    s().updateComment(id, 'Read @Spec', { refs: [{ kind: 'doc', id: doc, label: 'Spec' }] });
    expect(s().comments[id].refs).toEqual([{ kind: 'doc', id: doc, label: 'Spec' }]);
    expect(s().comments[id].editedAt).toBeDefined();
  });

  it('toggles my reaction and drops the field when it is empty', () => {
    const id = s().addComment('doc', doc, 'Nice');
    const me = s().meId;
    s().toggleReaction(id, '🎉');
    s().toggleReaction(id, '👍');
    expect(s().comments[id].reactions).toEqual({ '🎉': [me], '👍': [me] });
    s().toggleReaction(id, '🎉');
    expect(s().comments[id].reactions).toEqual({ '👍': [me] });
    s().toggleReaction(id, '👍');
    expect('reactions' in s().comments[id]).toBe(false);
    s().toggleReaction(id, 'not an emoji');
    expect('reactions' in s().comments[id]).toBe(false);
    // Reacting does not mark the comment as edited.
    expect(s().comments[id].editedAt).toBeUndefined();
  });
});

describe('comments on the server', () => {
  const owner = { id: 'own', role: 'owner', projectIds: null };
  const ann = { id: 'ann', role: 'editor', projectIds: ['alpha'] };
  const ben = { id: 'ben', role: 'editor', projectIds: ['alpha', 'beta'], projectRoles: { beta: 'commenter' } };
  const vic = { id: 'vic', role: 'viewer', projectIds: ['alpha'] };
  const cal = { id: 'cal', role: 'viewer', projectIds: ['alpha'], projectRoles: { alpha: 'commenter' } };
  const comment = (extra: Partial<Comment> = {}): Comment => ({
    id: 'c1',
    targetKind: 'item',
    targetId: 't1',
    authorId: 'ann',
    text: 'Ready for review',
    createdAt: ts,
    ...extra,
  });
  const state = (c: Comment = comment()) => {
    const data = createEmptyData('en') as unknown as Record<string, Record<string, unknown>>;
    data.projects = {
      alpha: { id: 'alpha', name: 'Alpha', createdAt: ts, updatedAt: ts },
      beta: { id: 'beta', name: 'Beta', createdAt: ts, updatedAt: ts },
    };
    const task = { projectId: 'alpha', type: 'task', status: 'backlog', priority: 'none', tags: [], order: 1, createdAt: ts, updatedAt: ts };
    data.items = { t1: { ...task, id: 't1', title: 'One' }, t2: { ...task, id: 't2', projectId: 'beta', title: 'Two' } };
    data.comments = { [c.id]: c };
    return data;
  };
  const change = (before: Comment | null, after: Comment | null) => ({ records: { comments: { [(after ?? before)!.id]: { before, after } } } });
  const status = (fn: () => unknown) => {
    try {
      fn();
      return 200;
    } catch (e) {
      return (e as { status?: number }).status ?? 500;
    }
  };

  it('keeps reactions from two members saved at the same time', () => {
    const c = comment();
    let current: { comments: Record<string, Comment> } = state(c) as never;
    current = applyChanges(current, change(c, { ...c, reactions: { '👍': ['ben'] } }), ben);
    // Cal saves from the same stale copy without Ben's reaction.
    current = applyChanges(current, change(c, { ...c, reactions: { '👍': ['cal'], '🎉': ['cal'] } }), cal);
    expect(current.comments.c1.reactions).toEqual({ '👍': ['ben', 'cal'], '🎉': ['cal'] });
    // Ben takes his reaction back from a copy that has not seen Cal's.
    current = applyChanges(current, change({ ...c, reactions: { '👍': ['ben'] } }, c), ben);
    expect(current.comments.c1.reactions).toEqual({ '👍': ['cal'], '🎉': ['cal'] });
  });

  it('lets the author and commenters react, but viewers without comment rights cannot', () => {
    const c = comment();
    expect(status(() => applyChanges(state(c), change(c, { ...c, reactions: { '✅': ['ann'] } }), ann))).toBe(200);
    expect(status(() => applyChanges(state(c), change(c, { ...c, reactions: { '✅': ['cal'] } }), cal))).toBe(200);
    expect(status(() => applyChanges(state(c), change(c, { ...c, reactions: { '✅': ['vic'] } }), vic))).toBe(403);
    // Ben only comments in beta: a comment on a beta task is fine for him.
    const onBeta = comment({ id: 'c2', targetId: 't2', authorId: 'own' });
    expect(status(() => applyChanges(state(onBeta), change(onBeta, { ...onBeta, reactions: { '👀': ['ben'] } }), ben))).toBe(200);
  });

  it('never lets a non-author change the text, even together with a reaction', () => {
    const c = comment();
    expect(status(() => applyChanges(state(c), change(c, { ...c, text: 'Hacked' }), ben))).toBe(403);
    expect(status(() => applyChanges(state(c), change(c, { ...c, text: 'Hacked', reactions: { '👍': ['ben'] } }), ben))).toBe(403);
    expect(status(() => applyChanges(state(c), change(c, { ...c, refs: [{ kind: 'item', id: 't2', label: 'Two' }] }), cal))).toBe(403);
    expect(status(() => applyChanges(state(c), change(c, { ...c, authorId: 'ann' }), ann))).toBe(200);
    expect(status(() => applyChanges(state(c), change(c, { ...c, authorId: 'ben' }), ann))).toBe(403);
  });

  it('only reacts with your own name', () => {
    const c = comment({ reactions: { '👍': ['cal'] } });
    expect(status(() => applyChanges(state(c), change(c, { ...c, reactions: { '👍': ['cal', 'vic'] } }), ben))).toBe(403);
    expect(status(() => applyChanges(state(c), change(c, { ...c, reactions: undefined }), ben))).toBe(403);
    // Not even the author may take someone else's reaction away.
    expect(status(() => applyChanges(state(c), change(c, { ...c, reactions: undefined }), ann))).toBe(403);
    // A new comment cannot arrive with other people's reactions.
    const fresh = comment({ id: 'c3', authorId: 'ben', reactions: { '👍': ['ann'] } });
    expect(status(() => applyChanges(state(), change(null, fresh), ben))).toBe(403);
    // Administrators may tidy reactions up.
    expect(status(() => applyChanges(state(c), change(c, { ...c, reactions: undefined }), owner))).toBe(200);
  });

  it('never lets a forged comment ride along on the same-batch creation of its target', () => {
    // Ben creates task t1 himself in this very save, then tries to slip in a comment
    // "from" Ann carrying Ann's and Cal's reactions, hoping the missing-target-to-present
    // check reads it as a restore. It must be denied just like any other new comment of his.
    const data = state();
    const task = { projectId: 'alpha', type: 'task', status: 'backlog', priority: 'none', tags: [], order: 1, createdAt: ts, updatedAt: ts };
    delete (data.items as Record<string, unknown>).t1;
    const forged = comment({ authorId: 'ann', reactions: { '👍': ['ann', 'cal'] } });
    const changes = {
      records: {
        items: { t1: { before: null, after: { ...task, id: 't1', title: 'One' } } },
        comments: { c1: { before: null, after: forged } },
      },
    };
    expect(status(() => applyChanges(data, changes, ben))).toBe(403);
  });

  it('restores a comment together with its trashed task, but only as the exact content that was trashed', () => {
    const c = comment({ authorId: 'ann', reactions: { '👍': ['ann', 'cal'] } });
    const data = state(c) as unknown as { trash: unknown[] } & Record<string, Record<string, unknown>>;
    const task = data.items.t1 as Record<string, unknown>;
    delete data.items.t1;
    delete data.comments.c1;
    data.trash = [{ id: 'tr1', kind: 'item', title: 'One', snapshot: { items: { t1: task }, comments: { c1: c } }, deletedAt: ts }];
    const restore = { records: { items: { t1: { before: null, after: task } }, comments: { c1: { before: null, after: c } } } };
    // Ben did not write this comment and is not among its reactors, but restoring it verbatim is fine.
    expect(status(() => applyChanges(data, restore, ben))).toBe(200);
    // Changing so much as one reactor while "restoring" is a forgery, not a restore.
    const tampered = {
      records: {
        items: { t1: { before: null, after: task } },
        comments: { c1: { before: null, after: { ...c, reactions: { '👍': ['ann', 'cal', 'ben'] } } } },
      },
    };
    expect(status(() => applyChanges(data, tampered, ben))).toBe(403);
  });

  it('validates links and reactions', () => {
    const manyEmoji = [...new Set(ALL_EMOJI.map((e) => e.e))].filter(isReactionKey);
    expect(manyEmoji.length).toBeGreaterThan(50);
    const valid = (extra: Partial<Comment>) => status(() => validateState(state(comment(extra))));
    expect(valid({ refs: [{ kind: 'item', id: 't1', label: 'One' }], reactions: { '👍': ['ann'], '❤️': ['ben'] } })).toBe(200);
    const bad: unknown[] = [
      { refs: 'x' },
      { refs: [{ kind: 'person', id: 'p', label: 'P' }] },
      { refs: [{ kind: 'doc', id: 5, label: 'P' }] },
      { refs: [{ kind: 'doc', id: 'd', label: 'x'.repeat(201) }] },
      { refs: [{ kind: 'doc', id: 'd' }] },
      { refs: Array.from({ length: 51 }, (_, i) => ({ kind: 'doc', id: `d${i}`, label: 'P' })) },
      { reactions: [] },
      { reactions: { hello: ['ann'] } },
      { reactions: { '<img src=x>': ['ann'] } },
      { reactions: { ['👍'.repeat(9)]: ['ann'] } },
      { reactions: { '👍': 'ann' } },
      { reactions: { '👍': [5] } },
      { reactions: Object.fromEntries(manyEmoji.slice(0, 51).map((e) => [e, ['ann']])) },
    ];
    for (const extra of bad) expect(valid(extra as Partial<Comment>), JSON.stringify(extra).slice(0, 80)).toBe(400);
  });
});
