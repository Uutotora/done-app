import { CalendarDays, ChevronRight, CornerDownLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { useProjectsList } from '@/lib/selectors';
import { formatRange } from '@/lib/dates';
import type { Item } from '@/lib/types';
import { Dialog } from './ui/Overlay';
import { Avatar, Kbd, PageIcon, Switch } from './ui/bits';
import { Button } from './ui/Button';
import { PersonPicker, PriorityPicker, ProjectPicker, StatusPicker, TypePicker, ParentPicker } from './pickers/Pickers';
import { DatePicker } from './pickers/DatePicker';
import { PriorityIcon, StatusIcon, TypeIcon } from './pickers/icons';

type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'order'>;

export function CreateItemDialog() {
  const t = useT();
  const lang = useLang();
  const { open, defaults } = useUI((s) => s.createItem);
  const close = useUI((s) => s.closeCreateItem);
  const openPeek = useUI((s) => s.openPeek);
  const projects = useProjectsList();
  const people = useData((s) => s.people);
  const items = useData((s) => s.items);
  const createItem = useData((s) => s.createItem);
  const inputRef = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);

  const blank = (): Draft => ({
    projectId: defaults?.projectId ?? projects[0]?.id ?? '',
    type: 'task',
    title: '',
    status: 'backlog',
    priority: 'none',
    tags: [],
    ...defaults,
  });
  const [draft, setDraft] = useState<Draft>(blank);

  useEffect(() => {
    if (open) {
      setDraft(blank());
      setTimeout(() => inputRef.current?.focus(), 30);
    }
    // Reset the draft only when the dialog opens.
  }, [open]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const project = useData((s) => s.projects[draft.projectId]);

  const submit = () => {
    if (!draft.title.trim() || !draft.projectId) return;
    const id = createItem({ ...draft, title: draft.title.trim() });
    toast({
      message: t('item.created', { title: draft.title.trim() }),
      tone: 'success',
      action: { label: t('common.open'), run: () => openPeek(id) },
    });
    if (more) {
      setDraft((d) => ({ ...d, title: '' }));
      inputRef.current?.focus();
    } else close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} position="top" className="max-w-[640px]" title={t('create.title')}>
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT')) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="flex items-center gap-1.5 px-4 pt-4 text-[13px]">
          <ProjectPicker value={draft.projectId} onChange={(v) => v && set({ projectId: v, parentId: undefined })}>
            <button className="flex h-6 items-center gap-1.5 rounded-md border border-line-strong px-2 font-medium text-fg-2 hover:bg-hover">
              {project && <PageIcon icon={project.icon} size={14} />}
              <span className="max-w-[180px] truncate">{project?.name || t('prop.project')}</span>
            </button>
          </ProjectPicker>
          <ChevronRight size={14} className="text-fg-4" />
          <span className="text-fg-3">{t('create.title')}</span>
        </div>
        <div className="flex items-center gap-2 px-4 pb-2 pt-3">
          <TypePicker value={draft.type} onChange={(v) => set({ type: v })}>
            <button className="rounded-md p-1 hover:bg-hover">
              <TypeIcon type={draft.type} size={18} />
            </button>
          </TypePicker>
          <input
            ref={inputRef}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={t('create.placeholder')}
            className="h-10 flex-1 bg-transparent text-[20px] font-semibold outline-none placeholder:text-fg-4"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4">
          <StatusPicker value={draft.status} onChange={(v) => set({ status: v })}>
            <PropButton icon={<StatusIcon status={draft.status} />}>{t(`status.${draft.status}`)}</PropButton>
          </StatusPicker>
          <PriorityPicker value={draft.priority} onChange={(v) => set({ priority: v })}>
            <PropButton icon={<PriorityIcon priority={draft.priority} />}>{t(`priority.${draft.priority}`)}</PropButton>
          </PriorityPicker>
          <PersonPicker value={draft.assigneeId} onChange={(v) => set({ assigneeId: v })}>
            <PropButton icon={<Avatar person={draft.assigneeId ? people[draft.assigneeId] : undefined} size={16} />}>
              {draft.assigneeId ? people[draft.assigneeId]?.name : t('prop.assignee')}
            </PropButton>
          </PersonPicker>
          <DatePicker start={draft.startDate} end={draft.dueDate} onChange={(s, e) => set({ startDate: s, dueDate: e })}>
            <PropButton icon={<CalendarDays size={14} />}>
              {draft.dueDate ? formatRange(draft.startDate, draft.dueDate, lang) : t('prop.due')}
            </PropButton>
          </DatePicker>
          {draft.projectId && (
            <ParentPicker projectId={draft.projectId} value={draft.parentId} onChange={(v) => set({ parentId: v })}>
              <PropButton icon={draft.parentId && items[draft.parentId] ? <TypeIcon type={items[draft.parentId].type} size={14} /> : undefined}>
                {draft.parentId ? items[draft.parentId]?.title : t('prop.parent')}
              </PropButton>
            </ParentPicker>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            <Switch checked={more} onChange={setMore} label={t('create.more')} />
            {t('create.more')}
          </label>
          <div className="flex items-center gap-2">
            <span className="hidden text-[12px] text-fg-3 sm:inline">{t('create.hint')}</span>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={!draft.title.trim()}
              iconRight={
                <Kbd className="border-white/30 text-white/80">
                  <CornerDownLeft size={11} />
                </Kbd>
              }
            >
              {t('create.submit')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function PropButton({ icon, children, ...rest }: { icon?: React.ReactNode; children: React.ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button
      {...rest}
      className="flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border border-line-strong px-2 text-[13px] text-fg-2 transition-colors hover:bg-hover"
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}
