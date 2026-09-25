import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyData, useData } from '@/lib/store';
import type { DataState } from '@/lib/types';

const s = () => useData.getState();

beforeEach(() => {
  const data = createEmptyData('en', 'Tester');
  data.onboarded = true;
  s().replaceAll(data);
});

describe('project groups', () => {
  it('orders projects inside a group and moves them between groups', () => {
    const g1 = s().createGroup({ name: 'Product' });
    const g2 = s().createGroup({ name: 'Discovery' });
    const a = s().createProject({ name: 'A', groupId: g1 });
    const b = s().createProject({ name: 'B', groupId: g1 });
    const c = s().createProject({ name: 'C', groupId: g2 });

    s().moveProject(b, g1, a);
    const inG1 = Object.values(s().projects)
      .filter((p) => p.groupId === g1)
      .sort((x, y) => x.order - y.order)
      .map((p) => p.name);
    expect(inG1).toEqual(['B', 'A']);

    s().moveProject(a, g2, c);
    expect(s().projects[a].groupId).toBe(g2);
    const inG2 = Object.values(s().projects)
      .filter((p) => p.groupId === g2)
      .sort((x, y) => x.order - y.order)
      .map((p) => p.name);
    expect(inG2).toEqual(['A', 'C']);
  });

  it('keeps projects when a group is deleted and restores the group with undo', () => {
    const g = s().createGroup({ name: 'Temp' });
    const p = s().createProject({ name: 'Kept', groupId: g });
    const snap = s().deleteGroup(g);
    expect(s().groups[g]).toBeUndefined();
    expect(s().projects[p].groupId).toBeUndefined();
    s().restore(snap);
    expect(s().groups[g].name).toBe('Temp');
    expect(s().projects[p].groupId).toBe(g);
  });
});

describe('items', () => {
  it('records activity and completion time', () => {
    const p = s().createProject({ name: 'P' });
    const id = s().createItem({ projectId: p, title: 'Ship it' });
    s().updateItem(id, { status: 'done' });
    expect(s().items[id].completedAt).toBeTruthy();
    const kinds = s()
      .activity.filter((a) => a.itemId === id)
      .map((a) => [a.kind, a.from, a.to]);
    expect(kinds).toEqual([
      ['created', undefined, undefined],
      ['status', 'backlog', 'done'],
    ]);
    s().updateItem(id, { status: 'in_progress' });
    expect(s().items[id].completedAt).toBeUndefined();
  });

  it('moves children up when the parent is deleted and restores them with undo', () => {
    const p = s().createProject({ name: 'P' });
    const epic = s().createItem({ projectId: p, title: 'Epic', type: 'epic' });
    const task = s().createItem({ projectId: p, title: 'Task', parentId: epic });
    const commentId = s().addComment('item', epic, 'hello');
    const snap = s().deleteItems([epic]);
    expect(s().items[epic]).toBeUndefined();
    expect(s().items[task].parentId).toBeUndefined();
    expect(s().comments[commentId]).toBeUndefined();
    s().restore(snap);
    expect(s().items[epic]).toBeDefined();
    expect(s().items[task].parentId).toBe(epic);
    expect(s().comments[commentId].text).toBe('hello');
  });

  it('duplicates an item with a new id', () => {
    const p = s().createProject({ name: 'P' });
    const id = s().createItem({ projectId: p, title: 'Original' });
    const copy = s().duplicateItem(id)!;
    expect(copy).not.toBe(id);
    expect(s().items[copy].title).toBe('Original (copy)');
    expect(s().items[id]).toBeDefined();
  });
});

describe('trash', () => {
  it('restores a deleted project with everything inside', () => {
    const p = s().createProject({ name: 'Doomed' });
    const it1 = s().createItem({ projectId: p, title: 'Task' });
    const doc = s().createDoc({ projectId: p, title: 'Spec' });
    const folder = s().createFolder({ name: 'Research', projectId: p });
    const entry = s().pushTrash('project', 'Doomed', '📁', s().deleteProject(p));
    expect(s().projects[p]).toBeUndefined();
    expect(s().items[it1]).toBeUndefined();
    expect(s().docs[doc]).toBeUndefined();
    expect(s().files[folder]).toBeUndefined();
    expect(s().trash).toHaveLength(1);

    s().restoreTrash(entry);
    expect(s().projects[p].name).toBe('Doomed');
    expect(s().items[it1]).toBeDefined();
    expect(s().docs[doc]).toBeDefined();
    expect(s().files[folder]).toBeDefined();
    expect(s().trash).toHaveLength(0);
  });

  it('drops entries older than 30 days', () => {
    s().pushTrash('item', 'Old', undefined, {});
    useData.setState((st) => ({ trash: st.trash.map((e) => ({ ...e, deletedAt: new Date(Date.now() - 31 * 86400000).toISOString() })) }));
    s().pushTrash('item', 'Fresh', undefined, {});
    s().pruneTrash();
    expect(s().trash.map((e) => e.title)).toEqual(['Fresh']);
  });
});

describe('file system', () => {
  it('refuses to move a folder into its own sub-folder', () => {
    const a = s().createFolder({ name: 'A' });
    const b = s().createFolder({ name: 'B', parentId: a });
    s().moveNodes([a], b, undefined);
    expect(s().files[a].parentId).toBeUndefined();
  });

  it('moves a folder with its contents to another drive', () => {
    const p = s().createProject({ name: 'P' });
    const folder = s().createFolder({ name: 'Research' });
    const link = s().createLink({ name: 'Plaud', url: 'https://web.plaud.ai/x', parentId: folder });
    s().moveNodes([folder], undefined, p);
    expect(s().files[folder].projectId).toBe(p);
    expect(s().files[link].projectId).toBe(p);
    expect(s().files[link].parentId).toBe(folder);
  });

  it('deletes folders recursively and restores them', () => {
    const a = s().createFolder({ name: 'A' });
    const b = s().createFolder({ name: 'B', parentId: a });
    const l = s().createLink({ name: 'L', url: 'https://example.com', parentId: b });
    const snap = s().deleteNodes([a]);
    expect(Object.keys(s().files)).toHaveLength(0);
    s().restore(snap);
    expect(s().files[l].parentId).toBe(b);
  });
});

describe('docs', () => {
  it('nests pages and refuses cycles', () => {
    const a = s().createDoc({ title: 'A' });
    const b = s().createDoc({ title: 'B' });
    s().moveDoc(b, a);
    expect(s().docs[b].parentId).toBe(a);
    s().moveDoc(a, b);
    expect(s().docs[a].parentId).toBeUndefined();
  });

  it('deletes sub-pages together with the page', () => {
    const a = s().createDoc({ title: 'A' });
    const b = s().createDoc({ title: 'B', parentId: a });
    s().deleteDoc(a);
    expect(s().docs[b]).toBeUndefined();
  });
});

describe('persist migration', () => {
  it('upgrades v2 data: drops meetings and converts old uploads to file nodes', () => {
    const migrate = useData.persist.getOptions().migrate!;
    const old = {
      ...createEmptyData('ru'),
      meetings: { m1: { id: 'm1' } },
      files: { f1: { id: 'f1', name: 'rec.mp3', size: 10, mime: 'audio/mpeg', meetingId: 'm1', createdAt: '2026-01-01T00:00:00.000Z' } },
      trash: [{ id: 't1', kind: 'meeting', title: 'x', snapshot: {}, deletedAt: '2026-01-01T00:00:00.000Z' }],
    } as unknown as DataState;
    const next = migrate(old, 2) as DataState & { meetings?: unknown };
    expect(next.meetings).toBeUndefined();
    expect(next.files.f1).toMatchObject({ id: 'f1', kind: 'file', name: 'rec.mp3', size: 10 });
    expect(next.trash).toHaveLength(0);
  });
});
