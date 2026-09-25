import {
  CalendarDays,
  CircleDot,
  ExternalLink,
  Flag,
  Gauge,
  GitBranch,
  Hash,
  Layers,
  Plus,
  Send,
  Tag,
  User,
  Hourglass,
  Compass,
  FolderOpen,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useData } from '@/lib/store';
import { useUI, toast } from '@/lib/ui';
import { useLang, useT } from '@/lib/i18n';
import { formatRange } from '@/lib/dates';
import { formatScore, riceScore } from '@/lib/rice';
import { HORIZON_COLOR, PLANE_GROUP_COLOR } from '@/lib/constants';
import { setItemStatus } from '@/lib/actions';
import { pushItemsToPlane, planeReady } from '@/lib/plane';
import type { ID, Item } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AutoTextarea, Avatar, Chip, DoneCheck, PageIcon, Progress } from './ui/bits';
import { Button } from './ui/Button';
import { Editor } from './Editor';
import { Comments } from './Comments';
import { ActivityLog } from './ActivityLog';
import {
  HorizonPicker,
  ParentPicker,
  PersonPicker,
  PriorityPicker,
  ProjectPicker,
  StatusPicker,
  TagChip,
  TagPicker,
  TypePicker,
} from './pickers/Pickers';
import { DatePicker } from './pickers/DatePicker';
import { RicePicker } from './pickers/RicePicker';
import { PriorityIcon, StatusIcon, TypeIcon } from './pickers/icons';
import { descendantsOf, progressOf } from '@/lib/selectors';

/** Full item editor. Used in the side peek and on the standalone item page. */
export function ItemDetail({ item, variant = 'peek' }: { item: Item; variant?: 'peek' | 'page' }) {
  const t = useT();
  const lang = useLang();
  const update = useData((s) => s.updateItem);
  const people = useData((s) => s.people);
  const items = useData((s) => s.items);
  const project = useData((s) => s.projects[item.projectId]);
  const openPeek = useUI((s) => s.openPeek);
  const planeOk = useData((s) => planeReady(s.plane.config));
  const [pushing, setPushing] = useState(false);

  const set = (patch: Partial<Item>) => update(item.id, patch);
  const children = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.parentId === item.id)
        .sort((a, b) => a.order - b.order),
    [items, item.id],
  );
  const allDesc = useMemo(() => descendantsOf(item.id, Object.values(items)), [items, item.id]);
  const prog = progressOf(allDesc);
  const score = riceScore(item.rice);
  const parent = item.parentId ? items[item.parentId] : undefined;

  const push = async () => {
    setPushing(true);
    try {
      const res = await pushItemsToPlane([item.id]);
      toast({ message: res.message, tone: res.ok ? 'success' : 'error' });
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className={cn(variant === 'page' ? 'page-width pb-40 pt-10' : 'px-12 pb-24 pt-6')}>
      {parent && (
        <button
          onClick={() => openPeek(parent.id)}
          className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2"
        >
          <TypeIcon type={parent.type} size={13} />
          <span className="truncate">{parent.title}</span>
        </button>
      )}
      <div className="flex items-start gap-3">
        <div className="pt-[9px]">
          <DoneCheck checked={item.status === 'done'} size={22} onChange={(v, e) => setItemStatus(item.id, v ? 'done' : 'in_progress', e)} />
        </div>
        <AutoTextarea
          key={item.id}
          defaultValue={item.title}
          onBlur={(e) => e.target.value.trim() !== item.title && set({ title: e.target.value.trim() || item.title })}
          placeholder={t('item.titlePlaceholder')}
          className={cn('text-[30px] font-bold leading-[1.25] tracking-[-0.01em]', item.status === 'done' && 'text-fg-3')}
        />
      </div>

      {/* Properties */}
      <div className="mt-5 space-y-[2px]">
        <Prop icon={<Layers size={15} />} label={t('prop.type')}>
          <TypePicker value={item.type} onChange={(v) => set({ type: v })}>
            <PropValue>
              <TypeIcon type={item.type} size={14} />
              {t(`type.${item.type}`)}
            </PropValue>
          </TypePicker>
        </Prop>
        <Prop icon={<CircleDot size={15} />} label={t('prop.status')}>
          <StatusPicker value={item.status} onChange={(v) => setItemStatus(item.id, v)}>
            <PropValue>
              <StatusIcon status={item.status} />
              {t(`status.${item.status}`)}
            </PropValue>
          </StatusPicker>
        </Prop>
        <Prop icon={<Flag size={15} />} label={t('prop.priority')}>
          <PriorityPicker value={item.priority} onChange={(v) => set({ priority: v })}>
            <PropValue>
              <PriorityIcon priority={item.priority} />
              {t(`priority.${item.priority}`)}
            </PropValue>
          </PriorityPicker>
        </Prop>
        <Prop icon={<User size={15} />} label={t('prop.assignee')}>
          <PersonPicker value={item.assigneeId} onChange={(v) => set({ assigneeId: v })}>
            <PropValue empty={!item.assigneeId}>
              {item.assigneeId && people[item.assigneeId] ? (
                <>
                  <Avatar person={people[item.assigneeId]} size={18} />
                  {people[item.assigneeId].name}
                </>
              ) : (
                t('prop.empty')
              )}
            </PropValue>
          </PersonPicker>
        </Prop>
        <Prop icon={<CalendarDays size={15} />} label={t('prop.dates')}>
          <DatePicker
            start={item.startDate}
            end={item.dueDate}
            onChange={(s, e) => set({ startDate: s, dueDate: e })}
            allowRange={item.type !== 'milestone'}
          >
            <PropValue empty={!item.dueDate}>{item.dueDate ? formatRange(item.startDate, item.dueDate, lang) : t('prop.empty')}</PropValue>
          </DatePicker>
        </Prop>
        <Prop icon={<Compass size={15} />} label={t('prop.horizon')}>
          <HorizonPicker value={item.horizon} onChange={(v) => set({ horizon: v })}>
            <PropValue empty={!item.horizon}>
              {item.horizon ? (
                <Chip color={HORIZON_COLOR[item.horizon]} dot>
                  {t(`horizon.${item.horizon}`)}
                </Chip>
              ) : (
                t('prop.empty')
              )}
            </PropValue>
          </HorizonPicker>
        </Prop>
        <Prop icon={<Gauge size={15} />} label={t('prop.rice')}>
          <RicePicker value={item.rice} onChange={(r) => set({ rice: r })}>
            <PropValue empty={score == null}>
              {score != null ? (
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{formatScore(score)}</span>
                  <span className="text-[12px] text-fg-3">
                    {item.rice!.reach} × {item.rice!.impact} × {item.rice!.confidence}% / {item.rice!.effort}
                  </span>
                </span>
              ) : (
                t('rice.notScored')
              )}
            </PropValue>
          </RicePicker>
        </Prop>
        <Prop icon={<Hourglass size={15} />} label={t('prop.estimate')}>
          <input
            type="number"
            min={0}
            value={item.estimate ?? ''}
            placeholder={t('prop.empty')}
            onChange={(e) => set({ estimate: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
            className="h-8 w-full rounded-md bg-transparent px-2 text-[14px] outline-none placeholder:text-fg-4 hover:bg-hover focus:bg-hover"
          />
        </Prop>
        <Prop icon={<Tag size={15} />} label={t('prop.tags')}>
          <TagPicker value={item.tags} onChange={(v) => set({ tags: v })}>
            <PropValue empty={!item.tags.length}>
              {item.tags.length ? (
                <span className="flex flex-wrap gap-1">
                  {item.tags.map((tg) => (
                    <TagChip key={tg} tag={tg} />
                  ))}
                </span>
              ) : (
                t('prop.empty')
              )}
            </PropValue>
          </TagPicker>
        </Prop>
        <Prop icon={<GitBranch size={15} />} label={t('prop.parent')}>
          <ParentPicker projectId={item.projectId} excludeId={item.id} value={item.parentId} onChange={(v) => set({ parentId: v })}>
            <PropValue empty={!parent}>
              {parent ? (
                <>
                  <TypeIcon type={parent.type} size={14} />
                  <span className="truncate">{parent.title}</span>
                </>
              ) : (
                t('prop.empty')
              )}
            </PropValue>
          </ParentPicker>
        </Prop>
        <Prop icon={<FolderOpen size={15} />} label={t('prop.project')}>
          <ProjectPicker value={item.projectId} onChange={(v) => v && set({ projectId: v, parentId: undefined })}>
            <PropValue>
              {project && <PageIcon icon={project.icon} size={16} />}
              <span className="truncate">{project?.name}</span>
            </PropValue>
          </ProjectPicker>
        </Prop>
        <Prop icon={<Hash size={15} />} label={t('prop.plane')}>
          {item.plane ? (
            <div className="flex h-8 items-center gap-2 px-2 text-[14px]">
              <span className="font-mono text-[13px] font-medium text-fg-2">{item.plane.key}</span>
              {item.plane.stateName && (
                <Chip color={item.plane.stateGroup ? PLANE_GROUP_COLOR[item.plane.stateGroup] : 'gray'} dot>
                  {item.plane.stateName}
                </Chip>
              )}
              {item.plane.demo && <span className="text-[12px] text-fg-3">{t('common.demo')}</span>}
              {item.plane.url && (
                <a
                  href={item.plane.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto flex items-center gap-1 text-[12.5px] text-fg-3 hover:text-fg"
                >
                  {t('item.openInPlane')} <ExternalLink size={12} />
                </a>
              )}
            </div>
          ) : project?.plane && planeOk ? (
            <div className="px-1">
              <Button size="sm" variant="ghost" icon={<Send size={14} />} loading={pushing} onClick={push}>
                {t('item.pushToPlane')}
              </Button>
            </div>
          ) : (
            <Link
              to={project?.plane ? '/settings/plane' : `/p/${item.projectId}/overview`}
              className="flex h-8 items-center px-2 text-[14px] text-fg-4 hover:text-fg-3"
            >
              {project?.plane ? t('nav.planeNotConnected') : t('project.linkPlane')}
            </Link>
          )}
        </Prop>
      </div>

      {/* Children */}
      {(children.length > 0 || ['initiative', 'epic', 'feature'].includes(item.type)) && (
        <div className="mt-6">
          <div className="mb-1.5 flex items-center gap-3">
            <div className="text-[13px] font-semibold text-fg-2">{t('item.children')}</div>
            {prog.total > 0 && (
              <div className="flex flex-1 items-center gap-2">
                <Progress value={prog.ratio} className="max-w-[140px]" />
                <span className="text-[12px] text-fg-3">{t('home.progress', { done: prog.done, total: prog.total })}</span>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-line">
            {children.map((c) => (
              <ChildRow key={c.id} id={c.id} />
            ))}
            <SubItemInput
              onCreate={(title) =>
                useData.getState().createItem({
                  projectId: item.projectId,
                  parentId: item.id,
                  title,
                  status: 'backlog',
                  type: item.type === 'initiative' ? 'epic' : item.type === 'epic' ? 'feature' : 'task',
                })
              }
            />
          </div>
        </div>
      )}

      <div className="mt-6">
        <Comments targetKind="item" targetId={item.id} />
      </div>

      <div className="my-5 h-px bg-line" />

      <Editor
        key={item.id}
        initial={item.content}
        onChange={(blocks) => useData.getState().updateItem(item.id, { content: blocks })}
        placeholder={t('item.descriptionPlaceholder')}
        compact={variant === 'peek'}
      />

      <ActivityLog itemId={item.id} />
    </div>
  );
}

function SubItemInput({ onCreate }: { onCreate: (title: string) => void }) {
  const t = useT();
  const [active, setActive] = useState(false);
  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className="flex h-9 w-full items-center gap-2 px-3 text-[13.5px] text-fg-3 transition-colors hover:bg-hover"
      >
        <Plus size={15} /> {t('item.addChild')}
      </button>
    );
  }
  return (
    <div className="flex h-9 items-center gap-2 px-3">
      <Plus size={15} className="text-fg-4" />
      <input
        autoFocus
        placeholder={t('item.subtaskPlaceholder')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value.trim();
            if (v) onCreate(v);
            (e.target as HTMLInputElement).value = '';
          }
          if (e.key === 'Escape') setActive(false);
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v) onCreate(v);
          setActive(false);
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-4"
      />
    </div>
  );
}

function ChildRow({ id }: { id: ID }) {
  const t = useT();
  const item = useData((s) => s.items[id]);
  const people = useData((s) => s.people);
  const openPeek = useUI((s) => s.openPeek);
  if (!item) return null;
  return (
    <div
      onClick={() => openPeek(item.id)}
      className="group flex h-9 cursor-pointer items-center gap-2.5 border-b border-line px-3 text-[14px] last:border-b-0 hover:bg-hover"
    >
      <StatusPicker value={item.status} onChange={(v) => setItemStatus(item.id, v)}>
        <button onClick={(e) => e.stopPropagation()} className="rounded p-0.5 hover:bg-active">
          <StatusIcon status={item.status} />
        </button>
      </StatusPicker>
      <TypeIcon type={item.type} size={14} />
      <span className={cn('min-w-0 flex-1 truncate', item.status === 'done' && 'text-fg-3 line-through decoration-fg-4')}>
        {item.title || t('common.untitled')}
      </span>
      {item.assigneeId && <Avatar person={people[item.assigneeId]} size={18} />}
    </div>
  );
}

function Prop({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-start">
      <div className="flex h-8 w-[160px] shrink-0 items-center gap-2 text-[14px] text-fg-3">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PropValue({ children, empty, ...rest }: { children: ReactNode; empty?: boolean } & React.ComponentProps<'button'>) {
  return (
    <button
      {...rest}
      className={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[14px] transition-colors hover:bg-hover',
        empty && 'text-fg-4',
      )}
    >
      {children}
    </button>
  );
}
