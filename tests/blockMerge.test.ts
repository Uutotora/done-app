import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error shared Node server
import { createAuthApi } from '../server/auth.mjs';
import { applyShared, diffShared, mergeBlocks, mergeFields } from '../server/merge.mjs';
import { createEmptyData } from '@/lib/store';

interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: { type: 'text'; text: string; styles: Record<string, unknown> }[];
  children: Block[];
}

/** A BlockNote-like block: `p('a', 'Hello', [child])`. */
const p = (id: string, text = id, children: Block[] = [], type = 'paragraph'): Block => ({
  id,
  type,
  props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children,
});
const li = (id: string, text = id, children: Block[] = []) => p(id, text, children, 'bulletListItem');
const edit = (block: Block, text: string): Block => ({ ...block, content: [{ type: 'text', text, styles: {} }] });
const merge = (current: unknown, before: unknown, after: unknown) => mergeBlocks(current, before, after) as Block[];

/** Compact view of a merged document: "id:text" with children in brackets. */
const view = (blocks: Block[]): string[] =>
  blocks.map((b) => {
    const text = b.content.map((c) => c.text).join('');
    const own = text === b.id ? b.id : `${b.id}:${text}`;
    return b.children?.length ? `${own}[${view(b.children).join(',')}]` : own;
  });

describe('block merge', () => {
  const base = [p('a'), p('b'), p('c')];

  it('keeps concurrent edits to different paragraphs', () => {
    const theirs = [base[0], edit(base[1], 'B by Leo'), base[2]];
    const mine = [edit(base[0], 'A by Mia'), base[1], base[2]];
    expect(view(merge(theirs, base, mine))).toEqual(['a:A by Mia', 'b:B by Leo', 'c']);
  });

  it('gives the same paragraph to the client that saves last', () => {
    const theirs = [base[0], edit(base[1], 'Leo'), base[2]];
    const mine = [base[0], edit(base[1], 'Mia'), base[2]];
    expect(view(merge(theirs, base, mine))).toEqual(['a', 'b:Mia', 'c']);
  });

  it('keeps inserts made in different places', () => {
    const theirs = [base[0], p('x'), base[1], base[2]];
    const mine = [base[0], base[1], base[2], p('y')];
    expect(view(merge(theirs, base, mine))).toEqual(['a', 'x', 'b', 'c', 'y']);
    // Inserted at the very top, and several blocks in a row keep their order.
    const top = [p('y1'), p('y2'), ...base];
    expect(view(merge(theirs, base, top))).toEqual(['y1', 'y2', 'a', 'x', 'b', 'c']);
    // The anchor was deleted meanwhile: the insert goes after the nearest block that is still there.
    const withoutB = [base[0], base[2]];
    expect(view(merge(withoutB, base, [base[0], base[1], p('z'), base[2]]))).toEqual(['a', 'z', 'c']);
  });

  it('places a client insert right after its anchor, before blocks others added there', () => {
    const theirs = [base[0], p('x'), base[1], base[2]];
    expect(view(merge(theirs, base, [base[0], p('y'), base[1], base[2]]))).toEqual(['a', 'y', 'x', 'b', 'c']);
  });

  it('removes deleted blocks and resolves delete against edit', () => {
    // Deleted here, untouched elsewhere.
    expect(view(merge([base[0], edit(base[1], 'B2'), base[2]], base, [base[1], base[2]]))).toEqual(['b:B2', 'c']);
    // Deleted here while a teammate edited it: the delete is saved last and wins.
    expect(view(merge([base[0], edit(base[1], 'B2'), base[2]], base, [base[0], base[2]]))).toEqual(['a', 'c']);
    // Deleted by a teammate while edited here: the edit brings the paragraph back in its place.
    expect(view(merge([base[0], base[2]], base, [base[0], edit(base[1], 'Kept'), base[2]]))).toEqual(['a', 'b:Kept', 'c']);
    // Deleted by a teammate and untouched here: stays deleted.
    expect(view(merge([base[0], base[2]], base, [edit(base[0], 'A2'), base[1], base[2]]))).toEqual(['a:A2', 'c']);
  });

  it('merges nested lists recursively', () => {
    const list = [li('l1', 'One', [li('n1'), li('n2')]), li('l2')];
    const theirs = [li('l1', 'One', [li('n1', 'N1 by Leo'), li('n2'), li('n3')]), li('l2')];
    const mine = [li('l1', 'One!', [li('n0'), li('n1'), li('n2', 'N2 by Mia')]), li('l2')];
    expect(view(merge(theirs, list, mine))).toEqual(['l1:One![n0,n1:N1 by Leo,n2:N2 by Mia,n3]', 'l2']);
  });

  it('keeps teammates’ text when the client indents or outdents a block', () => {
    const list = [li('l1'), li('l2'), li('l3')];
    const theirs = [li('l1'), li('l2', 'L2 by Leo'), li('l3')];
    // Mia presses Tab on l2: it becomes a child of l1.
    const mine = [li('l1', 'l1', [li('l2')]), li('l3')];
    expect(view(merge(theirs, list, mine))).toEqual(['l1[l2:L2 by Leo]', 'l3']);
    // Leo outdents a child while Mia edits it.
    const nested = [li('l1', 'l1', [li('c1')])];
    expect(view(merge([li('l1'), li('c1')], nested, [li('l1', 'l1', [li('c1', 'C1 by Mia')])]))).toEqual(['l1', 'c1:C1 by Mia']);
  });

  it('keeps a deleted parent when a teammate added something inside it', () => {
    const list = [li('l1', 'l1', [li('c1')]), li('l2')];
    const theirs = [li('l1', 'l1', [li('c1'), li('c2')]), li('l2')];
    expect(view(merge(theirs, list, [li('l2')]))).toEqual(['l1[c2]', 'l2']);
  });

  it('never loses blocks when two people nest blocks into each other', () => {
    const list = [li('x'), li('y')];
    const theirs = [li('y', 'y', [li('x')])];
    const mine = [li('x', 'x', [li('y')])];
    const merged = merge(theirs, list, mine);
    expect(view(merged)).toEqual(['x[y]']);
  });

  it('applies the client’s reordering and keeps others’ new blocks after their neighbours', () => {
    const theirs = [base[0], base[1], p('x'), base[2]];
    const mine = [base[2], base[0], base[1]];
    expect(view(merge(theirs, base, mine))).toEqual(['c', 'a', 'b', 'x']);
    // Others reordered, the client only edited: the current order stays.
    const reordered = [base[2], base[1], base[0]];
    expect(view(merge(reordered, base, [base[0], edit(base[1], 'B2'), base[2]]))).toEqual(['c', 'b:B2', 'a']);
  });

  it('falls back to the client’s version for anything that is not a list of blocks with ids', () => {
    const plain = [{ type: 'paragraph', content: 'no id' }];
    expect(merge(base, base, plain)).toBe(plain);
    expect(merge(plain, plain, base)).toBe(base);
    expect(merge([p('a'), p('a')], base, base.slice(1))).toEqual(base.slice(1));
    expect(mergeBlocks(base, base, 'text')).toBe('text');
    expect(mergeBlocks(base, base, undefined)).toBeUndefined();
    expect(mergeBlocks(base, base, null)).toBeNull();
    const nested = [{ ...p('a'), children: 'bad' }];
    expect(merge(base, base, nested)).toBe(nested);
  });

  it('handles missing and empty content', () => {
    expect(view(merge(undefined, undefined, [p('a')]))).toEqual(['a']);
    // Two people start writing on an empty page at once: both paragraphs stay.
    expect(view(merge([p('x')], null, [p('y')]))).toEqual(['y', 'x']);
    expect(view(merge([p('x')], [], [p('y')]))).toEqual(['y', 'x']);
    expect(merge([], base, [])).toEqual([]);
    expect(view(merge([...base, p('x')], base, []))).toEqual(['x']);
    expect(merge(undefined, base, base)).toEqual([]);
  });

  it('is idempotent and returns the client’s document when nobody else edited', () => {
    const theirs = [edit(base[0], 'A2'), p('x'), base[2]];
    const mine = [base[0], edit(base[1], 'B2'), p('y'), base[2]];
    const once = merge(theirs, base, mine);
    expect(merge(once, base, mine)).toEqual(once);
    expect(merge(base, base, mine)).toEqual(mine);
  });

  it('is used for document content, descriptions and briefs by the record merge', () => {
    const doc = { id: 'd', title: 'Spec', content: base };
    const theirs = { ...doc, title: 'Spec v2', content: [base[0], edit(base[1], 'B2'), base[2]] };
    const mine = { ...doc, content: [edit(base[0], 'A2'), base[1], base[2]] };
    const merged = mergeFields(theirs, doc, mine) as typeof doc;
    expect(merged.title).toBe('Spec v2');
    expect(view(merged.content as Block[])).toEqual(['a:A2', 'b:B2', 'c']);
    const project = { id: 'p', brief: base };
    const briefed = mergeFields({ ...project, brief: [...base, p('x')] }, project, { ...project, brief: [p('y'), ...base] }) as typeof project;
    expect(view(briefed.brief as Block[])).toEqual(['y', 'a', 'b', 'c', 'x']);
    // Rebasing unsaved edits on fresh data (what the browser does) merges the same way.
    const before = { docs: { d: doc } };
    const changes = diffShared(before, { docs: { d: mine } })!;
    const rebased = applyShared({ docs: { d: theirs } }, changes) as unknown as { docs: { d: typeof doc } };
    expect(view(rebased.docs.d.content as Block[])).toEqual(['a:A2', 'b:B2', 'c']);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Randomised properties with a fixed seed: the merge never duplicates or drops what it must keep.
 * ---------------------------------------------------------------------------------------------- */

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

type Rand = ReturnType<typeof rng>;
let counter = 0;

function randomDoc(rand: Rand, depth = 0): Block[] {
  const n = Math.floor(rand() * (depth ? 3 : 6));
  return Array.from({ length: n }, () => li(`b${++counter}`, `t${counter}`, depth < 2 && rand() < 0.3 ? randomDoc(rand, depth + 1) : []));
}

/** Random edits: change text, delete, insert, move within a list and move to another parent. */
function mutate(doc: Block[], rand: Rand, who: string): Block[] {
  const copy = structuredClone(doc) as Block[];
  const lists: Block[][] = [];
  const collect = (list: Block[]) => {
    lists.push(list);
    list.forEach((b) => collect(b.children));
  };
  collect(copy);
  for (let step = 0; step < 4; step++) {
    const list = lists[Math.floor(rand() * lists.length)];
    const i = Math.floor(rand() * list.length);
    const r = rand();
    if (r < 0.35 && list.length) list[i] = edit(list[i], `${who}${step}`);
    else if (r < 0.5 && list.length) list.splice(i, 1);
    else if (r < 0.75) list.splice(i, 0, li(`${who}${++counter}`));
    else if (r < 0.9 && list.length > 1) list.splice(Math.floor(rand() * list.length), 0, ...list.splice(i, 1));
    else if (list.length) {
      const [moved] = list.splice(i, 1);
      const target = lists[Math.floor(rand() * lists.length)];
      if (target === moved.children || JSON.stringify(moved).includes(JSON.stringify(target))) list.splice(i, 0, moved);
      else target.push(moved);
    }
  }
  return copy;
}

const flatten = (blocks: Block[], out = new Map<string, Block>()) => {
  for (const b of blocks) {
    out.set(b.id, b);
    flatten(b.children ?? [], out);
  }
  return out;
};
const count = (blocks: Block[]): number => blocks.reduce((n, b) => n + 1 + count(b.children ?? []), 0);
const own = (b: Block) => JSON.stringify({ ...b, children: undefined });

describe('block merge properties', () => {
  it('holds for random concurrent edits', () => {
    const rand = rng(20260927);
    for (let round = 0; round < 400; round++) {
      const before = randomDoc(rand);
      const current = mutate(before, rand, 'leo');
      const after = mutate(before, rand, 'mia');
      const merged = merge(current, before, after);
      const ids = flatten(merged);
      // A valid tree: every id once.
      expect(count(merged)).toBe(ids.size);
      // Deterministic and idempotent.
      expect(merge(current, before, after)).toEqual(merged);
      expect(merge(merged, before, after)).toEqual(merged);
      // Nobody else edited: exactly the client's document. The client changed nothing: exactly the current one.
      expect(merge(before, before, after)).toEqual(after);
      expect(merge(current, before, before)).toEqual(current);
      const B = flatten(before);
      const A = flatten(after);
      const C = flatten(current);
      for (const [id, block] of A) {
        // Whatever the client added or edited is kept with its text.
        if (!B.has(id) || own(B.get(id)!) !== own(block)) expect(own(ids.get(id)!)).toBe(own(block));
      }
      for (const [id, block] of C) {
        // What others added survives unless the client deleted it; untouched blocks keep others' text.
        if (!B.has(id)) expect(ids.has(id)).toBe(true);
        else if (A.has(id) && own(A.get(id)!) === own(B.get(id)!)) expect(own(ids.get(id)!)).toBe(own(block));
      }
      for (const id of B.keys()) if (!A.has(id) && !C.has(id)) expect(ids.has(id)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------------------------------------
 * The server merges concurrent saves of one page block by block.
 * ---------------------------------------------------------------------------------------------- */

describe('page edits on the server', () => {
  let server: Server;
  let url = '';
  let api: ReturnType<typeof createAuthApi>;
  const cookies: Record<string, string> = {};
  const ts = '2026-09-01T00:00:00.000Z';
  const call = (path: string, method = 'GET', data?: unknown, who = 'owner') =>
    fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-done-client': 'web', cookie: cookies[who] ?? '' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });

  beforeAll(async () => {
    api = createAuthApi({ filename: ':memory:' });
    server = createServer(api.handler);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const data = createEmptyData('en');
    data.projects = {
      alpha: { id: 'alpha', name: 'alpha', icon: '📁', color: 'blue', status: 'on_track', order: 1, createdAt: ts, updatedAt: ts },
    } as unknown as typeof data.projects;
    data.docs = {
      spec: { id: 'spec', projectId: 'alpha', title: 'Spec', order: 1, content: [p('a'), p('b'), p('c')], createdAt: ts, updatedAt: ts },
    } as unknown as typeof data.docs;
    const response = await call(
      '/api/auth/register',
      'POST',
      { name: 'Owner', email: 'owner@example.com', password: 'a-long-owner-password', data },
      '',
    );
    cookies.owner = response.headers.get('set-cookie')!.split(';')[0];
    const invite = await (await call('/api/admin/invites', 'POST', { email: 'mia@example.com', role: 'member', projectIds: ['alpha'] })).json();
    const joined = await call(
      '/api/auth/register',
      'POST',
      { name: 'Mia', email: 'mia@example.com', password: 'a-long-mia-password', invite: invite.token },
      '',
    );
    cookies.mia = joined.headers.get('set-cookie')!.split(';')[0];
  });

  afterAll(async () => {
    api.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('keeps both people’s paragraphs when they save the same page at once', async () => {
    const doc = (await (await call('/api/workspace', 'GET', undefined, 'mia')).json()).data.docs.spec;
    const save = (who: string, content: Block[]) =>
      call('/api/workspace', 'PATCH', { changes: { records: { docs: { spec: { before: doc, after: { ...doc, content } } } } } }, who);
    const [a, b, c] = doc.content as Block[];
    expect((await save('owner', [edit(a, 'Owner wrote this'), b, c])).status).toBe(200);
    expect((await save('mia', [a, b, edit(c, 'Mia wrote this'), p('m')])).status).toBe(200);
    const merged = (await (await call('/api/workspace')).json()).data.docs.spec.content;
    expect(view(merged)).toEqual(['a:Owner wrote this', 'b', 'c:Mia wrote this', 'm']);
  });
});
