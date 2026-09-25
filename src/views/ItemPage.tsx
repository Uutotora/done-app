import { useParams } from 'react-router';
import { useData } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { Topbar } from '@/components/Topbar';
import { ItemDetail } from '@/components/ItemDetail';
import { EntriesMenu } from '@/components/ui/Overlay';
import { IconButton } from '@/components/ui/Button';
import { itemMenuEntries } from '@/components/itemMenu';
import { MoreHorizontal } from 'lucide-react';
import { NotFound } from './NotFound';

export default function ItemPage() {
  const t = useT();
  const { itemId } = useParams();
  const item = useData((s) => (itemId ? s.items[itemId] : undefined));
  const project = useData((s) => (item ? s.projects[item.projectId] : undefined));
  const parent = useData((s) => (item?.parentId ? s.items[item.parentId] : undefined));
  if (!item) return <NotFound />;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Topbar
        crumbs={[
          ...(project ? [{ label: project.name, icon: project.icon, to: `/p/${project.id}/backlog` }] : []),
          ...(parent ? [{ label: parent.title, to: `/items/${parent.id}` }] : []),
          { label: item.title || t('common.untitled') },
        ]}
        actions={
          <EntriesMenu
            align="end"
            entries={itemMenuEntries(item)}
            trigger={
              <IconButton size="md" label={t('common.more')}>
                <MoreHorizontal size={17} />
              </IconButton>
            }
          />
        }
      />
      <ItemDetail item={item} variant="page" />
    </div>
  );
}
