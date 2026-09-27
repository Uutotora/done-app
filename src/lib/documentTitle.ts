import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useData } from './store';
import { useUI } from './ui';
import { unreadCount } from './inbox';
import { translate, type TKey } from './i18n';
import type { DataState, ID } from './types';

/** Project tabs that get their own name in the title; the overview is just the project. */
const PROJECT_TABS = new Set(['roadmap', 'backlog', 'board', 'sprints', 'calendar', 'map', 'docs', 'files']);

/** Workspace-level pages named after their navigation entry. */
const SECTIONS: Record<string, TKey> = {
  inbox: 'nav.inbox',
  'my-work': 'nav.myWork',
  calendar: 'nav.calendar',
  roadmap: 'nav.roadmap',
  files: 'nav.files',
  settings: 'nav.settings',
};

export interface TitleSource {
  pathname: string;
  /** Item open in the side peek: it is what the person is looking at. */
  peekItemId?: ID;
  unread: number;
  data: Pick<DataState, 'projects' | 'items' | 'docs' | 'workspace'>;
  t: (key: TKey) => string;
}

/** Name of what is on screen, or undefined when nothing better than the app name exists. */
export function pageTitle({ pathname, peekItemId, data, t }: TitleSource): string | undefined {
  const named = (value: string | undefined, fallback: TKey) => value?.trim() || t(fallback);
  const itemTitle = (id: ID | undefined) => (id && data.items[id] ? named(data.items[id].title, 'common.untitled') : undefined);
  const peeked = itemTitle(peekItemId);
  if (peeked) return peeked;
  const [section = '', id, tab] = pathname.split('/').slice(1);
  if (!section) return data.workspace.name.trim() || undefined;
  if (SECTIONS[section]) return t(SECTIONS[section]);
  if (section === 'docs') return id && data.docs[id] ? named(data.docs[id].title, 'common.untitled') : undefined;
  if (section === 'items') return itemTitle(id);
  if (section === 'p') {
    const project = id ? data.projects[id] : undefined;
    if (!project) return undefined;
    const name = named(project.name, 'project.untitled');
    return tab && PROJECT_TABS.has(tab) ? `${t(`tab.${tab}` as TKey)} · ${name}` : name;
  }
  return undefined;
}

/** Browser tab title like Notion: `(3) Backlog · Apollo · Done`, the unread count only when there is one. */
export function documentTitle(source: TitleSource): string {
  const page = pageTitle(source);
  const app = source.t('app.name');
  const title = page ? `${page} · ${app}` : app;
  return source.unread > 0 ? `(${source.unread}) ${title}` : title;
}

/** Keeps `document.title` in step with the route, the side peek, renames, the language and the inbox. */
export function useDocumentTitle() {
  const { pathname } = useLocation();
  const peekItemId = useUI((s) => s.peekItemId);
  const title = useData((s) => documentTitle({ pathname, peekItemId, unread: unreadCount(s), data: s, t: (key) => translate(s.prefs.lang, key) }));
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(
    () => () => {
      document.title = translate(useData.getState().prefs.lang, 'app.name');
    },
    [],
  );
}
