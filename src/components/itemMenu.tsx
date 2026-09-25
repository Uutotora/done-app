import { Copy, ExternalLink, Flag, Link2, CircleDot, Send, Trash2, User, Compass } from 'lucide-react';
import { useData } from '@/lib/store';
import { toast, useUI } from '@/lib/ui';
import { translate } from '@/lib/i18n';
import { HORIZONS, HORIZON_COLOR, PRIORITIES, STATUSES } from '@/lib/constants';
import { deleteItemsWithUndo, setItemStatus } from '@/lib/actions';
import { planeReady, pushItemsToPlane } from '@/lib/plane';
import type { Item } from '@/lib/types';
import type { MenuEntry } from './ui/Overlay';
import { Avatar } from './ui/bits';
import { PriorityIcon, StatusIcon } from './pickers/icons';

/** The shared "..." / right-click menu for any item row or card. */
export function itemMenuEntries(item: Item): MenuEntry[] {
  const s = useData.getState();
  const lang = s.prefs.lang;
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(lang, k, v);
  const project = s.projects[item.projectId];
  const canPush = !item.plane && !!project?.plane && planeReady(s.plane.config);
  const entries: MenuEntry[] = [
    { key: 'open', icon: <ExternalLink size={15} />, label: t('item.openPeek'), onSelect: () => useUI.getState().openPeek(item.id) },
    { key: 's0', separator: true },
    {
      key: 'status',
      icon: <CircleDot size={15} />,
      label: t('item.setStatus'),
      children: STATUSES.map((st) => ({
        key: st,
        icon: <StatusIcon status={st} />,
        label: t(`status.${st}`),
        checked: item.status === st,
        onSelect: () => setItemStatus(item.id, st),
      })),
    },
    {
      key: 'priority',
      icon: <Flag size={15} />,
      label: t('item.setPriority'),
      children: PRIORITIES.map((p) => ({
        key: p,
        icon: <PriorityIcon priority={p} />,
        label: t(`priority.${p}`),
        checked: item.priority === p,
        onSelect: () => s.updateItem(item.id, { priority: p }),
      })),
    },
    {
      key: 'assignee',
      icon: <User size={15} />,
      label: t('item.assignTo'),
      children: [
        {
          key: 'none',
          icon: <Avatar size={16} />,
          label: t('prop.unassigned'),
          checked: !item.assigneeId,
          onSelect: () => s.updateItem(item.id, { assigneeId: undefined }),
        },
        ...Object.values(s.people).map<MenuEntry>((p) => ({
          key: p.id,
          icon: <Avatar person={p} size={16} />,
          label: p.name,
          checked: item.assigneeId === p.id,
          onSelect: () => useData.getState().updateItem(item.id, { assigneeId: p.id }),
        })),
      ],
    },
    {
      key: 'horizon',
      icon: <Compass size={15} />,
      label: t('prop.horizon'),
      children: [
        ...HORIZONS.map<MenuEntry>((h) => ({
          key: h,
          icon: <span data-color={HORIZON_COLOR[h]} className="tint-solid h-2 w-2 rounded-full" />,
          label: t(`horizon.${h}`),
          checked: item.horizon === h,
          onSelect: () => s.updateItem(item.id, { horizon: h }),
        })),
        { key: 'none', label: t('horizon.unsorted'), checked: !item.horizon, onSelect: () => s.updateItem(item.id, { horizon: undefined }) },
      ],
    },
    { key: 's1', separator: true },
    {
      key: 'dup',
      icon: <Copy size={15} />,
      label: t('item.duplicate'),
      onSelect: () => {
        const id = useData.getState().duplicateItem(item.id);
        if (id) toast({ message: t('item.duplicated'), action: { label: t('common.open'), run: () => useUI.getState().openPeek(id) } });
      },
    },
    {
      key: 'link',
      icon: <Link2 size={15} />,
      label: t('common.copyLink'),
      onSelect: () => {
        void navigator.clipboard?.writeText(`${window.location.origin}/items/${item.id}`);
        toast({ message: t('common.copied') });
      },
    },
  ];
  if (canPush) {
    entries.push({
      key: 'plane',
      icon: <Send size={15} />,
      label: t('item.pushToPlane'),
      onSelect: () => void pushItemsToPlane([item.id]).then((r) => toast({ message: r.message, tone: r.ok ? 'success' : 'error' })),
    });
  }
  entries.push(
    { key: 's2', separator: true },
    { key: 'delete', icon: <Trash2 size={15} />, label: t('common.delete'), danger: true, onSelect: () => deleteItemsWithUndo([item.id]) },
  );
  return entries;
}
