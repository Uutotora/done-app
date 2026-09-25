import type { ColorName, Cover, Horizon, ItemStatus, ItemType, Priority, ProjectStatus, PlaneStateGroup } from './types';

export const COLORS: ColorName[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export const ITEM_TYPES: ItemType[] = ['initiative', 'epic', 'feature', 'task', 'bug', 'milestone'];

export const TYPE_META: Record<ItemType, { icon: string; color: ColorName }> = {
  initiative: { icon: 'Target', color: 'purple' },
  epic: { icon: 'Layers', color: 'blue' },
  feature: { icon: 'Sparkles', color: 'green' },
  task: { icon: 'SquareCheck', color: 'gray' },
  bug: { icon: 'Bug', color: 'red' },
  milestone: { icon: 'Diamond', color: 'orange' },
};

export const STATUSES: ItemStatus[] = ['idea', 'backlog', 'planned', 'in_progress', 'in_review', 'done', 'canceled'];

export const STATUS_META: Record<ItemStatus, { color: ColorName; group: 'todo' | 'active' | 'closed' }> = {
  idea: { color: 'pink', group: 'todo' },
  backlog: { color: 'gray', group: 'todo' },
  planned: { color: 'blue', group: 'todo' },
  in_progress: { color: 'yellow', group: 'active' },
  in_review: { color: 'purple', group: 'active' },
  done: { color: 'green', group: 'closed' },
  canceled: { color: 'red', group: 'closed' },
};

export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
export const PRIORITY_COLOR: Record<Priority, ColorName> = {
  urgent: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'blue',
  none: 'gray',
};

export const HORIZONS: Horizon[] = ['now', 'next', 'later'];
export const HORIZON_COLOR: Record<Horizon, ColorName> = { now: 'green', next: 'blue', later: 'purple' };

export const PROJECT_STATUSES: ProjectStatus[] = ['on_track', 'at_risk', 'off_track', 'paused', 'completed'];
export const PROJECT_STATUS_COLOR: Record<ProjectStatus, ColorName> = {
  on_track: 'green',
  at_risk: 'yellow',
  off_track: 'red',
  paused: 'gray',
  completed: 'blue',
};

export const PLANE_GROUP_TO_STATUS: Partial<Record<PlaneStateGroup, ItemStatus>> = {
  backlog: 'backlog',
  unstarted: 'planned',
  started: 'in_progress',
  completed: 'done',
  cancelled: 'canceled',
};

export const PLANE_GROUP_COLOR: Record<PlaneStateGroup, ColorName> = {
  triage: 'gray',
  backlog: 'gray',
  unstarted: 'blue',
  started: 'yellow',
  completed: 'green',
  cancelled: 'red',
};

export const GRADIENTS: string[] = [
  'linear-gradient(120deg, #f6d365 0%, #fda085 100%)',
  'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)',
  'linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)',
  'linear-gradient(120deg, #fbc2eb 0%, #a6c1ee 100%)',
  'linear-gradient(120deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)',
  'linear-gradient(120deg, #cfd9df 0%, #e2ebf0 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'radial-gradient(circle at 20% 30%, #ffd6a5 0%, transparent 45%), radial-gradient(circle at 80% 60%, #bdb2ff 0%, transparent 50%), #fdffb6',
  'radial-gradient(circle at 10% 20%, #caffbf 0%, transparent 40%), radial-gradient(circle at 90% 80%, #9bf6ff 0%, transparent 50%), #a0c4ff',
  'radial-gradient(circle at 70% 20%, #ffadad 0%, transparent 45%), radial-gradient(circle at 20% 90%, #ffc6ff 0%, transparent 50%), #fffffc',
  'linear-gradient(160deg, #1f1c2c 0%, #928dab 100%)',
];

export const SOLID_COVERS: string[] = ['#e3e2e0', '#eee0da', '#fadec9', '#fdecc8', '#dbeddb', '#d3e5ef', '#e8deee', '#f5e0e9', '#ffe2dd'];

export function coverCss(cover?: Cover): string | undefined {
  if (!cover) return undefined;
  return cover.value;
}

export const PLANE_DEFAULTS = {
  baseUrl: 'https://api.plane.so',
  webUrl: 'https://app.plane.so',
};

export const AI_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];
export const DEFAULT_AI_MODEL = 'claude-opus-5';
