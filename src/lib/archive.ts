import { matches } from './utils';
import type { DataState, ID, Project, ProjectGroup, Ref } from './types';

type Projects = Record<ID, Project>;

/** True when the project exists and sits in the archive. */
export const isArchivedProject = (projects: Projects, projectId: ID | undefined): boolean => !!projectId && !!projects[projectId]?.archived;

/** A favorite or recent entry that leads into an archived project (the project itself or one of its pages). */
export function refInArchive(ref: Ref, s: Pick<DataState, 'projects' | 'docs'>): boolean {
  const projectId = ref.kind === 'project' ? ref.id : s.docs[ref.id]?.projectId;
  return isArchivedProject(s.projects, projectId);
}

/** Archived projects, most recently archived first, filtered by name, summary or group name. */
export function archivedProjects(projects: Projects, groups: Record<ID, ProjectGroup>, query = ''): Project[] {
  const q = query.trim();
  return Object.values(projects)
    .filter((p) => p.archived && (!q || matches(`${p.name} ${p.summary ?? ''} ${(p.groupId && groups[p.groupId]?.name) || ''}`, q)))
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') || a.name.localeCompare(b.name));
}
