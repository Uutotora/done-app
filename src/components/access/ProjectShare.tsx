import { Check, Copy, Link2, Plus, RotateCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, useAuth, type AccessLevel, type AccessRole, type ProjectLevel } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import {
  NO_LINK,
  canManageMember,
  getProjectJoinLink,
  memberLevel,
  setProjectLevel,
  updateProjectJoinLink,
  useActor,
  useMembers,
  type JoinLink,
  type Member,
} from '@/lib/members';
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
  const signedIn = useAuth((s) => s.mode === 'signedIn');
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
        {manager && signedIn && <ProjectInviteLink projectId={projectId} />}
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

/**
 * "Invite with a link", as in Notion and Figma: copy the link and send it to anyone. Whoever opens it
 * creates an account (or signs in) and lands in this project with the chosen level.
 */
function ProjectInviteLink({ projectId }: { projectId: ID }) {
  const t = useT();
  const [link, setLink] = useState<JoinLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    let alive = true;
    getProjectJoinLink(projectId)
      .then((l) => alive && setLink(l))
      .catch(() => alive && setLink(NO_LINK));
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!copied && !confirmReset) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setConfirmReset(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [copied, confirmReset]);
  const change = async (patch: Parameters<typeof updateProjectJoinLink>[1], message?: string) => {
    setBusy(true);
    try {
      const next = await updateProjectJoinLink(projectId, patch);
      setLink(next);
      if (message) toast({ message, tone: 'success' });
      return next;
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
      return null;
    } finally {
      setBusy(false);
    }
  };
  // The first copy creates the link (or turns it back on); after that it only copies.
  const copy = async () => {
    const current = link?.enabled && link.url ? link : await change({ enabled: true });
    if (!current?.url) return;
    try {
      await navigator.clipboard?.writeText(current.url);
    } catch {
      /* the field below still shows the link */
    }
    setCopied(true);
    toast({ message: t('share.linkCopied'), tone: 'success' });
  };
  const level = (link?.level ?? 'editor') as ProjectLevel;
  return (
    <section aria-labelledby="project-link-title" className="border-t border-line px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-fg-2">
          <Link2 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="project-link-title" className="text-[14px] font-medium">
            {t('share.inviteLink')}
          </h3>
          <div className="flex flex-wrap items-center gap-x-1 text-[12.5px] text-fg-3">
            {t('share.inviteLinkHint')}
            <LevelSelect value={level} onChange={(next) => next && next !== level && void change({ level: next })} />
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          loading={busy && !link?.enabled}
          disabled={!link}
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => void copy()}
          className="shrink-0"
        >
          {copied ? t('share.linkCopiedShort') : t('share.copyInvite')}
        </Button>
      </div>
      {link?.enabled && link.url && (
        <div className="mt-3 pl-11">
          <input
            readOnly
            aria-label={t('share.inviteLink')}
            value={link.url}
            onFocus={(e) => e.target.select()}
            className="h-8 w-full truncate rounded-md border border-line bg-subtle px-2.5 font-mono text-[11.5px] text-fg-2 outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
            {link.joined > 0 && <span>{t('invite.linkJoined', { n: link.joined })}</span>}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                setConfirmReset(false);
                void change({ reset: true }, t('invite.linkResetDone'));
              }}
              className={cn(
                'flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover',
                confirmReset ? 'text-[var(--c-red-text)]' : 'hover:text-fg-2',
              )}
            >
              <RotateCw size={11} />
              {confirmReset ? t('invite.linkResetConfirm') : t('invite.linkReset')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void change({ enabled: false })}
              className="rounded px-1 py-0.5 hover:bg-hover hover:text-fg-2"
            >
              {t('share.linkOff')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
