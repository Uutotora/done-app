import { describe, expect, it } from 'vitest';
import { DocSync, canonical, planPatch, type BlockJson, type PatchOp } from '@/lib/editorSync';

/** Stored blocks may be partial (templates, other clients); the editor shows them normalized. */
const stored = (id: string, text = id, children: BlockJson[] = []): BlockJson => ({ id, type: 'paragraph', content: text, children });
const normalize = (block: BlockJson): BlockJson => ({
  id: block.id,
  type: block.type ?? 'paragraph',
  props: { textColor: 'default', ...(block.props as object) },
  content: typeof block.content === 'string' ? [{ type: 'text', text: block.content, styles: {} }] : (block.content ?? []),
  children: (block.children ?? []).map(normalize),
});
const shown = (blocks: BlockJson[]) => blocks.map(normalize);
const typed = (block: BlockJson, text: string): BlockJson => ({ ...block, content: [{ type: 'text', text, styles: {} }] });
const textOf = (block: BlockJson) =>
  typeof block.content === 'string' ? block.content : (block.content as { text: string }[]).map((c) => c.text).join('');
const view = (blocks: BlockJson[]): string[] => blocks.map((b) => (b.children?.length ? `${textOf(b)}[${view(b.children).join(',')}]` : textOf(b)));

/** Applies patch operations the way the editor does, normalizing inserted blocks. */
function apply(doc: BlockJson[], ops: PatchOp[]): BlockJson[] {
  let out = structuredClone(doc);
  const find = (id: string, list = out): [BlockJson[], number] | null => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return [list, i];
      const inner = find(id, list[i].children ?? []);
      if (inner) return inner;
    }
    return null;
  };
  for (const op of ops) {
    if (op.kind === 'reset') out = shown(op.blocks);
    else if (op.kind === 'update') {
      const [list, i] = find(op.id)!;
      list[i] = { ...normalize({ ...op.block, id: op.id }), children: list[i].children };
    } else if (op.kind === 'insert') {
      const [list, i] = find(op.ref)!;
      list.splice(op.placement === 'after' ? i + 1 : i, 0, ...shown(op.blocks));
    } else if (op.kind === 'children') {
      const [list, i] = find(op.id)!;
      list[i].children = shown(op.blocks);
    } else if (op.kind === 'remove') {
      for (const id of op.ids) {
        const [list, i] = find(id)!;
        list.splice(i, 1);
      }
    } else {
      const [list, i] = find(op.ids[0])!;
      list.splice(i, op.ids.length, ...shown(op.blocks));
    }
  }
  return out;
}

describe('editor sync', () => {
  const value = [stored('a', 'Alpha'), stored('b', 'Beta'), stored('c', 'Gamma')];

  it('saves nothing until something is typed and sends untouched blocks as stored', () => {
    const editor = shown(value);
    const sync = new DocSync(value, editor);
    expect(sync.emit(editor)).toBeNull();
    const edited = [editor[0], typed(editor[1], 'Beta!'), editor[2]];
    const saved = sync.emit(edited)!;
    expect(saved[0]).toEqual(value[0]);
    expect(saved[1]).toEqual(edited[1]);
    expect(saved[2]).toEqual(value[2]);
    // The store echoes the save back: nothing to patch, nothing more to save.
    expect(sync.receive(structuredClone(saved), edited)).toBeNull();
    expect(sync.emit(edited)).toBeNull();
  });

  it('patches a teammate’s edit into the open editor block by block', () => {
    const editor = shown(value);
    const sync = new DocSync(value, editor);
    const remote = [value[0], stored('b', 'Beta by Leo'), value[2], stored('d', 'Delta')];
    const incoming = sync.receive(remote, editor)!;
    expect(incoming.pristine).toBe(true);
    const ops = planPatch(incoming.local, incoming.target);
    expect(ops).toEqual([
      { kind: 'insert', ref: 'c', placement: 'after', blocks: [remote[3]] },
      { kind: 'update', id: 'b', block: { type: 'paragraph', content: 'Beta by Leo' } },
    ]);
    const next = apply(editor, ops);
    sync.applied(remote, incoming, next);
    expect(view(next)).toEqual(['Alpha', 'Beta by Leo', 'Gamma', 'Delta']);
    // The patch itself is not saved back.
    expect(sync.emit(next)).toBeNull();
  });

  it('keeps unsaved local typing and saves it on top of the teammate’s edit', () => {
    const editor = shown(value);
    const sync = new DocSync(value, editor);
    const mine = [typed(editor[0], 'Alpha by Mia'), editor[1], editor[2]];
    const remote = [value[0], stored('b', 'Beta by Leo'), value[2]];
    const incoming = sync.receive(remote, mine)!;
    expect(incoming.pristine).toBe(false);
    const next = apply(mine, planPatch(incoming.local, incoming.target));
    sync.applied(remote, incoming, next);
    expect(view(next)).toEqual(['Alpha by Mia', 'Beta by Leo', 'Gamma']);
    const saved = sync.emit(next)!;
    expect(saved[0]).toEqual(mine[0]);
    expect(saved[1]).toEqual(remote[1]);
    expect(saved[2]).toEqual(value[2]);
  });

  it('skips a block with unsaved local edits when a teammate changed it too', () => {
    const editor = shown(value);
    const sync = new DocSync(value, editor);
    const mine = [editor[0], typed(editor[1], 'Beta by Mia'), editor[2]];
    const remote = [value[0], stored('b', 'Beta by Leo'), stored('c', 'Gamma by Leo')];
    const incoming = sync.receive(remote, mine)!;
    const ops = planPatch(incoming.local, incoming.target);
    expect(ops).toEqual([{ kind: 'update', id: 'c', block: { type: 'paragraph', content: 'Gamma by Leo' } }]);
    const next = apply(mine, ops);
    sync.applied(remote, incoming, next);
    // The local paragraph wins on save; the rest is sent as stored.
    expect(sync.emit(next)).toEqual([value[0], mine[1], remote[2]]);
  });

  it('keeps local inserts and deletes while applying remote ones', () => {
    const editor = shown(value);
    const sync = new DocSync(value, editor);
    const mine = [editor[0], normalize(stored('m', 'Mine')), editor[2]];
    const remote = [stored('x', 'Theirs'), ...value];
    const incoming = sync.receive(remote, mine)!;
    const next = apply(mine, planPatch(incoming.local, incoming.target));
    sync.applied(remote, incoming, next);
    expect(view(next)).toEqual(['Theirs', 'Alpha', 'Mine', 'Gamma']);
    expect(view(sync.emit(next)!)).toEqual(['Theirs', 'Alpha', 'Mine', 'Gamma']);
  });

  it('shows stored documents without block ids as they are while nothing was typed', () => {
    const plain = [{ type: 'paragraph', content: 'Template' }];
    const editor = plain.map((b, i) => normalize({ ...b, id: `gen${i}` }));
    const sync = new DocSync(plain, editor);
    expect(sync.emit(editor)).toBeNull();
    const remote = [stored('r1', 'Edited elsewhere')];
    const incoming = sync.receive(remote, editor)!;
    expect(incoming.target).toBe(remote);
    const next = apply(editor, planPatch(incoming.local, incoming.target));
    sync.applied(remote, incoming, next);
    expect(view(next)).toEqual(['Edited elsewhere']);
    expect(sync.emit(next)).toBeNull();
  });
});

describe('patch planning', () => {
  const doc = [stored('a', 'a', [stored('a1'), stored('a2')]), stored('b'), stored('c')];

  it('uses few operations for common changes', () => {
    expect(planPatch(doc, doc)).toEqual([]);
    expect(planPatch(doc, [doc[0], doc[2]])).toEqual([{ kind: 'remove', ids: ['b'] }]);
    expect(planPatch(doc, [doc[0], doc[2], doc[1]])).toEqual([{ kind: 'replace', ids: ['b', 'c'], blocks: [doc[2], doc[1]] }]);
    expect(planPatch(doc, [stored('z'), ...doc])).toEqual([{ kind: 'insert', ref: 'a', placement: 'before', blocks: [stored('z')] }]);
    expect(planPatch(doc, [stored('a', 'a', [stored('a1')]), doc[1], doc[2]])).toEqual([{ kind: 'remove', ids: ['a2'] }]);
    expect(planPatch([stored('b'), stored('c')], [stored('b', 'b', [stored('n')]), stored('c')])).toEqual([
      { kind: 'children', id: 'b', blocks: [stored('n')] },
    ]);
    // Moving a block to another parent or emptying the page resets the document.
    expect(planPatch(doc, [stored('a', 'a', [stored('a1')]), stored('a2'), doc[1], doc[2]])[0].kind).toBe('reset');
    expect(planPatch(doc, [])).toEqual([{ kind: 'reset', blocks: [] }]);
  });

  it('always reaches the target document', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let n = 0;
    const tree = (depth: number): BlockJson[] =>
      Array.from({ length: 1 + Math.floor(rand() * 4) }, () => stored(`k${++n}`, `t${n}`, depth < 2 && rand() < 0.3 ? tree(depth + 1) : []));
    for (let round = 0; round < 300; round++) {
      const local = tree(0);
      const target = structuredClone(local) as BlockJson[];
      const lists: BlockJson[][] = [];
      const collect = (list: BlockJson[]) => {
        lists.push(list);
        list.forEach((b) => collect(b.children!));
      };
      collect(target);
      for (let step = 0; step < 3; step++) {
        const list = lists[Math.floor(rand() * lists.length)];
        const i = Math.floor(rand() * list.length);
        const r = rand();
        if (r < 0.3 && list.length) list[i] = { ...list[i], content: `edit${step}` };
        else if (r < 0.5 && list.length > 1) list.splice(i, 1);
        else if (r < 0.8) list.splice(i, 0, stored(`new${++n}`));
        else if (list.length > 1) list.splice(Math.floor(rand() * list.length), 0, ...list.splice(i, 1));
      }
      const result = apply(shown(local), planPatch(local, target));
      expect(canonical(result)).toBe(canonical(shown(target)));
    }
  });
});
