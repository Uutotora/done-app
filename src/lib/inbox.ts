import { useMemo } from 'react';
import { useData } from './store';
import { translate } from './i18n';
import type { AppNotification, DataState, ItemType, Lang } from './types';

/** Notifications addressed to the current member, newest first. */
export function useMyNotifications(): AppNotification[] {
  const all = useData((s) => s.notifications);
  const meId = useData((s) => s.meId);
  return useMemo(
    () =>
      Object.values(all)
        .filter((n) => n.recipientId === meId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [all, meId],
  );
}

export function unreadCount(s: Pick<DataState, 'notifications' | 'meId'>): number {
  let count = 0;
  for (const n of Object.values(s.notifications)) if (n.recipientId === s.meId && !n.readAt && !n.archivedAt) count++;
  return count;
}

export function useUnreadCount(): number {
  return useData(unreadCount);
}

export interface NotificationTarget {
  title: string;
  exists: boolean;
  icon?: string;
  itemType?: ItemType;
  path: string;
  /** Tasks open in the side peek instead of navigating away. */
  peekItemId?: string;
}

export function notificationTarget(n: AppNotification, s: DataState, lang: Lang): NotificationTarget {
  if (n.targetKind === 'item') {
    const item = s.items[n.targetId];
    return item
      ? { title: item.title, exists: true, itemType: item.type, path: `/items/${item.id}`, peekItemId: item.id }
      : { title: translate(lang, 'inbox.deleted'), exists: false, path: '/inbox' };
  }
  if (n.targetKind === 'doc') {
    const doc = s.docs[n.targetId];
    return doc
      ? { title: doc.title || translate(lang, 'common.untitled'), exists: true, icon: doc.icon ?? '📄', path: `/docs/${doc.id}` }
      : { title: translate(lang, 'inbox.deleted'), exists: false, path: '/inbox' };
  }
  const project = s.projects[n.targetId];
  return project
    ? {
        title: project.name || translate(lang, 'project.untitled'),
        exists: true,
        icon: project.icon,
        path: `/p/${project.id}/${n.kind === 'sprint' ? 'sprints' : 'overview'}`,
      }
    : { title: translate(lang, 'inbox.deleted'), exists: false, path: '/inbox' };
}

/** Short sentence for the notification without the actor, e.g. "Assigned you". */
export function notificationHeadline(n: AppNotification, lang: Lang): string {
  switch (n.kind) {
    case 'assigned':
      return translate(lang, 'inbox.kind.assigned');
    case 'mention':
      return translate(lang, 'inbox.kind.mention');
    case 'comment':
      return translate(lang, 'inbox.kind.comment');
    case 'status':
      return translate(lang, 'inbox.kind.status', {
        status: n.text ? translate(lang, `status.${n.text}` as Parameters<typeof translate>[1]) : '',
      });
    case 'sprint':
      return translate(lang, 'inbox.kind.sprint', { name: n.text ?? '' });
  }
}
