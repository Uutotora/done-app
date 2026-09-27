import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { FileText, FolderOpen, Globe2, LayoutTemplate, ListTree, MoreHorizontal, Plus, Repeat, SquarePen, Trash2, X } from 'lucide-react';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useT } from '@/lib/i18n';
import { projectLevel, useAuth } from '@/lib/auth';
import { deleteTemplateWithUndo } from '@/lib/actions';
import { sanitizeTemplate, templatesFor, TEMPLATE_SUBTASK_LIMIT } from '@/lib/templates';
import type { ID, ItemTemplate } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Dialog, EntriesMenu, type MenuEntry } from '../ui/Overlay';
import { Button, IconButton } from '../ui/Button';
import { PageIcon } from '../ui/bits';
import { IconPicker } from '../pickers/IconPicker';
import { PriorityPicker, TypePicker } from '../pickers/Pickers';
import { RecurrencePicker, recurrenceLabel } from '../pickers/RecurrencePicker';
import { PriorityIcon, TypeIcon } from '../pickers/icons';

const useTemplatesDialog = create<{ open: boolean; projectId?: ID }>(() => ({ open: false }));

/** Opens the template manager; templates of `projectId` are listed first. */
export const openTemplatesDialog = (projectId?: ID) => useTemplatesDialog.setState({ open: true, projectId });

/** Whether the signed-in person may change templates of a project (or shared ones, without a project). */
function useCanEditTemplates() {
  const auth = useAuth();
  return (projectId?: ID) => ['editor', 'full'].includes(projectLevel(projectId, auth) ?? '');
}

/** Compact manager of task templates, like Notion's database template list. */
export function TemplatesDialog() {
  const t = useT();
  const { open, projectId: scope } = useTemplatesDialog();
  const close = () => useTemplatesDialog.setState({ open: false });
  const templates = useData((s) => s.templates);
  const project = useData((s) => (scope ? s.projects[scope] : undefined));
  const projectId = project?.id;
  const canEdit = useCanEditTemplates();
  const [fresh, setFresh] = useState<ID>();

  const list = useMemo(() => templatesFor(templates, projectId), [templates, projectId]);
  const own = list.filter((tpl) => tpl.projectId);
  const shared = list.filter((tpl) => !tpl.projectId);
  // New templates go to the project the dialog was opened from; without one they are shared.
  const canAdd = canEdit(projectId);

  const add = () => {
    const id = useData.getState().createTemplate({ projectId, name: '' });
    if (id) setFresh(id);
  };
  const use = (tpl: ItemTemplate) => {
    close();
    useUI.getState().openCreateItem(projectId ?? tpl.projectId ? { projectId: projectId ?? tpl.projectId } : undefined, tpl.id);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} position="top" className="max-w-[600px]" title={t('template.title')}>
      <div className="flex max-h-[76vh] flex-col">
        <div className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">{t('template.title')}</div>
            <div className="mt-0.5 text-[13px] text-fg-3">{t('template.subtitle')}</div>
          </div>
          <IconButton size="md" label={t('common.close')} onClick={close}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-[120px] flex-1 overflow-y-auto px-3 pb-2">
          {list.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
              <LayoutTemplate size={26} className="text-fg-4" />
              <div className="text-[14px] font-medium text-fg-2">{t('template.empty')}</div>
              <div className="max-w-[360px] text-[13px] text-fg-3">{t('template.emptyHint')}</div>
            </div>
          )}
          {own.length > 0 && (
            <Section icon={project ? <PageIcon icon={project.icon} size={13} /> : <FolderOpen size={13} />} label={project?.name ?? t('template.scope.project')}>
              {own.map((tpl) => (
                <TemplateRow key={tpl.id} tpl={tpl} projectId={projectId} canEdit={canEdit} autoFocus={tpl.id === fresh} onUse={use} />
              ))}
            </Section>
          )}
          {shared.length > 0 && (
            <Section icon={<Globe2 size={13} />} label={t('template.scope.all')}>
              {shared.map((tpl) => (
                <TemplateRow key={tpl.id} tpl={tpl} projectId={projectId} canEdit={canEdit} autoFocus={tpl.id === fresh} onUse={use} />
              ))}
            </Section>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
          {canAdd ? (
            <Button variant="ghost" size="sm" icon={<Plus size={15} />} onClick={add}>
              {t('template.new')}
            </Button>
          ) : (
            <span className="px-2 text-[13px] text-fg-3">{t('template.viewOnly')}</span>
          )}
          <Button variant="secondary" size="sm" onClick={close}>
            {t('common.done')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="flex h-8 items-center gap-1.5 px-2 text-[12px] font-medium text-fg-3">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function TemplateRow({
  tpl,
  projectId,
  canEdit,
  autoFocus,
  onUse,
}: {
  tpl: ItemTemplate;
  projectId?: ID;
  canEdit: (projectId?: ID) => boolean;
  autoFocus?: boolean;
  onUse: (tpl: ItemTemplate) => void;
}) {
  const t = useT();
  const update = useData((s) => s.updateTemplate);
  const editable = canEdit(tpl.projectId);
  const [expanded, setExpanded] = useState(false);
  const count = tpl.subtasks?.length ?? 0;
  const set = (patch: Partial<ItemTemplate>) => update(tpl.id, patch);

  const menu: MenuEntry[] = [{ key: 'use', icon: <SquarePen size={15} />, label: t('template.use'), onSelect: () => onUse(tpl) }];
  if (editable) {
    // Moving between "this project" and "all projects" needs edit rights on both sides.
    if (projectId && (tpl.projectId ? canEdit(undefined) : canEdit(projectId)))
      menu.push({
        key: 'scope',
        icon: tpl.projectId ? <Globe2 size={15} /> : <FolderOpen size={15} />,
        label: tpl.projectId ? t('template.moveToAll') : t('template.moveToProject'),
        onSelect: () => set({ projectId: tpl.projectId ? undefined : projectId }),
      });
    menu.push(
      { key: 's', separator: true },
      { key: 'delete', icon: <Trash2 size={15} />, label: t('common.delete'), danger: true, onSelect: () => deleteTemplateWithUndo(tpl.id) },
    );
  }

  return (
    <div className="rounded-md hover:bg-hover/60">
      <div className="group flex h-9 items-center gap-1 px-1.5">
        {editable ? (
          <IconPicker value={tpl.icon} onChange={(icon) => set({ icon })}>
            <button aria-label={t('template.icon')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-hover">
              {tpl.icon ? <PageIcon icon={tpl.icon} size={16} /> : <LayoutTemplate size={15} className="text-fg-3" />}
            </button>
          </IconPicker>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center">
            {tpl.icon ? <PageIcon icon={tpl.icon} size={16} /> : <LayoutTemplate size={15} className="text-fg-3" />}
          </span>
        )}
        <NameInput value={tpl.name} disabled={!editable} autoFocus={autoFocus} onCommit={(name) => set({ name })} />
        {!!tpl.content?.length && (
          <span title={t('create.withDescription')} className="hidden shrink-0 px-1 text-fg-4 sm:inline-flex">
            <FileText size={14} />
          </span>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t('template.subtasks')}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12.5px] tabular-nums text-fg-3 hover:bg-hover',
            expanded && 'bg-hover text-fg-2',
          )}
        >
          <ListTree size={14} />
          {count}
        </button>
        <Picked editable={editable}>
          <TypePicker value={tpl.type} onChange={(type) => set({ type })} align="end">
            <button aria-label={t(`type.${tpl.type}`)} title={t(`type.${tpl.type}`)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover">
              <TypeIcon type={tpl.type} size={14} />
            </button>
          </TypePicker>
        </Picked>
        <Picked editable={editable}>
          <PriorityPicker value={tpl.priority} onChange={(priority) => set({ priority })} align="end">
            <button
              aria-label={t(`priority.${tpl.priority}`)}
              title={t(`priority.${tpl.priority}`)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover"
            >
              <PriorityIcon priority={tpl.priority} />
            </button>
          </PriorityPicker>
        </Picked>
        <Picked editable={editable}>
          <RecurrencePicker value={tpl.recurrence} onChange={(recurrence) => set({ recurrence })} align="end">
            <button
              aria-label={recurrenceLabel(t, tpl.recurrence) ?? t('prop.repeat')}
              title={recurrenceLabel(t, tpl.recurrence) ?? t('prop.repeat')}
              className={cn('flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover', tpl.recurrence ? 'text-fg-2' : 'text-fg-4')}
            >
              <Repeat size={14} />
            </button>
          </RecurrencePicker>
        </Picked>
        <EntriesMenu
          align="end"
          entries={menu}
          trigger={
            <button aria-label={t('common.more')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover">
              <MoreHorizontal size={16} />
            </button>
          }
        />
      </div>
      {expanded && <SubtaskEditor tpl={tpl} disabled={!editable} />}
    </div>
  );
}

/** Pickers stay clickable only for people who may change the template. */
function Picked({ editable, children }: { editable: boolean; children: React.ReactElement }) {
  return editable ? children : <span className="pointer-events-none opacity-60">{children}</span>;
}

function NameInput({ value, disabled, autoFocus, onCommit }: { value: string; disabled?: boolean; autoFocus?: boolean; onCommit: (v: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft.trim() !== value && onCommit(draft.trim());
  return (
    <input
      value={draft}
      disabled={disabled}
      autoFocus={autoFocus}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape' && draft !== value) {
          e.stopPropagation();
          setDraft(value);
        }
      }}
      placeholder={t('template.namePlaceholder')}
      className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[14px] outline-none placeholder:text-fg-4 focus:bg-hover disabled:text-fg-2"
    />
  );
}

/** Titles of the sub-tasks the template creates; empty lines are dropped when saved. */
function SubtaskEditor({ tpl, disabled }: { tpl: ItemTemplate; disabled?: boolean }) {
  const t = useT();
  const update = useData((s) => s.updateTemplate);
  const saved = tpl.subtasks ?? [];
  const [list, setList] = useState<string[]>(saved);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = useRef<number | undefined>(undefined);
  const clean = (titles: string[]) => sanitizeTemplate({ subtasks: titles }).subtasks ?? [];

  // Changes from elsewhere (another tab, undo) replace the list unless it already says the same.
  useEffect(() => {
    if (JSON.stringify(clean(list)) !== JSON.stringify(saved)) setList(saved);
    // Only when the saved titles change.
  }, [JSON.stringify(saved)]);
  useEffect(() => {
    if (focusAt.current === undefined) return;
    refs.current[focusAt.current]?.focus();
    focusAt.current = undefined;
  });

  const commit = (titles = list) => {
    if (JSON.stringify(clean(titles)) !== JSON.stringify(saved)) update(tpl.id, { subtasks: clean(titles) });
  };
  const insert = (at: number) => {
    if (list.length >= TEMPLATE_SUBTASK_LIMIT) return;
    focusAt.current = at;
    setList((l) => [...l.slice(0, at), '', ...l.slice(at)]);
  };
  const remove = (i: number) => {
    const next = list.filter((_, j) => j !== i);
    setList(next);
    commit(next);
  };

  return (
    <div className="pb-2 pl-10 pr-2">
      {list.map((title, i) => (
        <div key={i} className="group/sub flex h-8 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-4" />
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={title}
            disabled={disabled}
            maxLength={500}
            onChange={(e) => setList((l) => l.map((v, j) => (j === i ? e.target.value : v)))}
            onBlur={() => commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
                insert(i + 1);
              }
              if (e.key === 'Backspace' && !title && list.length > 0) {
                e.preventDefault();
                focusAt.current = Math.max(0, i - 1);
                remove(i);
              }
            }}
            placeholder={t('template.subtaskPlaceholder')}
            className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[13.5px] outline-none placeholder:text-fg-4 focus:bg-hover"
          />
          {!disabled && (
            <IconButton size="xs" label={t('template.removeSubtask')} onClick={() => remove(i)} className="opacity-0 group-hover/sub:opacity-100">
              <X size={13} />
            </IconButton>
          )}
        </div>
      ))}
      {!disabled && list.length < TEMPLATE_SUBTASK_LIMIT && (
        <button
          onClick={() => insert(list.length)}
          className="flex h-8 items-center gap-2 rounded-md px-0.5 text-[13px] text-fg-3 transition-colors hover:text-fg-2"
        >
          <Plus size={14} />
          {t('template.addSubtask')}
        </button>
      )}
      {disabled && !list.length && <div className="h-8 text-[13px] leading-8 text-fg-4">{t('prop.empty')}</div>}
    </div>
  );
}
