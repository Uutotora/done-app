import { useData, type Snapshot } from './store';
import { toast, useUI } from './ui';
import { translate, type TKey } from './i18n';
import type { ID, ItemStatus, TrashKind } from './types';

/** Changes status and throws confetti when something becomes done. */
export function setItemStatus(id: ID, status: ItemStatus, at?: { clientX: number; clientY: number }) {
  const s = useData.getState();
  const prev = s.items[id];
  if (!prev || prev.status === status) return;
  s.updateItem(id, { status });
  if (status === 'done' && at) useUI.getState().fireCelebrate(at.clientX, at.clientY);
}

/** Moves a deleted snapshot to the trash and offers an immediate undo. */
function trashWithUndo(
  kind: TrashKind,
  title: string,
  icon: string | undefined,
  snap: Snapshot,
  message: TKey,
  vars?: Record<string, string | number>,
) {
  const s = useData.getState();
  const lang = s.prefs.lang;
  const entryId = s.pushTrash(kind, title || translate(lang, 'common.untitled'), icon, snap);
  toast({
    message: translate(lang, message, vars),
    action: { label: translate(lang, 'common.undo'), run: () => useData.getState().restoreTrash(entryId) },
  });
}

export function deleteItemsWithUndo(ids: ID[]) {
  const s = useData.getState();
  const first = s.items[ids[0]];
  const snap = s.deleteItems(ids);
  const ui = useUI.getState();
  if (ui.peekItemId && ids.includes(ui.peekItemId)) ui.openPeek(undefined);
  const title = ids.length === 1 ? (first?.title ?? '') : `${first?.title ?? ''} +${ids.length - 1}`;
  trashWithUndo('item', title, undefined, snap, ids.length === 1 ? 'item.deleted' : 'backlog.bulkDeleted', { n: ids.length });
}

export function deleteProjectWithUndo(id: ID) {
  const s = useData.getState();
  const p = s.projects[id];
  if (!p) return;
  trashWithUndo('project', p.name, p.icon, s.deleteProject(id), 'project.deleted');
}

export function deleteGroupWithUndo(id: ID) {
  const s = useData.getState();
  const g = s.groups[id];
  if (!g) return;
  trashWithUndo('group', g.name, g.icon, s.deleteGroup(id), 'group.deleted');
}

export function deleteDocWithUndo(id: ID) {
  const s = useData.getState();
  const d = s.docs[id];
  if (!d) return;
  trashWithUndo('doc', d.title, d.icon ?? '📄', s.deleteDoc(id), 'docs.deleted');
}

export function deleteNodesWithUndo(ids: ID[]) {
  const s = useData.getState();
  const first = s.files[ids[0]];
  if (!first) return;
  const icon = first.kind === 'folder' ? '📁' : first.kind === 'link' ? '🔗' : '📎';
  const title = ids.length === 1 ? first.name : `${first.name} +${ids.length - 1}`;
  trashWithUndo('file', title, icon, s.deleteNodes(ids), 'files.deleted');
}
