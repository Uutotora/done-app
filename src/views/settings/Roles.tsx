import { Check, Minus, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/auth';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { formatDateTime } from '@/lib/dates';
import { ROLE_ORDER } from '@/lib/members';
import { cn, matches } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { levelLabel, roleLabel } from '@/components/access/AccessControls';
import { H, H2 } from './common';

type Cell = true | false | TKey;

/** What each role can do. Mirrors server/access.mjs. */
const CAPABILITIES: { label: TKey; cells: [Cell, Cell, Cell, Cell] }[] = [
  { label: 'roles.cap.manageOwners', cells: [true, false, false, false] },
  { label: 'roles.cap.invite', cells: [true, 'roles.adminsLimit', false, false] },
  { label: 'roles.cap.workspace', cells: [true, true, false, false] },
  { label: 'roles.cap.allProjects', cells: [true, true, false, false] },
  { label: 'roles.cap.createProjects', cells: [true, true, 'roles.ifAllowed', false] },
  { label: 'roles.cap.edit', cells: [true, true, 'roles.inTheirProjects', false] },
  { label: 'roles.cap.comment', cells: [true, true, 'roles.inTheirProjects', 'roles.ifAllowed'] },
  { label: 'roles.cap.view', cells: [true, true, true, true] },
];

export function RolesPage() {
  const t = useT();
  return (
    <>
      <H sub={t('roles.subtitle')}>{t('set.nav.roles')}</H>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 pr-3 font-normal text-fg-3">{t('roles.matrix')}</th>
              {ROLE_ORDER.map((role) => (
                <th key={role} className="w-[110px] px-2 py-2 text-center font-medium">
                  {t(roleLabel(role))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((cap) => (
              <tr key={cap.label} className="border-b border-line">
                <td className="py-2.5 pr-3">{t(cap.label)}</td>
                {cap.cells.map((cell, i) => (
                  <td key={i} className="px-2 py-2.5 text-center align-middle">
                    <CellMark cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="rounded-lg border border-line px-3 py-2.5">
            <div className="text-[14px] font-medium">{t(roleLabel(role))}</div>
            <div className="mt-0.5 text-[12.5px] leading-snug text-fg-3">{t(`role.${role}.desc` as TKey)}</div>
          </div>
        ))}
      </div>

      <H2>{t('roles.levels')}</H2>
      <p className="mb-2 text-[13px] leading-relaxed text-fg-3">{t('roles.levelsHint')}</p>
      <div>
        {(['full', 'editor', 'commenter', 'viewer'] as const).map((level) => (
          <div key={level} className="flex items-baseline gap-4 border-b border-line py-2.5 last:border-b-0">
            <span className="w-[190px] shrink-0 text-[14px] font-medium">{t(levelLabel(level))}</span>
            <span className="min-w-0 text-[13.5px] text-fg-2">{t(`level.${level}.desc` as TKey)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function CellMark({ cell }: { cell: Cell }) {
  const t = useT();
  if (cell === true)
    return (
      <span className="inline-flex text-[var(--c-green-text)]" aria-label="✓">
        <Check size={16} strokeWidth={2.4} />
      </span>
    );
  if (cell === false)
    return (
      <span className="inline-flex text-fg-4" aria-label="—">
        <Minus size={16} />
      </span>
    );
  return <span className="text-[12px] leading-tight text-fg-3">{t(cell)}</span>;
}

/* ---------------------------------- Audit ---------------------------------- */

interface AuditEvent {
  id: number;
  name: string | null;
  action: string;
  detail: string;
  at: string;
}

const AUDIT_ACTIONS = new Set([
  'account.created',
  'account.login',
  'password.changed',
  'invite.created',
  'invite.revoked',
  'member.updated',
  'member.suspended',
  'member.restored',
  'member.removed',
  'project.access',
  'project.created',
  'project.deleted',
  'project.renamed',
  'project.archived',
  'project.unarchived',
  'task.created',
  'task.deleted',
  'doc.created',
  'doc.deleted',
  'doc.renamed',
  'file.created',
  'file.deleted',
  'folder.created',
  'folder.deleted',
  'link.created',
  'link.deleted',
  'sprint.created',
  'sprint.deleted',
  'comment.removed',
  'trash.restored',
  'trash.purged',
  'trash.emptied',
]);

type AuditFilter = 'all' | 'access' | 'content';
const AUDIT_FILTERS: AuditFilter[] = ['all', 'access', 'content'];

export function AuditPage() {
  const t = useT();
  const lang = useLang();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const page = (before?: number) =>
    api<{ events: AuditEvent[]; more?: boolean }>(
      `/api/admin/audit?${new URLSearchParams({
        ...(filter === 'all' ? {} : { kind: filter }),
        ...(before ? { before: String(before) } : {}),
      })}`,
    );
  useEffect(() => {
    let live = true;
    setEvents(null);
    setError('');
    page()
      .then((r) => {
        if (!live) return;
        setEvents(r.events);
        setMore(!!r.more);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  const loadMore = () => {
    const last = events?.[events.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    page(last.id)
      .then((r) => {
        setEvents((prev) => [...(prev ?? []), ...r.events.filter((e) => !prev?.some((p) => p.id === e.id))]);
        setMore(!!r.more);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };
  // Details keep raw role and level names; show them the way the rest of the app does.
  const detail = (text: string) =>
    text
      .split(' · ')
      .map((part) =>
        ROLE_ORDER.includes(part as never)
          ? t(roleLabel(part as never))
          : ['commenter', 'viewer', 'editor'].includes(part)
            ? t(levelLabel(part as never))
            : part === 'removed'
              ? t('level.none')
              : part,
      )
      .join(' · ');
  const label = (action: string) => {
    const base = action.endsWith('.more') ? action.slice(0, -5) : action;
    return AUDIT_ACTIONS.has(base) ? t(`audit.${base}` as TKey) : action;
  };
  // Bulk actions are summarised by the server: "<action>.more" carries how many entries were folded.
  const describe = (e: AuditEvent) =>
    e.action.endsWith('.more')
      ? t('audit.andMore', { n: e.detail })
      : e.action === 'trash.emptied'
        ? t('audit.objects', { n: e.detail })
        : detail(e.detail);
  const shown = (events ?? []).filter((e) => matches(`${e.name ?? ''} ${label(e.action)} ${describe(e)}`, query));
  return (
    <>
      <H
        sub={t('audit.subtitle')}
        action={
          <label className="flex h-8 w-[220px] items-center gap-2 rounded-md border border-line-strong px-2.5 focus-within:border-accent">
            <Search size={14} className="shrink-0 text-fg-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('audit.search')}
              aria-label={t('audit.search')}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-4"
            />
          </label>
        }
      >
        {t('audit.title')}
      </H>
      <div role="tablist" className="mb-3 flex gap-1">
        {AUDIT_FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'h-7 rounded-md px-2.5 text-[13px] transition-colors',
              filter === f ? 'bg-hover text-fg' : 'text-fg-3 hover:bg-hover hover:text-fg',
            )}
          >
            {t(`audit.filter.${f}`)}
          </button>
        ))}
      </div>
      {error && <p className="text-[13px] text-[var(--c-red-text)]">{error}</p>}
      {!events && !error && <div className="py-10 text-center text-[13px] text-fg-3">{t('common.loading')}</div>}
      {events && shown.length === 0 && <div className="py-10 text-center text-[13px] text-fg-3">{t('audit.empty')}</div>}
      {shown.length > 0 && (
        <div role="table">
          <Grid header>
            <span>{t('audit.col.event')}</span>
            <span>{t('audit.col.who')}</span>
            <span className="text-right">{t('audit.col.when')}</span>
          </Grid>
          {shown.map((e) => (
            <Grid key={e.id}>
              <div className="min-w-0">
                <div className="truncate text-[14px]">{label(e.action)}</div>
                {e.detail && <div className="truncate text-[12.5px] text-fg-3">{describe(e)}</div>}
              </div>
              <span className="truncate text-[13.5px] text-fg-2">{e.name ?? '—'}</span>
              <span className="text-right text-[12.5px] tabular-nums text-fg-3">{formatDateTime(e.at, lang)}</span>
            </Grid>
          ))}
        </div>
      )}
      {more && (
        <div className="flex justify-center pt-3">
          <Button size="sm" variant="ghost" loading={loadingMore} onClick={loadMore}>
            {t('audit.more')}
          </Button>
        </div>
      )}
    </>
  );
}

function Grid({ children, header }: { children: ReactNode; header?: boolean }) {
  return (
    <div
      role="row"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_minmax(0,160px)_130px] items-center gap-3 border-b border-line px-1',
        header ? 'h-8 text-[12.5px] text-fg-3' : 'min-h-[48px] py-1.5',
      )}
    >
      {children}
    </div>
  );
}
