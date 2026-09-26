import { Link2, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, useAuth, type AccessLevel, type AccessRole, type ProjectLevel } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { canManageMember, memberLevel, setProjectLevel, useActor, useMembers, type Member } from '@/lib/members';
import type { ID } from '@/lib/types';
import { cn, matches } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Avatar, PageIcon } from '@/components/ui/bits';
import { Dialog, Popover } from '@/components/ui/Overlay';
import { LevelSelect, levelLabel, roleLabel } from './AccessControls';

interface Entry {
  id: ID;
  name: string;
  role: AccessRole;
  level: AccessLevel;
  allProjects: boolean;
}

/**
 * Who can open a project and at which level. Admins read it from the member list;
 * everyone else asks the server, which only answers for projects they can open.
 */
export function useProjectAccess(projectId: ID, enabled = true) {
  const signedIn = useAuth((s) => s.mode === 'signedIn');
  const actor = useActor();
  const manager = actor?.role === 'owner' || actor?.role === 'admin';
  const { members, loaded } = useMembers();
  const [remote, setRemote] = useState<Entry[] | null>(null);
  const [version, setVersion] = useState(0);
  const fromMembers = !signedIn || manager;

  useEffect(() => {
    if (!enabled || fromMembers) return;
    let alive = true;
    api<{ members: Entry[] }>(`/api/projects/${encodeURIComponent(projectId)}/access`)
      .then((r) => alive && setRemote(r.members))
      .catch(() => alive && setRemote([]));
    return () => {
      alive = false;
    };
  }, [enabled, fromMembers, projectId, version]);

  const list = useMemo<Entry[] | null>(() => {
    if (!fromMembers) return remote;
    if (!loaded) return null;
    return members
      .filter((m) => !m.suspended)
      .map((m) => ({ id: m.id, name: m.name, role: m.role, level: memberLevel(m, projectId), allProjects: m.projectIds === null }))
      .filter((m): m is Entry => !!m.level);
  }, [fromMembers, loaded, remote, members, projectId]);

  return { list, members, refresh: () => setVersion((v) => v + 1) };
}

export function ProjectShareDialog({ projectId, open, onOpenChange }: { projectId: ID; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const project = useData((s) => s.projects[projectId]);
  const people = useData((s) => s.people);
  const actor = useActor();
  const { list, members, refresh } = useProjectAccess(projectId, open);
  const manager = actor?.role === 'owner' || actor?.role === 'admin';
  const [busy, setBusy] = useState<ID | null>(null);

  const change = async (id: ID, level: ProjectLevel | null) => {
    const member = members.find((m) => m.id === id);
    if (!member) return;
    setBusy(id);
    try {
      await setProjectLevel(member, projectId, level);
      refresh();
      toast({ message: t('people.updated'), tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const sorted = useMemo(() => {
    const order = { full: 0, editor: 1, commenter: 2, viewer: 3 };
    return [...(list ?? [])].sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
  }, [list]);
  const candidates = members.filter((m) => !m.suspended && !memberLevel(m, projectId) && canManageMember(actor, m));

  if (!project) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="max-w-[520px]" title={t('share.title')}>
      <div className="flex max-h-[86vh] flex-col">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <PageIcon icon={project.icon} size={20} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{t('share.title')}</div>
            <div className="truncate text-[13px] text-fg-3">{project.name || t('project.untitled')}</div>
          </div>
          {manager && <AddMember candidates={candidates} onPick={(m) => void change(m.id, m.role === 'viewer' ? 'viewer' : 'editor')} />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {list === null && <div className="px-3 py-6 text-center text-[13px] text-fg-3">{t('common.loading')}</div>}
          {sorted.map((entry) => {
            const member = members.find((m) => m.id === entry.id);
            const editable = manager && entry.level !== 'full' && !!member && canManageMember(actor, member);
            return (
              <div key={entry.id} className={cn('flex min-h-11 items-center gap-2.5 rounded-md px-3 py-1.5', busy === entry.id && 'opacity-60')}>
                <Avatar person={people[entry.id]} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]">
                    {entry.name}
                    {entry.id === actor?.id && <span className="ml-1.5 text-[12.5px] text-fg-3">({t('people.you')})</span>}
                  </div>
                  <div className="truncate text-[12.5px] text-fg-3">
                    {t(roleLabel(entry.role))}
                    {entry.allProjects && entry.level !== 'full' && ` · ${t('share.allProjects')}`}
                  </div>
                </div>
                {editable ? (
                  <LevelSelect
                    value={entry.level as ProjectLevel}
                    allowEdit={entry.role !== 'viewer'}
                    onChange={(level) => level && void change(entry.id, level)}
                    onRemove={entry.allProjects ? undefined : () => void change(entry.id, null)}
                  />
                ) : (
                  <span className="px-2 text-[13px] text-fg-3">{t(levelLabel(entry.level))}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-fg-3">{manager ? t('share.admins') : t('share.onlyAdmins')}</span>
          <Button
            size="sm"
            icon={<Link2 size={14} />}
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}/p/${projectId}/overview`);
              toast({ message: t('common.copied') });
            }}
          >
            {t('share.copyLink')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddMember({ candidates, onPick }: { candidates: Member[]; onPick: (m: Member) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shown = candidates.filter((m) => matches(`${m.name} ${m.email ?? ''}`, query));
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
      align="end"
      trigger={
        <Button size="sm" variant="primary" icon={<Plus size={14} />}>
          {t('share.add')}
        </Button>
      }
    >
      <div className="w-[280px] p-1">
        <div className="flex h-8 items-center gap-2 px-2">
          <Search size={14} className="text-fg-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('share.addPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-4"
          />
        </div>
        <div className="mx-1 my-1 h-px bg-line" />
        <div className="max-h-[260px] overflow-y-auto">
          {shown.length === 0 && <div className="px-2.5 py-2 text-[13px] text-fg-3">{t('people.empty')}</div>}
          {shown.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onPick(m);
                setOpen(false);
              }}
              className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
            >
              <Avatar person={m.person} size={22} />
              <span className="min-w-0 flex-1 truncate text-[14px]">{m.name}</span>
              <span className="shrink-0 text-[12px] text-fg-3">{t(roleLabel(m.role))}</span>
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}
