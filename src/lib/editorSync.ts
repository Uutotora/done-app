import { mergeBlocks } from '../../server/merge.mjs';

/**
 * Keeps an open block editor in step with the stored document while teammates edit it.
 *
 * The editor shows blocks in BlockNote's normalized form, while the store holds whatever was saved
 * (possibly written by another client). `DocSync` remembers the stored version of every block the
 * editor showed at the last sync point, so a save sends untouched blocks exactly as stored and only
 * the blocks typed into here count as changed. When a new stored version arrives, unsaved local edits
 * are rebased on it with the same block merge the server uses, and `planPatch` turns the difference
 * into a few block operations, so the editor is patched in place instead of being remounted.
 */

/** A block as stored: BlockNote JSON ({ id, type, props, content, children }). */
export interface BlockJson {
  id?: string;
  children?: BlockJson[];
  [key: string]: unknown;
}

/** JSON with sorted keys, for comparing documents produced by different clients. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/** The block without its children: type, props and text. */
export function ownOf(block: BlockJson): BlockJson {
  const { children: _children, ...own } = block;
  return own;
}

const ownKey = (block: BlockJson) => canonical(ownOf(block));

function forEachBlock(blocks: BlockJson[], visit: (block: BlockJson) => void) {
  for (const block of blocks) {
    visit(block);
    if (Array.isArray(block.children)) forEachBlock(block.children, visit);
  }
}

const asBlocks = (value: unknown): BlockJson[] => (Array.isArray(value) ? (value as BlockJson[]) : []);

export interface Incoming {
  /** The editor document as it would be saved now (with unsaved local edits). */
  local: BlockJson[];
  /** What the editor should show: the new stored version with unsaved local edits on top. */
  target: BlockJson[];
  /** Nothing was typed since the last sync point, so the stored version is shown as is. */
  pristine: boolean;
}

export class DocSync {
  /** The stored document the editor is in step with. */
  private base: BlockJson[] = [];
  /** Stored version of each block at the last sync point. */
  private stored = new Map<string, BlockJson>();
  /** How the editor showed each stored block at the last sync point; locally edited blocks are missing. */
  private shown = new Map<string, string>();
  /** The editor JSON at the last sync point, while nothing has been typed since. */
  private pristine: string | null = null;

  /** `doc` is the editor document that was just created from `value`. */
  constructor(value: unknown, doc: BlockJson[]) {
    this.settle(value, doc, null);
    this.pristine = JSON.stringify(doc);
  }

  private settle(value: unknown, doc: BlockJson[], edited: Set<string> | null) {
    this.base = asBlocks(value);
    this.stored = new Map();
    forEachBlock(this.base, (block) => {
      if (typeof block.id === 'string') this.stored.set(block.id, block);
    });
    this.shown = new Map();
    forEachBlock(doc, (block) => {
      if (typeof block.id === 'string' && this.stored.has(block.id) && !edited?.has(block.id)) this.shown.set(block.id, ownKey(block));
    });
  }

  /** The editor document in stored form: blocks untouched since the last sync point are sent exactly as stored. */
  toStored(doc: BlockJson[]): BlockJson[] {
    const walk = (blocks: BlockJson[]): BlockJson[] =>
      blocks.map((block) => {
        const children = walk(block.children ?? []);
        const untouched = typeof block.id === 'string' && this.shown.get(block.id) === ownKey(block);
        const own = untouched ? this.stored.get(block.id!)! : block;
        const out: BlockJson = { ...own };
        if (children.length || Array.isArray(own.children)) out.children = children;
        else delete out.children;
        return out;
      });
    return walk(doc);
  }

  /** After local typing: the document to save, or null when it matches what is stored. */
  emit(doc: BlockJson[]): BlockJson[] | null {
    const json = JSON.stringify(doc);
    if (json === this.pristine) return null;
    const local = this.toStored(doc);
    const changed = canonical(local) !== canonical(this.base);
    if (changed) this.settle(local, doc, null);
    this.pristine = json;
    return changed ? local : null;
  }

  /** A stored version arrived (a teammate's edit or the echo of our own save). Null when the editor already shows it. */
  receive(value: unknown, doc: BlockJson[]): Incoming | null {
    const next = asBlocks(value);
    if (canonical(next) === canonical(this.base)) {
      this.base = next;
      return null;
    }
    const pristine = this.pristine !== null && JSON.stringify(doc) === this.pristine;
    const local = this.toStored(doc);
    const target = pristine ? next : asBlocks(mergeBlocks(next, this.base, local));
    return { local, target, pristine };
  }

  /** The editor was patched to `incoming.target`; `doc` is its document now. */
  applied(value: unknown, incoming: Incoming, doc: BlockJson[]) {
    let edited: Set<string> | null = null;
    if (!incoming.pristine) {
      // Blocks where local text won over the stored version stay "edited" until they are saved.
      const stored = new Map<string, string>();
      forEachBlock(asBlocks(value), (block) => {
        if (typeof block.id === 'string') stored.set(block.id, ownKey(block));
      });
      edited = new Set();
      forEachBlock(incoming.target, (block) => {
        if (typeof block.id === 'string' && stored.get(block.id) !== ownKey(block)) edited!.add(block.id);
      });
    }
    this.settle(value, doc, edited);
    this.pristine = incoming.pristine || canonical(this.toStored(doc)) === canonical(this.base) ? JSON.stringify(doc) : null;
  }
}

/** One editor operation. Blocks are addressed by id; `update` carries own fields only (children stay). */
export type PatchOp =
  | { kind: 'reset'; blocks: BlockJson[] }
  | { kind: 'update'; id: string; block: BlockJson }
  | { kind: 'insert'; ref: string; placement: 'before' | 'after'; blocks: BlockJson[] }
  | { kind: 'children'; id: string; blocks: BlockJson[] }
  | { kind: 'remove'; ids: string[] }
  | { kind: 'replace'; ids: string[]; blocks: BlockJson[] };

/** id → parent id (null on the top level), or null when some block has no id or an id repeats. */
function parentsOf(blocks: BlockJson[]): Map<string, string | null> | null {
  const parents = new Map<string, string | null>();
  const walk = (list: BlockJson[], parent: string | null): boolean =>
    list.every((block) => {
      if (typeof block.id !== 'string' || parents.has(block.id)) return false;
      parents.set(block.id, parent);
      return walk(block.children ?? [], block.id);
    });
  return walk(blocks, null) ? parents : null;
}

/** Own fields to hand to the editor's updateBlock: everything but id and children. */
function updateOf(block: BlockJson): BlockJson {
  const { id: _id, children: _children, ...rest } = block;
  return rest;
}

/**
 * Block operations that turn `local` (the editor document in stored form) into `target`. Each list
 * keeps its common head and tail and replaces only the changed run in between; changed blocks are
 * updated in place. Moves between parents fall back to replacing the whole document.
 */
export function planPatch(local: BlockJson[], target: BlockJson[]): PatchOp[] {
  const reset: PatchOp[] = [{ kind: 'reset', blocks: target }];
  const from = parentsOf(local);
  const to = parentsOf(target);
  if (!from || !to || !target.length) return reset;
  for (const [id, parent] of to) if (from.has(id) && from.get(id) !== parent) return reset;
  const ops: PatchOp[] = [];
  let failed = false;
  const reconcile = (was: BlockJson[], now: BlockJson[], parent: string | null) => {
    let head = 0;
    while (head < was.length && head < now.length && was[head].id === now[head].id) head++;
    let tail = 0;
    while (tail < was.length - head && tail < now.length - head && was[was.length - 1 - tail].id === now[now.length - 1 - tail].id) tail++;
    const gone = was.slice(head, was.length - tail);
    const added = now.slice(head, now.length - tail);
    if (added.length && !gone.length) {
      if (head) ops.push({ kind: 'insert', ref: was[head - 1].id!, placement: 'after', blocks: added });
      else if (tail) ops.push({ kind: 'insert', ref: was[was.length - tail].id!, placement: 'before', blocks: added });
      else if (parent) ops.push({ kind: 'children', id: parent, blocks: added });
      else failed = true;
    } else if (gone.length && !added.length) ops.push({ kind: 'remove', ids: gone.map((b) => b.id!) });
    else if (gone.length) ops.push({ kind: 'replace', ids: gone.map((b) => b.id!), blocks: added });
    const kept = [...now.slice(0, head).map((b, i) => [was[i], b]), ...now.slice(now.length - tail).map((b, i) => [was[was.length - tail + i], b])];
    for (const [a, b] of kept) {
      if (ownKey(a) !== ownKey(b)) ops.push({ kind: 'update', id: b.id!, block: updateOf(b) });
      reconcile(a.children ?? [], b.children ?? [], b.id!);
    }
  };
  reconcile(local, target, null);
  return failed ? reset : ops;
}
