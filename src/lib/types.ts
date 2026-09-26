export type ID = string;
/** Calendar date without time, `yyyy-MM-dd`. */
export type ISODate = string;
/** Full timestamp, ISO 8601. */
export type ISODateTime = string;

export type Lang = 'ru' | 'en';
export type ThemePref = 'light' | 'dark' | 'system';

/** Notion palette. Every tinted surface in the app picks one of these. */
export type ColorName = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

/** Emoji character, or `icon:<lucide-name>:<color>` for a monochrome icon. */
export type IconValue = string;

export interface Cover {
  kind: 'gradient' | 'color';
  value: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type ProjectAccessLevel = 'viewer' | 'commenter' | 'editor';

/** Access of a person in the local demo, where there are no accounts. Accounts keep this on the server. */
export interface LocalAccess {
  role: WorkspaceRole;
  projectIds: ID[] | null;
  projectRoles?: Record<ID, ProjectAccessLevel>;
  canCreateProjects?: boolean;
  suspended?: boolean;
}

export interface Person {
  id: ID;
  name: string;
  /** Job title shown under the name, e.g. "Design lead". */
  role?: string;
  color: ColorName;
  email?: string;
  /** Optional emoji avatar instead of initials. */
  avatar?: string;
  /** Left the workspace: kept so past work still shows who did it. */
  removed?: boolean;
  access?: LocalAccess;
  invitedAt?: ISODateTime;
}

/** A space that groups projects in the sidebar (like Notion teamspaces). */
export interface ProjectGroup {
  id: ID;
  name: string;
  icon: IconValue;
  order: number;
}

export type ProjectStatus = 'on_track' | 'at_risk' | 'off_track' | 'paused' | 'completed';

export interface PlaneProjectLink {
  projectId: string;
  identifier: string;
  name: string;
}

export interface Project {
  id: ID;
  name: string;
  icon: IconValue;
  color: ColorName;
  cover?: Cover;
  status: ProjectStatus;
  leadId?: ID;
  startDate?: ISODate;
  targetDate?: ISODate;
  summary?: string;
  /** BlockNote document for the project brief. */
  brief?: unknown[];
  plane?: PlaneProjectLink;
  groupId?: ID;
  order: number;
  archived?: boolean;
  /** Who created the project; creators may delete it without being admins. */
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type ItemType = 'initiative' | 'epic' | 'feature' | 'task' | 'bug' | 'milestone';
export type ItemStatus = 'idea' | 'backlog' | 'planned' | 'in_progress' | 'in_review' | 'done' | 'canceled';
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type Horizon = 'now' | 'next' | 'later';

export interface Rice {
  reach: number;
  /** 0.25 minimal, 0.5 low, 1 medium, 2 high, 3 massive */
  impact: number;
  /** 0..100 percent */
  confidence: number;
  /** person-months */
  effort: number;
}

export type PlaneStateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | 'triage';

export interface PlaneIssueRef {
  issueId: string;
  projectId: string;
  key: string;
  url?: string;
  stateName?: string;
  stateGroup?: PlaneStateGroup;
  stateColor?: string;
  syncedAt?: ISODateTime;
  demo?: boolean;
}

export interface Item {
  id: ID;
  projectId: ID;
  type: ItemType;
  title: string;
  status: ItemStatus;
  priority: Priority;
  horizon?: Horizon;
  assigneeId?: ID;
  startDate?: ISODate;
  dueDate?: ISODate;
  estimate?: number;
  tags: string[];
  rice?: Rice;
  parentId?: ID;
  /** Tasks that must finish before this item can start. */
  dependsOn?: ID[];
  /** Sprint of the item's project the work is planned into. */
  sprintId?: ID;
  /** Person who created the item; gets updates about it in the inbox. */
  createdBy?: ID;
  order: number;
  content?: unknown[];
  plane?: PlaneIssueRef;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt?: ISODateTime;
}

export type DocFont = 'default' | 'serif' | 'mono';

export interface Doc {
  id: ID;
  projectId?: ID;
  parentId?: ID;
  title: string;
  icon?: IconValue;
  cover?: Cover;
  content?: unknown[];
  fullWidth?: boolean;
  smallText?: boolean;
  font?: DocFont;
  order: number;
  createdBy?: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type SprintStatus = 'planned' | 'active' | 'completed';

/** A time-boxed iteration of one project, like Notion sprints. */
export interface Sprint {
  id: ID;
  projectId: ID;
  name: string;
  goal?: string;
  startDate: ISODate;
  endDate: ISODate;
  status: SprintStatus;
  /** Number of items in the sprint when it was completed, for velocity. */
  completedCount?: number;
  completedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type NotificationKind = 'assigned' | 'mention' | 'comment' | 'status' | 'sprint';

/** One entry of a person's inbox. */
export interface AppNotification {
  id: ID;
  recipientId: ID;
  actorId: ID;
  kind: NotificationKind;
  targetKind: 'item' | 'doc' | 'project';
  targetId: ID;
  projectId?: ID;
  /** Comment excerpt, new status or sprint name, depending on the kind. */
  text?: string;
  createdAt: ISODateTime;
  readAt?: ISODateTime;
  archivedAt?: ISODateTime;
}

export type FileNodeKind = 'folder' | 'file' | 'link';

/**
 * One entry of the file system: a folder, an uploaded file (bytes live in
 * IndexedDB under the same id) or an external link, e.g. a Plaud recording.
 */
export interface FileNode {
  id: ID;
  kind: FileNodeKind;
  /** Undefined means the workspace-level drive. */
  projectId?: ID;
  /** Parent folder; undefined means the root of the drive. */
  parentId?: ID;
  name: string;
  size?: number;
  mime?: string;
  url?: string;
  note?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type MapNodeKind = 'goal' | 'item' | 'note' | 'risk' | 'person' | 'text';

export interface MapNode {
  id: ID;
  kind: MapNodeKind;
  x: number;
  y: number;
  text?: string;
  itemId?: ID;
  personId?: ID;
  color?: ColorName;
}

export interface MapEdge {
  id: ID;
  source: ID;
  target: ID;
  label?: string;
}

export interface ProjectMap {
  nodes: MapNode[];
  edges: MapEdge[];
  updatedAt: ISODateTime;
}

export interface PlaneConfig {
  baseUrl: string;
  webUrl: string;
  workspaceSlug: string;
  apiKey: string;
  autoStatus: boolean;
}

export interface PlaneIssueLite {
  id: string;
  name: string;
  sequenceId: number;
  stateId?: string;
  priority: Priority;
  startDate?: ISODate;
  targetDate?: ISODate;
  updatedAt?: ISODateTime;
}

export interface PlaneStateLite {
  id: string;
  name: string;
  color: string;
  group: PlaneStateGroup;
}

export interface PlaneCycleLite {
  id: string;
  name: string;
  startDate?: ISODate;
  endDate?: ISODate;
  total?: number;
  completed?: number;
}

export interface PlaneSnapshot {
  projectId: string;
  identifier: string;
  issues: PlaneIssueLite[];
  states: PlaneStateLite[];
  cycles: PlaneCycleLite[];
  syncedAt: ISODateTime;
  demo?: boolean;
}

export interface AiConfig {
  apiKey: string;
  model: string;
}

export type CommentTarget = 'item' | 'doc';

export interface Comment {
  id: ID;
  targetKind: CommentTarget;
  targetId: ID;
  authorId: ID;
  text: string;
  /** People mentioned with @ in the text. */
  mentions?: ID[];
  createdAt: ISODateTime;
  editedAt?: ISODateTime;
}

export type ActivityKind = 'created' | 'status' | 'priority' | 'assignee' | 'due' | 'title' | 'project' | 'parent' | 'plane' | 'type';

export interface Activity {
  id: ID;
  itemId: ID;
  actorId: ID;
  kind: ActivityKind;
  from?: string;
  to?: string;
  at: ISODateTime;
}

export type TrashKind = 'project' | 'item' | 'doc' | 'file' | 'group' | 'sprint';

export interface TrashEntry {
  id: ID;
  kind: TrashKind;
  title: string;
  icon?: IconValue;
  /** Everything removed by the delete, restorable as a unit. */
  snapshot: unknown;
  deletedAt: ISODateTime;
}

export type RefKind = 'project' | 'doc';
export interface Ref {
  kind: RefKind;
  id: ID;
}

export interface Prefs {
  theme: ThemePref;
  lang: Lang;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  favorites: Ref[];
  recent: (Ref & { at: ISODateTime })[];
  expanded: Record<string, boolean>;
}

export interface Workspace {
  name: string;
  icon: IconValue;
}

export interface DataState {
  schema: number;
  onboarded: boolean;
  workspace: Workspace;
  meId: ID;
  people: Record<ID, Person>;
  groups: Record<ID, ProjectGroup>;
  projects: Record<ID, Project>;
  items: Record<ID, Item>;
  docs: Record<ID, Doc>;
  files: Record<ID, FileNode>;
  maps: Record<ID, ProjectMap>;
  sprints: Record<ID, Sprint>;
  comments: Record<ID, Comment>;
  notifications: Record<ID, AppNotification>;
  activity: Activity[];
  trash: TrashEntry[];
  plane: { config: PlaneConfig; snapshots: Record<ID, PlaneSnapshot> };
  ai: AiConfig;
  prefs: Prefs;
}
