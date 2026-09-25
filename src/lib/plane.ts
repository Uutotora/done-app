import { useData } from './store';
import { translate } from './i18n';
import { blocksToText, escapeHtml, nowIso } from './utils';
import type { ID, Item, PlaneConfig, PlaneCycleLite, PlaneIssueLite, PlaneSnapshot, PlaneStateGroup, PlaneStateLite, Priority } from './types';

/**
 * Plane REST API client (https://developers.plane.so/api-reference).
 * All calls go through the Done proxy at /api/plane because Plane does not
 * allow browser CORS for API-key requests.
 */

export class PlaneError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

export function planeReady(cfg: PlaneConfig): boolean {
  return !!(cfg.apiKey.trim() && cfg.workspaceSlug.trim() && cfg.baseUrl.trim());
}

function errorText(json: unknown, text: string, status: number): string {
  if (json && typeof json === 'object') {
    const j = json as Json;
    for (const k of ['error', 'detail', 'message']) if (typeof j[k] === 'string') return j[k] as string;
  }
  if (status === 401 || status === 403) return 'Unauthorized: check the API key';
  if (status === 404) return 'Not found: check the workspace slug';
  return text.slice(0, 160) || `HTTP ${status}`;
}

export async function planeFetch<T = unknown>(cfg: PlaneConfig, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/plane${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-plane-base': cfg.baseUrl.trim().replace(/\/+$/, ''),
      'x-api-key': cfg.apiKey.trim(),
      'content-type': 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw new PlaneError(errorText(json, text, res.status), res.status);
  return json as T;
}

function results(json: unknown): Json[] {
  if (Array.isArray(json)) return json as Json[];
  if (json && typeof json === 'object' && Array.isArray((json as Json).results)) return (json as Json).results as Json[];
  return [];
}

/** Follows Plane's cursor pagination (`next_cursor` / `next_page_results`). */
async function paginate(cfg: PlaneConfig, path: string, maxPages = 20): Promise<Json[]> {
  const out: Json[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const json = await planeFetch<unknown>(cfg, `${path}${sep}per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...results(json));
    const j = json as Json | undefined;
    if (!j || Array.isArray(json) || !j.next_page_results || typeof j.next_cursor !== 'string') break;
    cursor = j.next_cursor;
  }
  return out;
}

const ws = (cfg: PlaneConfig) => `/api/v1/workspaces/${encodeURIComponent(cfg.workspaceSlug.trim())}`;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
function toPriority(v: unknown): Priority {
  return PRIORITIES.includes(v as Priority) ? (v as Priority) : 'none';
}

const GROUPS: PlaneStateGroup[] = ['backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage'];

export interface PlaneProjectInfo {
  id: string;
  name: string;
  identifier: string;
}

export async function listPlaneProjects(cfg: PlaneConfig): Promise<PlaneProjectInfo[]> {
  const rows = await paginate(cfg, `${ws(cfg)}/projects/`);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name ?? ''), identifier: String(r.identifier ?? '') }));
}

export async function listPlaneStates(cfg: PlaneConfig, projectId: string): Promise<PlaneStateLite[]> {
  const rows = await paginate(cfg, `${ws(cfg)}/projects/${projectId}/states/`);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    color: str(r.color) ?? '#9b9a97',
    group: GROUPS.includes(r.group as PlaneStateGroup) ? (r.group as PlaneStateGroup) : 'backlog',
  }));
}

export function toIssueLite(r: Json): PlaneIssueLite {
  const state = r.state;
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    sequenceId: Number(r.sequence_id ?? 0),
    stateId: typeof state === 'string' ? state : state && typeof state === 'object' ? str((state as Json).id) : str(r.state_id),
    priority: toPriority(r.priority),
    startDate: str(r.start_date)?.slice(0, 10),
    targetDate: str(r.target_date)?.slice(0, 10),
    updatedAt: str(r.updated_at),
  };
}

/** Plane renamed "issues" to "work items"; newer instances expose both paths. */
async function workItemsPath(cfg: PlaneConfig, projectId: string): Promise<string> {
  const modern = `${ws(cfg)}/projects/${projectId}/work-items/`;
  try {
    await planeFetch(cfg, `${modern}?per_page=1`);
    return modern;
  } catch (e) {
    if (e instanceof PlaneError && e.status === 404) return `${ws(cfg)}/projects/${projectId}/issues/`;
    throw e;
  }
}

export async function listPlaneIssues(cfg: PlaneConfig, projectId: string): Promise<PlaneIssueLite[]> {
  const path = await workItemsPath(cfg, projectId);
  const rows = await paginate(cfg, path, 10);
  return rows.map(toIssueLite);
}

export async function listPlaneCycles(cfg: PlaneConfig, projectId: string): Promise<PlaneCycleLite[]> {
  try {
    const rows = await paginate(cfg, `${ws(cfg)}/projects/${projectId}/cycles/`, 3);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      startDate: str(r.start_date)?.slice(0, 10),
      endDate: str(r.end_date)?.slice(0, 10),
      total: typeof r.total_issues === 'number' ? r.total_issues : undefined,
      completed: typeof r.completed_issues === 'number' ? r.completed_issues : undefined,
    }));
  } catch {
    // Cycles can be disabled per project; that should not fail the sync.
    return [];
  }
}

export function issueUrl(cfg: PlaneConfig, projectId: string, issueId: string): string {
  return `${cfg.webUrl.replace(/\/+$/, '')}/${cfg.workspaceSlug}/projects/${projectId}/issues/${issueId}`;
}

export function itemToIssuePayload(item: Item, lang: 'ru' | 'en'): Json {
  const text = blocksToText(item.content, 6000);
  const paragraphs = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('');
  const footer = `<p><em>${escapeHtml(translate(lang, 'plane.footer'))}</em></p>`;
  const payload: Json = {
    name: item.title,
    description_html: paragraphs + footer,
    priority: item.priority,
  };
  if (item.startDate) payload.start_date = item.startDate;
  if (item.dueDate) payload.target_date = item.dueDate;
  return payload;
}

/* ------------------------------ High level ops ----------------------------- */

export async function syncPlaneProject(projectId: ID): Promise<{ ok: boolean; message: string }> {
  const s = useData.getState();
  const lang = s.prefs.lang;
  const cfg = s.plane.config;
  const link = s.projects[projectId]?.plane;
  if (!planeReady(cfg)) return { ok: false, message: translate(lang, 'plane.notConfigured') };
  if (!link) return { ok: false, message: translate(lang, 'plane.notLinked') };
  try {
    const [states, issues, cycles] = await Promise.all([
      listPlaneStates(cfg, link.projectId),
      listPlaneIssues(cfg, link.projectId),
      listPlaneCycles(cfg, link.projectId),
    ]);
    const snap: PlaneSnapshot = { projectId: link.projectId, identifier: link.identifier, states, issues, cycles, syncedAt: nowIso() };
    s.setPlaneSnapshot(projectId, snap);
    // Items pushed earlier get fresh state names and (optionally) statuses.
    const st = useData.getState();
    const byId = new Map(issues.map((i) => [i.id, i]));
    for (const it of Object.values(st.items)) {
      if (it.projectId === projectId && it.plane?.demo && !byId.has(it.plane.issueId)) {
        st.updateItem(it.id, { plane: undefined });
      }
    }
    useData.getState().applyPlaneStates(projectId);
    return { ok: true, message: translate(lang, 'plane.synced', { n: issues.length }) };
  } catch (e) {
    return { ok: false, message: translate(lang, 'plane.error', { error: e instanceof Error ? e.message : String(e) }) };
  }
}

export async function pushItemsToPlane(itemIds: ID[]): Promise<{ ok: boolean; message: string; created: number }> {
  const s = useData.getState();
  const lang = s.prefs.lang;
  const cfg = s.plane.config;
  if (!planeReady(cfg)) return { ok: false, message: translate(lang, 'plane.notConfigured'), created: 0 };
  let created = 0;
  const errors: string[] = [];
  const pathCache = new Map<string, string>();
  for (const id of itemIds) {
    const item = useData.getState().items[id];
    if (!item || (item.plane && !item.plane.demo)) continue;
    const link = useData.getState().projects[item.projectId]?.plane;
    if (!link) {
      errors.push(translate(lang, 'plane.notLinked'));
      continue;
    }
    try {
      if (!pathCache.has(link.projectId)) pathCache.set(link.projectId, await workItemsPath(cfg, link.projectId));
      const raw = await planeFetch<Json>(cfg, pathCache.get(link.projectId)!, { method: 'POST', body: itemToIssuePayload(item, lang) });
      const issue = toIssueLite(raw);
      useData.getState().updateItem(id, {
        plane: {
          issueId: issue.id,
          projectId: link.projectId,
          key: `${link.identifier}-${issue.sequenceId}`,
          url: issueUrl(cfg, link.projectId, issue.id),
          syncedAt: nowIso(),
        },
      });
      created++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (errors.length && !created) return { ok: false, message: translate(lang, 'plane.error', { error: errors[0] }), created };
  return { ok: true, message: translate(lang, 'plane.pushed', { n: created }), created };
}
