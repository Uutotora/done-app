import { useMemo, type ReactNode } from 'react';
import { ChevronDown, FilePlus2, LayoutTemplate, Settings2 } from 'lucide-react';
import { useData } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { templatesFor } from '@/lib/templates';
import type { ID } from '@/lib/types';
import { cn } from '@/lib/utils';
import { EntriesMenu, type MenuEntry } from '../ui/Overlay';
import { PageIcon } from '../ui/bits';
import { openTemplatesDialog } from './TemplatesDialog';

/**
 * Template choices for a new task: a blank task, the project's templates, the shared ones and a
 * link to the template manager. `selected` marks the current choice (undefined = blank task).
 */
export function TemplateMenu({
  projectId,
  selected,
  onPick,
  trigger,
  align = 'end',
  marks = true,
}: {
  projectId?: ID;
  selected?: ID;
  onPick: (templateId?: ID) => void;
  trigger: ReactNode;
  align?: 'start' | 'center' | 'end';
  /** Tick the current choice; off for menus that create right away. */
  marks?: boolean;
}) {
  const t = useT();
  const templates = useData((s) => s.templates);
  const list = useMemo(() => templatesFor(templates, projectId), [templates, projectId]);
  const entries: MenuEntry[] = [
    { key: 'h', heading: t('template.menu') },
    { key: 'blank', icon: <FilePlus2 size={15} />, label: t('create.blank'), checked: marks && !selected, onSelect: () => onPick(undefined) },
    ...list.map<MenuEntry>((tpl) => ({
      key: tpl.id,
      icon: tpl.icon ? <PageIcon icon={tpl.icon} size={15} /> : <LayoutTemplate size={15} />,
      label: tpl.name || t('template.untitled'),
      checked: marks && selected === tpl.id,
      onSelect: () => onPick(tpl.id),
    })),
    { key: 's', separator: true },
    { key: 'manage', icon: <Settings2 size={15} />, label: t('template.manage'), onSelect: () => openTemplatesDialog(projectId) },
  ];
  return <EntriesMenu align={align} entries={entries} trigger={trigger} />;
}

/** The "New ▾" button of Notion databases: the main part creates a blank task, the arrow offers templates. */
export function NewWithTemplates({ projectId, onCreate, children }: { projectId?: ID; onCreate: (templateId?: ID) => void; children: ReactNode }) {
  const t = useT();
  const part = 'flex h-7 items-center bg-accent text-white transition-colors hover:bg-accent-hover';
  return (
    <div className="ml-1 flex shrink-0 overflow-hidden rounded-md shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]">
      <button onClick={() => onCreate()} className={cn(part, 'gap-1 pl-2.5 pr-2 text-[14px] font-medium active:scale-[0.98]')}>
        {children}
      </button>
      <TemplateMenu
        projectId={projectId}
        onPick={(id) => onCreate(id)}
        marks={false}
        trigger={
          <button aria-label={t('template.choose')} className={cn(part, 'border-l border-white/25 px-1.5')}>
            <ChevronDown size={14} />
          </button>
        }
      />
    </div>
  );
}
