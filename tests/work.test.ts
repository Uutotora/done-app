import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyData, useData } from '@/lib/store';
import { blockersOf, canDependOn, workBucket, workSummary } from '@/lib/work';
import { descendantsOf } from '@/lib/selectors';
const state = () => useData.getState();
beforeEach(() => state().replaceAll(createEmptyData('en')));
describe('work planning integrity', () => {
  it('prevents indirect dependency cycles and resolves blockers as work completes', () => {
    const p = state().createProject({ name: 'P' });
    const a = state().createItem({ projectId: p, title: 'A' });
    const b = state().createItem({ projectId: p, title: 'B', dependsOn: [a] });
    const c = state().createItem({ projectId: p, title: 'C', dependsOn: [b] });
    expect(canDependOn(a, c, state().items)).toBe(false);
    state().updateItem(a, { dependsOn: [c] });
    expect(state().items[a].dependsOn).toEqual([]);
    expect(blockersOf(state().items[b], state().items)).toHaveLength(1);
    state().updateItem(a, { status: 'done' });
    expect(blockersOf(state().items[b], state().items)).toEqual([]);
  });
  it('moves a complete task subtree and clears the old Plane link', () => {
    const p = state().createProject({ name: 'P' });
    const q = state().createProject({ name: 'Q' });
    const a = state().createItem({ projectId: p, title: 'A' });
    const b = state().createItem({ projectId: p, title: 'B', parentId: a });
    state().updateItem(a, { projectId: q });
    expect(state().items[b]).toMatchObject({ projectId: q, parentId: a });
    state().updateItem(a, { parentId: b });
    expect(state().items[a].parentId).toBeUndefined();
  });
  it('moves descendants to a surviving ancestor when several parents are deleted', () => {
    const p = state().createProject();
    const a = state().createItem({ projectId: p, title: 'A' });
    const b = state().createItem({ projectId: p, title: 'B', parentId: a });
    const c = state().createItem({ projectId: p, title: 'C', parentId: b });
    const snap = state().deleteItems([a, b]);
    expect(state().items[c].parentId).toBeUndefined();
    state().restore(snap);
    expect(state().items[c].parentId).toBe(b);
  });
  it('does not loop on cyclic imported parent data', () => {
    const p = state().createProject();
    const a = state().createItem({ projectId: p, title: 'A' });
    const b = state().createItem({ projectId: p, title: 'B', parentId: a });
    const items = [{ ...state().items[a], parentId: b }, state().items[b]];
    expect(descendantsOf(a, items).map((i) => i.id)).toEqual([b]);
  });
  it('uses calendar date boundaries and excludes closed tasks from attention', () => {
    const p = state().createProject();
    const today = '2026-09-26';
    const a = state().createItem({ projectId: p, title: 'Overdue', dueDate: '2026-09-25' });
    const b = state().createItem({ projectId: p, title: 'Week', dueDate: '2026-10-03' });
    state().createItem({ projectId: p, title: 'Canceled', dueDate: '2026-09-20', status: 'canceled' });
    expect(workBucket(state().items[a], today)).toBe('overdue');
    expect(workBucket(state().items[b], today)).toBe('week');
    expect(workSummary(Object.values(state().items), state().items, today).overdue.map((i) => i.id)).toEqual([a]);
  });
  it('moves the complete document subtree into a project', () => {
    const p = state().createProject();
    const parent = state().createDoc({ projectId: p });
    const a = state().createDoc();
    const b = state().createDoc({ parentId: a });
    state().moveDoc(a, parent);
    expect(state().docs[b].projectId).toBe(p);
  });
});
