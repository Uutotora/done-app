import { useLayoutEffect, useRef } from 'react';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { useDebouncedCallback } from '@/lib/hooks';
import { DocSync, planPatch, type BlockJson, type PatchOp } from '@/lib/editorSync';

type AnyEditor = BlockNoteEditor<any, any, any>;
type Transaction = Parameters<Parameters<AnyEditor['transact']>[0]>[0];
type PMNode = Transaction['doc'];
type Selection = Transaction['selection'];

/** Where a text cursor sits: block id and character offsets inside that block's text. */
interface Cursor {
  id: string;
  anchor: number;
  head: number;
  selection: Selection;
}

const syncs = new WeakMap<AnyEditor, DocSync>();

function locate(doc: PMNode, pos: number): { id: string; offset: number } | null {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name !== 'blockContainer') continue;
    if ($pos.depth <= depth || !$pos.node(depth + 1).isTextblock) return null;
    return { id: String(node.attrs.id), offset: pos - $pos.start(depth + 1) };
  }
  return null;
}

function readCursor(editor: AnyEditor): Cursor | null {
  let focused = false;
  try {
    focused = !!editor.prosemirrorView?.hasFocus();
  } catch {
    // Not mounted yet: nothing to keep.
  }
  if (!focused) return null;
  const { selection, doc } = editor.prosemirrorView!.state;
  // Only text cursors and text ranges within one block are restored; other selections map as usual.
  if (!('$cursor' in selection)) return null;
  const anchor = locate(doc, selection.anchor);
  const head = locate(doc, selection.head);
  if (!anchor || !head || anchor.id !== head.id) return null;
  return { id: anchor.id, anchor: anchor.offset, head: head.offset, selection };
}

/** Puts the cursor back at the same offsets inside its block when the block itself was rewritten. */
function restoreCursor(tr: Transaction, cursor: Cursor, rewritten: Set<string>) {
  const mapped = locate(tr.doc, tr.mapping.map(cursor.selection.anchor));
  if (mapped?.id === cursor.id && !rewritten.has(cursor.id)) return;
  let start = -1;
  let size = 0;
  tr.doc.descendants((node, pos) => {
    if (start >= 0) return false;
    if (node.type.name === 'blockContainer' && node.attrs.id === cursor.id) {
      if (node.firstChild?.isTextblock) {
        start = pos + 2;
        size = node.firstChild.content.size;
      }
      return false;
    }
    return true;
  });
  if (start < 0) return;
  // The current selection is a TextSelection (checked in readCursor), so its class creates the new one.
  const Text = cursor.selection.constructor as unknown as { create(doc: PMNode, anchor: number, head: number): Selection };
  tr.setSelection(Text.create(tr.doc, start + Math.min(cursor.anchor, size), start + Math.min(cursor.head, size)));
}

/** Applies block operations as one change that stays out of the local undo history. */
function patchEditor(editor: AnyEditor, ops: PatchOp[]) {
  const cursor = readCursor(editor);
  const rewritten = new Set<string>();
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false);
    for (const op of ops) {
      if (op.kind === 'reset') {
        rewritten.add(cursor?.id ?? '');
        const blocks = op.blocks.length ? op.blocks : [{ type: 'paragraph' }];
        editor.replaceBlocks(
          editor.document.map((b) => b.id),
          blocks as PartialBlock[],
        );
      } else if (op.kind === 'update') {
        rewritten.add(op.id);
        editor.updateBlock(op.id, op.block as PartialBlock);
      } else if (op.kind === 'insert') editor.insertBlocks(op.blocks as PartialBlock[], op.ref, op.placement);
      else if (op.kind === 'children') editor.updateBlock(op.id, { children: op.blocks as PartialBlock[] });
      else if (op.kind === 'remove') editor.removeBlocks(op.ids);
      else {
        op.ids.forEach((id) => rewritten.add(id));
        editor.replaceBlocks(op.ids, op.blocks as PartialBlock[]);
      }
    }
    if (cursor) restoreCursor(tr, cursor, rewritten);
  });
}

/**
 * Connects a BlockNote editor to stored content that teammates may change while it is open.
 * Returns the editor's change handler: local typing is saved (debounced, flushed on unmount and
 * when the page is hidden) in stored form, and each new `value` is patched into the editor block by
 * block, keeping the cursor and any block with unsaved local edits. The echo of our own save is ignored.
 */
export function useLiveContent(editor: AnyEditor, value: unknown[] | undefined, onChange: (blocks: unknown[]) => void) {
  // The editor was created from this render's `value`, so that is its starting point.
  if (!syncs.has(editor)) syncs.set(editor, new DocSync(value, editor.document as BlockJson[]));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const save = useDebouncedCallback((target: AnyEditor) => {
    const sync = syncs.get(target);
    if (!sync) return;
    let doc: BlockJson[];
    try {
      doc = target.document as BlockJson[];
    } catch {
      return;
    }
    const blocks = sync.emit(doc);
    if (blocks) onChangeRef.current(blocks);
  }, 350);

  useLayoutEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    const sync = syncs.get(editor)!;
    const apply = () => {
      // Never rewrite text in the middle of an IME composition; try again shortly.
      if (editor.prosemirrorView?.composing) {
        retry = setTimeout(apply, 250);
        return;
      }
      const incoming = sync.receive(value, editor.document as BlockJson[]);
      if (!incoming) return;
      const ops = planPatch(incoming.local, incoming.target);
      try {
        if (ops.length) patchEditor(editor, ops);
      } catch (error) {
        // A block the editor refuses in place: show the whole document again instead.
        try {
          patchEditor(editor, [{ kind: 'reset', blocks: incoming.target }]);
        } catch {
          console.error('Could not show the latest version of the text', error);
          return;
        }
      }
      sync.applied(value, incoming, editor.document as BlockJson[]);
    };
    apply();
    return () => clearTimeout(retry);
  }, [editor, value]);

  return save;
}
