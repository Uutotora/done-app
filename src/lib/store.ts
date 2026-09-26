import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStateStorage } from './storage';
import { nowIso, uid } from './utils';
import { allowMutation } from './mutationPolicy';
import { canDependOn } from './work';
import { PLANE_DEFAULTS, DEFAULT_AI_MODEL, PLANE_GROUP_TO_STATUS } from './constants';
import type {
  Activity,
  ActivityKind,
  AiConfig,
  AppNotification,
  Comment,
  CommentTarget,
  DataState,
  Doc,
  FileNode,
  ID,
  Item,
  Lang,
  Person,
  PlaneConfig,
  PlaneSnapshot,
  Prefs,
  Project,
  ProjectGroup,
  ProjectMap,
  Ref,
  Sprint,
  TrashEntry,
  TrashKind,
  Workspace,
} from './types';

export const SCHEMA_VERSION = 4;
const ACTIVITY_LIMIT = 3000;
const TRASH_TTL_DAYS = 30;

export function createEmptyData(lang: Lang, name = ''): DataState {
  const me: Person = { id: uid('p'), name: name || (lang === 'ru' ? 'Вы' : 'You'), color: 'blue' };
  return {
    schema: SCHEMA_VERSION,
    onboarded: false,
    workspace: { name: lang === 'ru' ? 'Мое пространство' : 'My workspace', icon: '🚀' },
    meId: me.id,
    people: { [me.id]: me },
    groups: {},
    projects: {},
    items: {},
    docs: {},
    files: {},
    maps: {},
    sprints: {},
    comments: {},
    notifications: {},
    activity: [],
    trash: [],
    plane: {
      config: { ...PLANE_DEFAULTS, workspaceSlug: '', apiKey: '', autoStatus: true },
      snapshots: {},
    },
    ai: { apiKey: '', model: DEFAULT_AI_MODEL },
    prefs: {
      theme: 'system',
      lang,
      sidebarCollapsed: false,
      sidebarWidth: 256,
      favorites: [],
      recent: [],
      expanded: {},
    },
  };
}

/** Entities removed by a destructive action, kept so it can be undone or restored from trash. */
export interface Snapshot {
  groups?: Record<ID, ProjectGroup>;
  projects?: Record<ID, Project>;
  items?: Record<ID, Item>;
  docs?: Record<ID, Doc>;
  files?: Record<ID, FileNode>;
  maps?: Record<ID, ProjectMap>;
  sprints?: Record<ID, Sprint>;
  comments?: Record<ID, Comment>;
}

type NewItem = Partial<Item> & Pick<Item, 'projectId' | 'title'>;

export interface Actions {
  replaceAll: (data: DataState) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  toggleFavorite: (ref: Ref) => void;
  touchRecent: (ref: Ref) => void;
  setExpanded: (key: string, open: boolean) => void;
  updateWorkspace: (patch: Partial<Workspace>) => void;

  addPerson: (p: Omit<Person, 'id'>) => ID;
  updatePerson: (id: ID, patch: Partial<Person>) => void;
  removePerson: (id: ID) => void;

  createGroup: (patch?: Partial<ProjectGroup>) => ID;
  updateGroup: (id: ID, patch: Partial<ProjectGroup>) => void;
  deleteGroup: (id: ID) => Snapshot;

  createProject: (patch?: Partial<Project>) => ID;
  updateProject: (id: ID, patch: Partial<Project>) => void;
  moveProject: (id: ID, groupId: ID | undefined, beforeId?: ID) => void;
  duplicateProject: (id: ID) => ID | undefined;
  deleteProject: (id: ID) => Snapshot;

  createItem: (item: NewItem) => ID;
  updateItem: (id: ID, patch: Partial<Item>) => void;
  updateItems: (ids: ID[], patch: Partial<Item>) => void;
  duplicateItem: (id: ID) => ID | undefined;
  deleteItems: (ids: ID[]) => Snapshot;
  reorderItems: (orderedIds: ID[]) => void;

  createDoc: (patch?: Partial<Doc>) => ID;
  updateDoc: (id: ID, patch: Partial<Doc>) => void;
  moveDoc: (id: ID, parentId: ID | undefined, beforeId?: ID) => void;
  duplicateDoc: (id: ID) => ID | undefined;
  deleteDoc: (id: ID) => Snapshot;

  createFolder: (patch: Partial<FileNode> & { name: string }) => ID;
  createLink: (patch: Partial<FileNode> & { name: string; url: string }) => ID;
  addFile: (node: FileNode) => void;
  updateNode: (id: ID, patch: Partial<FileNode>) => void;
  moveNodes: (ids: ID[], parentId: ID | undefined, projectId: ID | undefined) => void;
  deleteNodes: (ids: ID[]) => Snapshot;

  setMap: (projectId: ID, map: Omit<ProjectMap, 'updatedAt'>) => void;

  addComment: (targetKind: CommentTarget, targetId: ID, text: string, mentions?: ID[]) => ID;
  updateComment: (id: ID, text: string) => void;
  deleteComment: (id: ID) => void;

  createSprint: (projectId: ID, patch?: Partial<Sprint>) => ID;
  updateSprint: (id: ID, patch: Partial<Sprint>) => void;
  startSprint: (id: ID) => void;
  /** Closes the sprint and moves unfinished work to the next sprint or back to the backlog. Returns the next sprint id. */
  completeSprint: (id: ID, carryOver: 'next' | 'backlog') => ID | undefined;
  deleteSprint: (id: ID) => Snapshot;

  markNotifications: (ids: ID[], read: boolean) => void;
  archiveNotifications: (ids: ID[], archived: boolean) => void;

  pushTrash: (kind: TrashKind, title: string, icon: string | undefined, snapshot: Snapshot) => ID;
  restoreTrash: (entryId: ID) => void;
  purgeTrash: (entryId: ID) => void;
  emptyTrash: () => void;
  pruneTrash: () => void;

  setPlaneConfig: (patch: Partial<PlaneConfig>) => void;
  setPlaneSnapshot: (projectId: ID, snap: PlaneSnapshot | undefined) => void;
  applyPlaneStates: (projectId: ID) => void;

  setAi: (patch: Partial<AiConfig>) => void;

  restore: (snap: Snapshot) => void;
}

export type Store = DataState & Actions;

function maxOrder(records: Iterable<{ order: number }>): number {
  let m = 0;
  for (const r of records) if (r.order > m) m = r.order;
  return m;
}

/** Copy of an entity without identity/timestamps, ready to be re-created. */
function cloneable<T extends { id: ID; createdAt: string; updatedAt: string }>(src: T): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const copy: Partial<T> = { ...src };
  delete copy.id;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as Omit<T, 'id' | 'createdAt' | 'updatedAt'>;
}

function omit<T>(rec: Record<ID, T>, ids: Iterable<ID>): Record<ID, T> {
  const next = { ...rec };
  for (const id of ids) delete next[id];
  return next;
}

function pick<T>(rec: Record<ID, T>, ids: Iterable<ID>): Record<ID, T> {
  const out: Record<ID, T> = {};
  for (const id of ids) if (rec[id]) out[id] = rec[id];
  return out;
}

/** Places `moving` before `beforeId` (or at the end) and renumbers the siblings. */
function reorder<T extends { id: ID; order: number }>(siblings: T[], moving: T, beforeId?: ID): T[] {
  const list = siblings.filter((s) => s.id !== moving.id).sort((a, b) => a.order - b.order);
  const idx = beforeId ? list.findIndex((s) => s.id === beforeId) : -1;
  list.splice(idx < 0 ? list.length : idx, 0, moving);
  return list.map((s, i) => ({ ...s, order: i + 1 }));
}

const TRACKED: [keyof Item, ActivityKind][] = [
  ['status', 'status'],
  ['priority', 'priority'],
  ['assigneeId', 'assignee'],
  ['dueDate', 'due'],
  ['title', 'title'],
  ['projectId', 'project'],
  ['parentId', 'parent'],
  ['type', 'type'],
];

function diffActivity(prev: Item, next: Item, actorId: ID, at: string): Activity[] {
  const out: Activity[] = [];
  for (const [key, kind] of TRACKED) {
    const a = prev[key];
    const b = next[key];
    if (a !== b) {
      out.push({ id: uid('ac'), itemId: prev.id, actorId, kind, from: a == null ? undefined : String(a), to: b == null ? undefined : String(b), at });
    }
  }
  if (!prev.plane && next.plane && !next.plane.demo) {
    out.push({ id: uid('ac'), itemId: prev.id, actorId, kind: 'plane', to: next.plane.key, at });
  }
  return out;
}

function withActivity(list: Activity[], add: Activity[]): Activity[] {
  if (!add.length) return list;
  const next = [...list, ...add];
  return next.length > ACTIVITY_LIMIT ? next.slice(next.length - ACTIVITY_LIMIT) : next;
}

const NOTIFICATION_LIMIT = 400;

/** Inbox entries for teammates. Never notifies the actor and skips duplicates within one action. */
function notifyAll(
  s: DataState,
  drafts: Omit<AppNotification, 'id' | 'createdAt' | 'actorId'>[],
  at: string,
): Record<ID, AppNotification> | undefined {
  const seen = new Set<string>();
  const add: AppNotification[] = [];
  for (const d of drafts) {
    const key = `${d.recipientId}:${d.targetId}:${d.kind}`;
    if (d.recipientId === s.meId || !s.people[d.recipientId] || seen.has(key)) continue;
    seen.add(key);
    add.push({ ...d, id: uid('nt'), actorId: s.meId, createdAt: at });
  }
  if (!add.length) return undefined;
  let all = [...Object.values(s.notifications ?? {}), ...add];
  if (all.length > NOTIFICATION_LIMIT * 4) all = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, NOTIFICATION_LIMIT * 4);
  return Object.fromEntries(all.map((n) => [n.id, n]));
}

function itemNotifications(prev: Item | undefined, next: Item, bulk: boolean): Omit<AppNotification, 'id' | 'createdAt' | 'actorId'>[] {
  const out: Omit<AppNotification, 'id' | 'createdAt' | 'actorId'>[] = [];
  const base = { targetKind: 'item' as const, targetId: next.id, projectId: next.projectId };
  const reassigned = !!next.assigneeId && next.assigneeId !== prev?.assigneeId;
  if (reassigned) out.push({ ...base, kind: 'assigned', recipientId: next.assigneeId! });
  if (prev && !bulk && next.status !== prev.status) {
    for (const r of new Set([next.assigneeId, next.createdBy])) {
      // A new assignee already hears about the task through the assignment.
      if (r && !(reassigned && r === next.assigneeId)) out.push({ ...base, kind: 'status', recipientId: r, text: next.status });
    }
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

function todayIso(): string {
  return localDate(new Date());
}

export const useData = create<Store>()(
  persist(
    (set, get) => ({
      ...createEmptyData('ru'),

      replaceAll: (data) => set({ ...createEmptyData(data.prefs?.lang ?? 'ru'), ...data }),

      setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),

      toggleFavorite: (ref) =>
        set((s) => {
          const exists = s.prefs.favorites.some((f) => f.kind === ref.kind && f.id === ref.id);
          const favorites = exists ? s.prefs.favorites.filter((f) => !(f.kind === ref.kind && f.id === ref.id)) : [...s.prefs.favorites, ref];
          return { prefs: { ...s.prefs, favorites } };
        }),

      touchRecent: (ref) =>
        set((s) => {
          const recent = [{ ...ref, at: nowIso() }, ...s.prefs.recent.filter((r) => !(r.kind === ref.kind && r.id === ref.id))].slice(0, 12);
          return { prefs: { ...s.prefs, recent } };
        }),

      setExpanded: (key, open) => set((s) => ({ prefs: { ...s.prefs, expanded: { ...s.prefs.expanded, [key]: open } } })),

      updateWorkspace: (patch) => set((s) => ({ workspace: { ...s.workspace, ...patch } })),

      addPerson: (p) => {
        const id = uid('p');
        set((s) => ({ people: { ...s.people, [id]: { ...p, id } } }));
        return id;
      },
      updatePerson: (id, patch) => set((s) => (s.people[id] ? { people: { ...s.people, [id]: { ...s.people[id], ...patch } } } : {})),
      removePerson: (id) =>
        set((s) => {
          if (id === s.meId) return {};
          const items = { ...s.items };
          for (const it of Object.values(items)) if (it.assigneeId === id) items[it.id] = { ...it, assigneeId: undefined };
          const projects = { ...s.projects };
          for (const p of Object.values(projects)) if (p.leadId === id) projects[p.id] = { ...p, leadId: undefined };
          return { people: omit(s.people, [id]), items, projects };
        }),

      createGroup: (patch = {}) => {
        const id = uid('g');
        const group: ProjectGroup = { id, name: '', icon: '📂', order: maxOrder(Object.values(get().groups)) + 1, ...patch };
        set((s) => ({
          groups: { ...s.groups, [id]: group },
          prefs: { ...s.prefs, expanded: { ...s.prefs.expanded, [`group:${id}`]: true } },
        }));
        return id;
      },
      updateGroup: (id, patch) => set((s) => (s.groups[id] ? { groups: { ...s.groups, [id]: { ...s.groups[id], ...patch } } } : {})),
      deleteGroup: (id) => {
        const s = get();
        const members = Object.values(s.projects).filter((p) => p.groupId === id);
        const snap: Snapshot = {
          groups: pick(s.groups, [id]),
          projects: pick(
            s.projects,
            members.map((p) => p.id),
          ),
        };
        const projects = { ...s.projects };
        // Projects are kept and simply leave the group.
        for (const p of members) projects[p.id] = { ...p, groupId: undefined };
        set({ groups: omit(s.groups, [id]), projects });
        return snap;
      },

      createProject: (patch = {}) => {
        const id = uid('pr');
        const ts = nowIso();
        const s = get();
        const project: Project = {
          id,
          name: '',
          icon: '📁',
          color: 'blue',
          status: 'on_track',
          leadId: s.meId,
          createdBy: s.meId,
          order: maxOrder(Object.values(s.projects).filter((p) => p.groupId === patch.groupId)) + 1,
          createdAt: ts,
          updatedAt: ts,
          ...patch,
        };
        set((st) => ({
          projects: { ...st.projects, [id]: project },
          prefs: {
            ...st.prefs,
            expanded: {
              ...st.prefs.expanded,
              [`project:${id}`]: true,
              ...(project.groupId ? { [`group:${project.groupId}`]: true } : {}),
            },
          },
        }));
        return id;
      },
      updateProject: (id, patch) =>
        set((s) => (s.projects[id] ? { projects: { ...s.projects, [id]: { ...s.projects[id], ...patch, updatedAt: nowIso() } } } : {})),
      moveProject: (id, groupId, beforeId) =>
        set((s) => {
          const moving = s.projects[id];
          if (!moving) return {};
          const siblings = Object.values(s.projects).filter((p) => p.groupId === groupId);
          const ordered = reorder(siblings, { ...moving, groupId }, beforeId);
          const projects = { ...s.projects };
          for (const p of ordered) projects[p.id] = p;
          return { projects };
        }),
      duplicateProject: (id) => {
        const s = get();
        const src = s.projects[id];
        if (!src) return undefined;
        const copyId = get().createProject({
          ...cloneable(src),
          name: `${src.name} (${s.prefs.lang === 'ru' ? 'копия' : 'copy'})`,
          plane: undefined,
        });
        // Copy items preserving the hierarchy.
        const idMap = new Map<ID, ID>();
        const srcItems = Object.values(s.items).filter((i) => i.projectId === id);
        const ts = nowIso();
        const items = { ...get().items };
        for (const it of srcItems) idMap.set(it.id, uid('it'));
        for (const it of srcItems) {
          const nid = idMap.get(it.id)!;
          items[nid] = {
            ...it,
            id: nid,
            projectId: copyId,
            parentId: it.parentId ? idMap.get(it.parentId) : undefined,
            dependsOn: it.dependsOn?.map((dep) => idMap.get(dep) ?? dep),
            sprintId: undefined,
            plane: undefined,
            createdAt: ts,
            updatedAt: ts,
          };
        }
        set({ items });
        return copyId;
      },
      deleteProject: (id) => {
        const s = get();
        const itemIds = Object.values(s.items)
          .filter((i) => i.projectId === id)
          .map((i) => i.id);
        const docIds = Object.values(s.docs)
          .filter((d) => d.projectId === id)
          .map((d) => d.id);
        const fileIds = Object.values(s.files)
          .filter((f) => f.projectId === id)
          .map((f) => f.id);
        const commentIds = Object.values(s.comments)
          .filter((c) => itemIds.includes(c.targetId) || docIds.includes(c.targetId))
          .map((c) => c.id);
        const sprintIds = Object.values(s.sprints)
          .filter((sp) => sp.projectId === id)
          .map((sp) => sp.id);
        const snap: Snapshot = {
          projects: pick(s.projects, [id]),
          items: pick(s.items, itemIds),
          docs: pick(s.docs, docIds),
          files: pick(s.files, fileIds),
          maps: pick(s.maps, [id]),
          sprints: pick(s.sprints, sprintIds),
          comments: pick(s.comments, commentIds),
        };
        set({
          projects: omit(s.projects, [id]),
          items: omit(s.items, itemIds),
          docs: omit(s.docs, docIds),
          files: omit(s.files, fileIds),
          maps: omit(s.maps, [id]),
          sprints: omit(s.sprints, sprintIds),
          comments: omit(s.comments, commentIds),
        });
        return snap;
      },

      createItem: (input) => {
        const id = uid('it');
        const ts = nowIso();
        const s = get();
        const siblings = Object.values(s.items).filter((i) => i.projectId === input.projectId);
        const minOrder = siblings.reduce((m, i) => Math.min(m, i.order), 0);
        const item: Item = {
          id,
          type: 'task',
          status: 'backlog',
          priority: 'none',
          tags: [],
          order: minOrder - 1,
          createdBy: s.meId,
          createdAt: ts,
          updatedAt: ts,
          ...input,
        };
        if (item.status === 'done' && !item.completedAt) item.completedAt = ts;
        if (item.sprintId && s.sprints[item.sprintId]?.projectId !== item.projectId) item.sprintId = undefined;
        set((st) => ({
          items: { ...st.items, [id]: item },
          activity: withActivity(st.activity, [{ id: uid('ac'), itemId: id, actorId: st.meId, kind: 'created', at: ts }]),
          ...(item.assigneeId ? { notifications: notifyAll(st, itemNotifications(undefined, item, false), ts) ?? st.notifications } : {}),
        }));
        return id;
      },
      updateItem: (id, patch) => get().updateItems([id], patch),
      updateItems: (ids, patch) =>
        set((s) => {
          if (patch.projectId && !s.projects[patch.projectId]) return {};
          const items = { ...s.items };
          const ts = nowIso();
          const acts: Activity[] = [];
          const notes: Parameters<typeof notifyAll>[1] = [];
          const moving = new Set(ids);
          if (patch.projectId) {
            let grew = true;
            while (grew) {
              grew = false;
              for (const item of Object.values(items)) {
                if (item.parentId && moving.has(item.parentId) && !moving.has(item.id)) {
                  moving.add(item.id);
                  grew = true;
                }
              }
            }
          }
          for (const id of moving) {
            const prev = items[id];
            if (!prev) continue;
            const changes = ids.includes(id) ? patch : { projectId: patch.projectId };
            const next: Item = { ...prev, ...changes, id, updatedAt: ts };
            if (changes.projectId && changes.projectId !== prev.projectId) {
              next.plane = undefined;
              next.sprintId = undefined;
              if (next.parentId && !moving.has(next.parentId)) next.parentId = undefined;
            }
            if (next.sprintId && s.sprints[next.sprintId]?.projectId !== next.projectId) next.sprintId = prev.sprintId;
            if (next.parentId) {
              const visited = new Set<ID>([id]);
              let cursor: ID | undefined = next.parentId;
              let invalid = !items[cursor] || (items[cursor].projectId !== next.projectId && !moving.has(cursor));
              while (cursor && !invalid) {
                if (visited.has(cursor)) {
                  invalid = true;
                  break;
                }
                visited.add(cursor);
                cursor = items[cursor]?.parentId;
              }
              if (invalid) next.parentId = prev.parentId;
            }
            if (changes.dependsOn) next.dependsOn = [...new Set(changes.dependsOn)].filter((dep) => canDependOn(id, dep, items));
            if (changes.status && changes.status !== prev.status) next.completedAt = changes.status === 'done' ? ts : undefined;
            items[id] = next;
            acts.push(...diffActivity(prev, next, s.meId, ts));
            notes.push(...itemNotifications(prev, next, ids.length > 1));
          }
          const notifications = notifyAll(s, notes, ts);
          return { items, activity: withActivity(s.activity, acts), ...(notifications ? { notifications } : {}) };
        }),
      duplicateItem: (id) => {
        const s = get();
        const src = s.items[id];
        if (!src) return undefined;
        const nid = get().createItem({
          ...cloneable(src),
          title: `${src.title} (${s.prefs.lang === 'ru' ? 'копия' : 'copy'})`,
          plane: undefined,
          createdBy: s.meId,
          order: src.order + 0.5,
        });
        return nid;
      },
      deleteItems: (ids) => {
        const s = get();
        const idSet = new Set(ids);
        const snapItems = pick(s.items, ids);
        const items = omit(s.items, ids);
        // Children of removed items move up one level; remember their old state for undo.
        for (const it of Object.values(items)) {
          if (it.parentId && idSet.has(it.parentId)) {
            snapItems[it.id] = it;
            let parentId = s.items[it.parentId]?.parentId;
            const seen = new Set<ID>([it.id]);
            while (parentId && idSet.has(parentId) && !seen.has(parentId)) {
              seen.add(parentId);
              parentId = s.items[parentId]?.parentId;
            }
            items[it.id] = { ...it, parentId: parentId && !seen.has(parentId) ? parentId : undefined };
          }
        }
        const commentIds = Object.values(s.comments)
          .filter((c) => c.targetKind === 'item' && idSet.has(c.targetId))
          .map((c) => c.id);
        set({ items, comments: omit(s.comments, commentIds) });
        return { items: snapItems, comments: pick(s.comments, commentIds) };
      },
      reorderItems: (orderedIds) =>
        set((s) => {
          const items = { ...s.items };
          orderedIds.forEach((id, idx) => {
            if (items[id] && items[id].order !== idx) items[id] = { ...items[id], order: idx };
          });
          return { items };
        }),

      createDoc: (patch = {}) => {
        const id = uid('dc');
        const ts = nowIso();
        const siblings = Object.values(get().docs).filter((d) => d.parentId === patch.parentId && d.projectId === patch.projectId);
        const doc: Doc = { id, title: '', order: maxOrder(siblings) + 1, createdBy: get().meId, createdAt: ts, updatedAt: ts, ...patch };
        set((s) => ({ docs: { ...s.docs, [id]: doc } }));
        return id;
      },
      updateDoc: (id, patch) => set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], ...patch, updatedAt: nowIso() } } } : {})),
      moveDoc: (id, parentId, beforeId) =>
        set((s) => {
          const moving = s.docs[id];
          if (!moving) return {};
          // Refuse to nest a page inside itself or its own sub-pages.
          let cursor = parentId;
          const visited = new Set<ID>([id]);
          while (cursor) {
            if (visited.has(cursor)) return {};
            visited.add(cursor);
            cursor = s.docs[cursor]?.parentId;
          }
          const projectId = parentId ? s.docs[parentId]?.projectId : moving.projectId;
          const siblings = Object.values(s.docs).filter((d) => d.parentId === parentId && d.projectId === projectId);
          const ordered = reorder(siblings, { ...moving, parentId, projectId }, beforeId);
          const docs = { ...s.docs };
          for (const d of ordered) docs[d.id] = d;
          const moved = new Set<ID>([id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const d of Object.values(docs)) {
              if (d.parentId && moved.has(d.parentId) && !moved.has(d.id)) {
                moved.add(d.id);
                docs[d.id] = { ...d, projectId };
                grew = true;
              }
            }
          }
          return { docs };
        }),
      duplicateDoc: (id) => {
        const s = get();
        const src = s.docs[id];
        if (!src) return undefined;
        return get().createDoc({
          ...cloneable(src),
          title: `${src.title || (s.prefs.lang === 'ru' ? 'Без названия' : 'Untitled')} (${s.prefs.lang === 'ru' ? 'копия' : 'copy'})`,
          order: src.order + 0.5,
        });
      },
      deleteDoc: (id) => {
        const s = get();
        // Delete the page with all nested sub-pages.
        const ids = new Set<ID>([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const d of Object.values(s.docs)) {
            if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
              ids.add(d.id);
              grew = true;
            }
          }
        }
        const commentIds = Object.values(s.comments)
          .filter((c) => c.targetKind === 'doc' && ids.has(c.targetId))
          .map((c) => c.id);
        const snap: Snapshot = { docs: pick(s.docs, ids), comments: pick(s.comments, commentIds) };
        set({ docs: omit(s.docs, ids), comments: omit(s.comments, commentIds) });
        return snap;
      },

      createFolder: (patch) => {
        const id = uid('fd');
        const ts = nowIso();
        const node: FileNode = { id, kind: 'folder', createdAt: ts, updatedAt: ts, ...patch };
        set((s) => ({ files: { ...s.files, [id]: node } }));
        return id;
      },
      createLink: (patch) => {
        const id = uid('ln');
        const ts = nowIso();
        const node: FileNode = { id, kind: 'link', createdAt: ts, updatedAt: ts, ...patch };
        set((s) => ({ files: { ...s.files, [id]: node } }));
        return id;
      },
      addFile: (node) => set((s) => ({ files: { ...s.files, [node.id]: node } })),
      updateNode: (id, patch) => set((s) => (s.files[id] ? { files: { ...s.files, [id]: { ...s.files[id], ...patch, updatedAt: nowIso() } } } : {})),
      moveNodes: (ids, parentId, projectId) =>
        set((s) => {
          // A folder can't be moved into itself or one of its sub-folders.
          const blocked = new Set<ID>();
          let cursor = parentId;
          while (cursor) {
            blocked.add(cursor);
            cursor = s.files[cursor]?.parentId;
          }
          const files = { ...s.files };
          const ts = nowIso();
          const moveTree = (id: ID) => {
            // Children follow their folder into another drive.
            for (const n of Object.values(files))
              if (n.parentId === id) {
                files[n.id] = { ...n, projectId };
                moveTree(n.id);
              }
          };
          for (const id of ids) {
            const n = files[id];
            if (!n || blocked.has(id)) continue;
            files[id] = { ...n, parentId, projectId, updatedAt: ts };
            if (n.kind === 'folder' && n.projectId !== projectId) moveTree(id);
          }
          return { files };
        }),
      deleteNodes: (ids) => {
        const s = get();
        const all = new Set<ID>(ids);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of Object.values(s.files)) {
            if (n.parentId && all.has(n.parentId) && !all.has(n.id)) {
              all.add(n.id);
              grew = true;
            }
          }
        }
        set({ files: omit(s.files, all) });
        return { files: pick(s.files, all) };
      },

      setMap: (projectId, map) => set((s) => ({ maps: { ...s.maps, [projectId]: { ...map, updatedAt: nowIso() } } })),

      addComment: (targetKind, targetId, text, mentions = []) => {
        const id = uid('cm');
        const ts = nowIso();
        const s = get();
        const mentioned = [...new Set(mentions)].filter((p) => s.people[p]);
        const c: Comment = { id, targetKind, targetId, text, authorId: s.meId, createdAt: ts, ...(mentioned.length ? { mentions: mentioned } : {}) };
        const target = targetKind === 'item' ? s.items[targetId] : s.docs[targetId];
        const excerpt = text.length > 160 ? `${text.slice(0, 157)}…` : text;
        const base = { targetKind, targetId, projectId: target?.projectId, text: excerpt };
        const followers = new Set<ID>();
        if (targetKind === 'item' && s.items[targetId]?.assigneeId) followers.add(s.items[targetId].assigneeId!);
        if (target?.createdBy) followers.add(target.createdBy);
        for (const other of Object.values(s.comments)) if (other.targetId === targetId) followers.add(other.authorId);
        for (const p of mentioned) followers.delete(p);
        const notifications = notifyAll(
          s,
          [
            ...mentioned.map((recipientId) => ({ ...base, kind: 'mention' as const, recipientId })),
            ...[...followers].map((recipientId) => ({ ...base, kind: 'comment' as const, recipientId })),
          ],
          ts,
        );
        set((st) => ({ comments: { ...st.comments, [id]: c }, ...(notifications ? { notifications } : {}) }));
        return id;
      },
      updateComment: (id, text) =>
        set((s) => (s.comments[id] ? { comments: { ...s.comments, [id]: { ...s.comments[id], text, editedAt: nowIso() } } } : {})),
      deleteComment: (id) => set((s) => ({ comments: omit(s.comments, [id]) })),

      createSprint: (projectId, patch = {}) => {
        const s = get();
        const id = uid('sp');
        const ts = nowIso();
        const siblings = Object.values(s.sprints)
          .filter((sp) => sp.projectId === projectId)
          .sort((a, b) => a.endDate.localeCompare(b.endDate));
        const last = siblings.at(-1);
        const today = todayIso();
        const startDate = patch.startDate ?? (last && last.endDate >= today ? addDays(last.endDate, 1) : today);
        const sprint: Sprint = {
          id,
          projectId,
          name: `${s.prefs.lang === 'ru' ? 'Спринт' : 'Sprint'} ${siblings.length + 1}`,
          startDate,
          endDate: addDays(startDate, 13),
          status: 'planned',
          createdAt: ts,
          updatedAt: ts,
          ...patch,
        };
        set((st) => ({ sprints: { ...st.sprints, [id]: sprint } }));
        return id;
      },
      updateSprint: (id, patch) =>
        set((s) => (s.sprints[id] ? { sprints: { ...s.sprints, [id]: { ...s.sprints[id], ...patch, updatedAt: nowIso() } } } : {})),
      startSprint: (id) =>
        set((s) => {
          const sprint = s.sprints[id];
          if (!sprint || sprint.status !== 'planned') return {};
          if (Object.values(s.sprints).some((sp) => sp.projectId === sprint.projectId && sp.status === 'active')) return {};
          const ts = nowIso();
          const today = todayIso();
          const length = Math.max(0, Math.round((new Date(sprint.endDate).getTime() - new Date(sprint.startDate).getTime()) / 86400000));
          const startDate = sprint.startDate > today ? today : sprint.startDate;
          const endDate = sprint.startDate > today ? addDays(today, length) : sprint.endDate;
          const assignees = new Set(
            Object.values(s.items)
              .filter((i) => i.sprintId === id && i.assigneeId)
              .map((i) => i.assigneeId!),
          );
          const notifications = notifyAll(
            s,
            [...assignees].map((recipientId) => ({
              kind: 'sprint' as const,
              recipientId,
              targetKind: 'project' as const,
              targetId: sprint.projectId,
              projectId: sprint.projectId,
              text: sprint.name,
            })),
            ts,
          );
          return {
            sprints: { ...s.sprints, [id]: { ...sprint, status: 'active', startDate, endDate, updatedAt: ts } },
            ...(notifications ? { notifications } : {}),
          };
        }),
      completeSprint: (id, carryOver) => {
        const s = get();
        const sprint = s.sprints[id];
        if (!sprint || sprint.status === 'completed') return undefined;
        const ts = nowIso();
        const inSprint = Object.values(s.items).filter((i) => i.sprintId === id);
        const open = inSprint.filter((i) => i.status !== 'done' && i.status !== 'canceled');
        let nextId: ID | undefined;
        if (carryOver === 'next') {
          nextId = Object.values(s.sprints)
            .filter((sp) => sp.projectId === sprint.projectId && sp.status === 'planned')
            .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]?.id;
          if (!nextId)
            nextId = get().createSprint(sprint.projectId, { startDate: addDays(sprint.endDate > todayIso() ? todayIso() : sprint.endDate, 1) });
        }
        set((st) => {
          const items = { ...st.items };
          for (const it of open) items[it.id] = { ...items[it.id], sprintId: nextId, updatedAt: ts };
          return {
            items,
            sprints: {
              ...st.sprints,
              [id]: { ...sprint, status: 'completed', completedAt: ts, completedCount: inSprint.length - open.length, updatedAt: ts },
            },
          };
        });
        return nextId;
      },
      deleteSprint: (id) => {
        const s = get();
        const linked = Object.values(s.items).filter((i) => i.sprintId === id);
        const snap: Snapshot = {
          sprints: pick(s.sprints, [id]),
          items: pick(
            s.items,
            linked.map((i) => i.id),
          ),
        };
        const items = { ...s.items };
        for (const it of linked) items[it.id] = { ...it, sprintId: undefined };
        set({ sprints: omit(s.sprints, [id]), items });
        return snap;
      },

      markNotifications: (ids, read) =>
        set((s) => {
          const ts = nowIso();
          const notifications = { ...s.notifications };
          let changed = false;
          for (const id of ids) {
            const n = notifications[id];
            if (!n || n.recipientId !== s.meId || !!n.readAt === read) continue;
            const next = { ...n };
            if (read) next.readAt = ts;
            else delete next.readAt;
            notifications[id] = next;
            changed = true;
          }
          return changed ? { notifications } : {};
        }),
      archiveNotifications: (ids, archived) =>
        set((s) => {
          const ts = nowIso();
          const notifications = { ...s.notifications };
          for (const id of ids) {
            const n = notifications[id];
            if (!n || n.recipientId !== s.meId) continue;
            const next = { ...n, readAt: n.readAt ?? ts };
            if (archived) next.archivedAt = ts;
            else delete next.archivedAt;
            notifications[id] = next;
          }
          return { notifications };
        }),

      pushTrash: (kind, title, icon, snapshot) => {
        const id = uid('tr');
        const entry: TrashEntry = { id, kind, title, icon, snapshot, deletedAt: nowIso() };
        set((s) => ({ trash: [entry, ...s.trash].slice(0, 200) }));
        return id;
      },
      restoreTrash: (entryId) => {
        const entry = get().trash.find((e) => e.id === entryId);
        if (!entry) return;
        get().restore(entry.snapshot as Snapshot);
        set((s) => ({ trash: s.trash.filter((e) => e.id !== entryId) }));
      },
      purgeTrash: (entryId) => set((s) => ({ trash: s.trash.filter((e) => e.id !== entryId) })),
      emptyTrash: () => set({ trash: [] }),
      pruneTrash: () =>
        set((s) => {
          const cutoff = Date.now() - TRASH_TTL_DAYS * 86400000;
          const trash = s.trash.filter((e) => new Date(e.deletedAt).getTime() > cutoff);
          return trash.length === s.trash.length ? {} : { trash };
        }),

      setPlaneConfig: (patch) => set((s) => ({ plane: { ...s.plane, config: { ...s.plane.config, ...patch } } })),
      setPlaneSnapshot: (projectId, snap) =>
        set((s) => {
          const snapshots = { ...s.plane.snapshots };
          if (snap) snapshots[projectId] = snap;
          else delete snapshots[projectId];
          return { plane: { ...s.plane, snapshots } };
        }),
      applyPlaneStates: (projectId) =>
        set((s) => {
          const snap = s.plane.snapshots[projectId];
          if (!snap) return {};
          const states = new Map(snap.states.map((st) => [st.id, st]));
          const issues = new Map(snap.issues.map((i) => [i.id, i]));
          const items = { ...s.items };
          const ts = nowIso();
          const acts: Activity[] = [];
          for (const it of Object.values(items)) {
            if (it.projectId !== projectId || !it.plane) continue;
            const issue = issues.get(it.plane.issueId);
            if (!issue) continue;
            const st = issue.stateId ? states.get(issue.stateId) : undefined;
            const next: Item = {
              ...it,
              plane: {
                ...it.plane,
                stateName: st?.name,
                stateGroup: st?.group,
                stateColor: st?.color,
                syncedAt: ts,
              },
            };
            if (s.plane.config.autoStatus && st) {
              const mapped = PLANE_GROUP_TO_STATUS[st.group];
              if (mapped && mapped !== it.status) {
                next.status = mapped;
                next.completedAt = mapped === 'done' ? ts : undefined;
                next.updatedAt = ts;
                acts.push({ id: uid('ac'), itemId: it.id, actorId: 'plane', kind: 'status', from: it.status, to: mapped, at: ts });
              }
            }
            items[it.id] = next;
          }
          return { items, activity: withActivity(s.activity, acts) };
        }),

      setAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),

      restore: (snap) =>
        set((s) => ({
          groups: { ...s.groups, ...(snap.groups ?? {}) },
          projects: { ...s.projects, ...(snap.projects ?? {}) },
          items: { ...s.items, ...(snap.items ?? {}) },
          docs: { ...s.docs, ...(snap.docs ?? {}) },
          files: { ...s.files, ...(snap.files ?? {}) },
          maps: { ...s.maps, ...(snap.maps ?? {}) },
          sprints: { ...s.sprints, ...(snap.sprints ?? {}) },
          comments: { ...s.comments, ...(snap.comments ?? {}) },
        })),
    }),
    {
      name: 'done:workspace',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => idbStateStorage),
      migrate: (persisted, version) => {
        const data = persisted as Partial<DataState>;
        if (version < 2) {
          data.groups ??= {};
          data.comments ??= {};
          data.activity ??= [];
          data.trash ??= [];
        }
        if (version < 3) {
          // Meetings were replaced by the file system: old uploads become plain files.
          delete (data as Record<string, unknown>).meetings;
          const files: Record<ID, FileNode> = {};
          for (const f of Object.values((data.files ?? {}) as unknown as Record<ID, Record<string, unknown>>)) {
            const id = String(f.id);
            files[id] = {
              id,
              kind: 'file',
              projectId: f.projectId as ID | undefined,
              name: String(f.name ?? ''),
              size: Number(f.size ?? 0),
              mime: String(f.mime ?? ''),
              createdAt: String(f.createdAt ?? nowIso()),
              updatedAt: String(f.createdAt ?? nowIso()),
            };
          }
          data.files = files;
          data.trash = (data.trash ?? []).filter((e) => (e.kind as string) !== 'meeting');
          data.prefs = data.prefs && { ...data.prefs, favorites: data.prefs.favorites.filter((f) => (f.kind as string) !== 'meeting') };
        }
        if (version < 4) {
          data.sprints ??= {};
          data.notifications ??= {};
        }
        return data as DataState;
      },
      partialize: (s) => {
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s)) if (typeof v !== 'function') data[k] = v;
        return data as unknown as DataState;
      },
    },
  ),
);

export function dataSnapshot(): DataState {
  const s = useData.getState();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (typeof v !== 'function') out[k] = v;
  return out as unknown as DataState;
}

export function isDataState(x: unknown): x is DataState {
  if (!x || typeof x !== 'object') return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.schema === 'number' &&
    typeof d.projects === 'object' &&
    typeof d.items === 'object' &&
    typeof d.people === 'object' &&
    typeof d.prefs === 'object'
  );
}

// Keep permission checks at the action boundary so every view follows the same policy.
const guardedActions = Object.fromEntries(
  Object.entries(useData.getState())
    .filter(
      ([key, value]) =>
        typeof value === 'function' &&
        ![
          'replaceAll',
          'setPrefs',
          'setExpanded',
          'toggleFavorite',
          'touchRecent',
          'setAi',
          'setPlaneConfig',
          'setPlaneSnapshot',
          'pruneTrash',
          'markNotifications',
          'archiveNotifications',
        ].includes(key),
    )
    .map(([key, action]) => [
      key,
      (...args: unknown[]) => (allowMutation(key, args) ? (action as (...values: unknown[]) => unknown)(...args) : undefined),
    ]),
);
useData.setState(guardedActions);
