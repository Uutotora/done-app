import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';

/**
 * BlockNote conversions for exports. Loaded on demand (and bundled with the
 * editor chunk) by docExport.ts; a single headless editor is enough because
 * it only serializes the blocks it is given.
 */

let headless: BlockNoteEditor | undefined;
const editor = () => (headless ??= BlockNoteEditor.create());

export function blocksToMarkdown(blocks: unknown[]): string {
  return blocks.length ? editor().blocksToMarkdownLossy(blocks as PartialBlock[]) : '';
}

export function blocksToHtml(blocks: unknown[]): string {
  return blocks.length ? editor().blocksToHTMLLossy(blocks as PartialBlock[]) : '';
}
