import { Check, Copy, Mail, MoreHorizontal, Plus, Search, ShieldCheck, UserMinus, UserX, UserCheck, FolderLock, RotateCw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLang, useT } from '@/lib/i18n';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { usePresence } from '@/lib/presence';
import { timeAgo } from '@/lib/dates';
import { useProjectsList } from '@/lib/selectors';
import {
  EMAIL_RE,
  canManageMember,
  inviteMailto,
  inviteMembers,
  memberLevel,
  removeMember,
  renewInvite,
  revokeInvite,
  updateMember,
  useActor,
  useMembers,
  type AccessInput,
  type InviteResult,
  type Member,
  type PendingInvite,
} from '@/lib/members';
import type { ID } from '@/lib/types';
import { cn, matches } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/Button';
import { Avatar, AvatarStack, PageIcon } from '@/components/ui/bits';
import { Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/Overlay';
import { AccessEditor, EmailsInput, RoleSelect, roleLabel } from '@/components/access/AccessControls';
import { ProjectShareDialog } from '@/components/access/ProjectShare';
import { H, Note } from './common';

type PeopleTab = 'members' | 'invites' | 'projects';

const isManager = (actor: { role: string } | null) => actor?.role === 'owner' || actor?.role === 'admin';

/** Settings > People: members with their roles and projects, invitations and access by project. */
export function PeoplePage() {
  const t = useT();
  const actor = useActor();
  const manager = isManager(actor);
  const { members, invites, loaded, error, remote } = useMembers();
  const [tab, setTab] = useState<PeopleTab>('members');
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const shown = members.filter((m) => matches(`${m.name} ${m.email ?? ''}`, query));
  const tabs: { key: PeopleTab; label: string; count?: number }[] = [
    { key: 'members', label: t('people.tab.members'), count: members.length },
    ...(manager && remote ? [{ key: 'invites' as const, label: t('people.tab.invites'), count: invites.length }] : []),
    ...(manager ? [{ key: 'projects' as const, label: t('people.tab.projects') }] : []),
  ];

  const act = async (work: () => Promise<unknown>, message = t('people.updated')) => {
    try {
      await work();
      toast({ message, tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };

  return (
    <>
      <H
        sub={t('people.subtitle')}
        action={
          manager && (
            <Button variant="primary" size="md" icon={<Plus size={15} />} onClick={() => setInviting(true)}>
              {t('people.addMembers')}
            </Button>
          )
        }
      >
        {t('set.nav.people')}
      </H>
      {!remote && <Note className="mb-5">{t('people.demoNote')}</Note>}
      {remote && !manager && <Note className="mb-5">{t('people.readOnly')}</Note>}
      {error && <p className="mb-4 text-[13px] text-[var(--c-red-text)]">{error}</p>}

      <div className="mb-3 flex flex-wrap items-end gap-3 border-b border-line">
        <div role="tablist" className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={cn(
                'relative flex h-9 shrink-0 items-center gap-1.5 px-2 text-[14px] transition-colors',
                tab === x.key ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg-2',
              )}
            >
              {x.label}
              {x.count !== undefined && <span className="text-[12.5px] text-fg-3">{x.count}</span>}
              {tab === x.key && <span className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-fg" />}
            </button>
          ))}
        </div>
        {tab === 'members' && (
          <label className="mb-1.5 flex h-8 w-full items-center gap-2 rounded-md border border-line-strong px-2.5 focus-within:border-accent sm:w-[240px]">
            <Search size={14} className="shrink-0 text-fg-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('people.searchPlaceholder')}
              aria-label={t('people.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-4"
            />
            {query && (
              <button aria-label={t('common.clear')} onClick={() => setQuery('')} className="text-fg-3 hover:text-fg-2">
                <X size={13} />
              </button>
            )}
          </label>
        )}
      </div>

      {tab === 'members' && (
        <MembersTable
          members={shown}
          loaded={loaded}
          manager={manager}
          remote={remote}
          onEdit={setEditing}
          onRemove={setRemoving}
          onChange={(m, patch, message) => void act(() => updateMember(m, patch), message)}
        />
      )}
      {tab === 'invites' && <InvitesList invites={invites} act={act} />}
      {tab === 'projects' && <ProjectsAccess members={members} />}

      <InviteDialog open={inviting} onOpenChange={setInviting} />
      {editing && <AccessDialog member={editing} onClose={() => setEditing(null)} />}
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} className="max-w-[420px]" title={t('people.removeFromWorkspace')}>
        {removing && (
          <div className="p-5">
            <div className="flex items-center gap-2.5">
              <Avatar person={removing.person} size={28} />
              <div className="text-[15px] font-semibold">{t('people.removeFromWorkspace')}</div>
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-fg-2">{t('people.removeConfirm', { name: removing.name })}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const target = removing;
                  setRemoving(null);
                  void act(() => removeMember(target), t('people.removed'));
                }}
              >
                {t('people.removeFromWorkspace')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/* --------------------------------- Members --------------------------------- */

const GRID =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,150px)_32px] items-center gap-3 md:grid-cols-[minmax(0,1fr)_150px_150px_32px] lg:grid-cols-[minmax(0,1fr)_150px_150px_120px_32px]';

function MembersTable({
  members,
  loaded,
  manager,
  remote,
  onEdit,
  onRemove,
  onChange,
}: {
  members: Member[];
  loaded: boolean;
  manager: boolean;
  remote: boolean;
  onEdit: (m: Member) => void;
  onRemove: (m: Member) => void;
  onChange: (m: Member, patch: Partial<AccessInput> & { suspended?: boolean }, message?: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const actor = useActor();
  const projects = useData((s) => s.projects);
  const peers = usePresence((s) => s.peers);
  const online = useMemo(() => new Set(peers.map((p) => p.id)), [peers]);

  if (!loaded) return <div className="py-10 text-center text-[13px] text-fg-3">{t('common.loading')}</div>;
  return (
    <div role="table" aria-label={t('people.tab.members')}>
      <div role="row" className={cn(GRID, 'h-8 border-b border-line px-1 text-[12.5px] text-fg-3')}>
        <span role="columnheader">{t('people.col.user')}</span>
        <span role="columnheader" className="px-2">
          {t('people.col.role')}
        </span>
        <span role="columnheader" className="hidden px-2 md:block">
          {manager ? t('people.col.projects') : ''}
        </span>
        <span role="columnheader" className="hidden lg:block">
          {t('people.col.activity')}
        </span>
        <span />
      </div>
      {members.length === 0 && <div className="py-10 text-center text-[13px] text-fg-3">{t('people.empty')}</div>}
      {members.map((m) => {
        const editable = canManageMember(actor, m);
        const admin = m.role === 'owner' || m.role === 'admin';
        const ids = m.projectIds?.filter((id) => projects[id]);
        const projectsLabel =
          admin || m.projectIds === null ? t('people.allProjects') : ids?.length ? t('people.nProjects', { n: ids.length }) : t('people.noProjects');
        const isOnline = m.isMe || online.has(m.id);
        return (
          <div
            role="row"
            key={m.id}
            className={cn(
              GRID,
              'group min-h-[56px] border-b border-line px-1 py-2 transition-colors duration-100 hover:bg-[var(--bg-subtle)]',
              m.suspended && 'text-fg-3',
            )}
          >
            <div role="cell" className="flex min-w-0 items-center gap-3">
              <Avatar person={m.person} size={30} className={cn(m.suspended && 'opacity-50 grayscale')} />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[14px] font-medium">{m.name}</span>
                  {m.isMe && <span className="shrink-0 text-[12.5px] text-fg-3">({t('people.you')})</span>}
                  {m.suspended && (
                    <span className="shrink-0 rounded bg-[var(--c-red-bg)] px-1.5 py-px text-[11.5px] font-medium text-[var(--c-red-text)]">
                      {t('people.suspended')}
                    </span>
                  )}
                </div>
                {m.email && <div className="truncate text-[12.5px] text-fg-3">{m.email}</div>}
              </div>
            </div>
            <div role="cell" className="min-w-0">
              <RoleSelect value={m.role} actor={actor} disabled={!editable} onChange={(role) => role !== m.role && onChange(m, { role })} />
            </div>
            <div role="cell" className="hidden min-w-0 md:block">
              {manager &&
                (editable && !admin ? (
                  <button
                    onClick={() => onEdit(m)}
                    className="flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-[13.5px] text-fg-2 transition-colors hover:bg-hover"
                  >
                    <span className="truncate">{projectsLabel}</span>
                  </button>
                ) : (
                  <span className="block truncate px-2 text-[13.5px] text-fg-3">{projectsLabel}</span>
                ))}
            </div>
            <div role="cell" className="hidden min-w-0 text-[13px] text-fg-3 lg:block">
              {m.suspended ? (
                '—'
              ) : isOnline ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--c-green-solid)]" />
                  {t('people.online')}
                </span>
              ) : m.lastSeen ? (
                <span className="block truncate">{timeAgo(new Date(m.lastSeen).toISOString(), lang)}</span>
              ) : remote ? (
                t('people.never')
              ) : (
                '—'
              )}
            </div>
            <div role="cell" className="flex justify-end">
              {editable && (
                <Menu
                  align="end"
                  trigger={
                    <IconButton
                      size="md"
                      label={t('common.more')}
                      className="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal size={16} />
                    </IconButton>
                  }
                >
                  {!admin && (
                    <MenuItem icon={<FolderLock size={15} />} onSelect={() => onEdit(m)}>
                      {t('people.editAccess')}
                    </MenuItem>
                  )}
                  {m.role === 'editor' && (
                    <MenuItem
                      icon={<ShieldCheck size={15} />}
                      checked={m.canCreateProjects}
                      onSelect={() => onChange(m, { canCreateProjects: !m.canCreateProjects })}
                    >
                      {t('people.canCreate')}
                    </MenuItem>
                  )}
                  {!admin && <MenuSeparator />}
                  <MenuItem
                    icon={m.suspended ? <UserCheck size={15} /> : <UserX size={15} />}
                    onSelect={() => onChange(m, { suspended: !m.suspended })}
                  >
                    {m.suspended ? t('people.restore') : t('people.suspend')}
                  </MenuItem>
                  <MenuItem danger icon={<UserMinus size={15} />} onSelect={() => onRemove(m)}>
                    {t('people.removeFromWorkspace')}
                  </MenuItem>
                </Menu>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Access dialog ------------------------------ */

function AccessDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const t = useT();
  const actor = useActor();
  const [value, setValue] = useState<AccessInput>({
    role: member.role,
    projectIds: member.projectIds,
    projectRoles: member.projectRoles,
    canCreateProjects: member.canCreateProjects,
  });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-[560px]" title={t('access.title', { name: member.name })}>
      <div className="flex max-h-[86vh] flex-col">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <Avatar person={member.person} size={26} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{t('access.title', { name: member.name })}</div>
            {member.email && <div className="truncate text-[12.5px] text-fg-3">{member.email}</div>}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <AccessEditor value={value} onChange={setValue} actor={actor} />
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateMember(member, value);
                toast({ message: t('people.updated'), tone: 'success' });
                onClose();
              } catch (e) {
                toast({ message: (e as Error).message, tone: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('access.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ Invite dialog ------------------------------ */

const DEFAULT_ACCESS: AccessInput = { role: 'editor', projectIds: null, projectRoles: {}, canCreateProjects: true };

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const lang = useLang();
  const actor = useActor();
  const workspace = useData((s) => s.workspace.name);
  const [emails, setEmails] = useState<string[]>([]);
  const [access, setAccess] = useState<AccessInput>(DEFAULT_ACCESS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<InviteResult | null>(null);
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setEmails([]);
      setAccess(DEFAULT_ACCESS);
      setResult(null);
      setError('');
    }
  };
  const submit = async () => {
    if (!emails.length) return;
    if (invalid.length) return setError(t('invite.invalid', { emails: invalid.join(', ') }));
    setBusy(true);
    setError('');
    try {
      const r = await inviteMembers(emails, access);
      if (r.links.length) setResult(r);
      else {
        const added = emails.length - r.skipped.length;
        if (added) toast({ message: t('invite.addedLocal', { n: added }), tone: 'success' });
        if (r.skipped.length) toast({ message: t('invite.skipped', { emails: r.skipped.map((s) => s.email).join(', ') }) });
        close(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close} className="max-w-[580px]" title={t('invite.title')}>
      {result ? (
        <div className="flex max-h-[86vh] flex-col">
          <div className="border-b border-line px-5 py-4">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--c-green-solid)] text-white">
                <Check size={13} strokeWidth={3} />
              </span>
              {t('invite.doneTitle')}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-3">{t('invite.doneHint')}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {result.links.map((link) => (
              <div key={link.email} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-subtle)]">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]">{link.email}</div>
                  <input
                    readOnly
                    aria-label={t('invite.linkFor', { email: link.email })}
                    value={link.url}
                    onFocus={(e) => e.target.select()}
                    className="w-full truncate bg-transparent font-mono text-[11.5px] text-fg-3 outline-none"
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Mail size={14} />}
                  onClick={() => window.open(inviteMailto(link.email, link.url, workspace, lang), '_self')}
                >
                  {t('invite.mail')}
                </Button>
                <Button
                  size="sm"
                  icon={<Copy size={14} />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(link.url);
                    toast({ message: t('common.copied') });
                  }}
                >
                  {t('invite.copy')}
                </Button>
              </div>
            ))}
            {result.skipped.length > 0 && (
              <p className="px-2 py-2 text-[13px] text-fg-3">{t('invite.skipped', { emails: result.skipped.map((s) => s.email).join(', ') })}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {result.links.length > 1 && (
              <Button
                icon={<Copy size={14} />}
                onClick={() => {
                  void navigator.clipboard?.writeText(result.links.map((l) => `${l.email}: ${l.url}`).join('\n'));
                  toast({ message: t('common.copied') });
                }}
              >
                {t('invite.copyAll')}
              </Button>
            )}
            <Button variant="primary" onClick={() => close(false)}>
              {t('common.done')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex max-h-[86vh] flex-col">
          <div className="border-b border-line px-5 py-4 text-[15px] font-semibold">{t('invite.title')}</div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div>
              <div className="mb-2 text-[13px] font-medium text-fg-2">{t('invite.emails')}</div>
              <EmailsInput
                autoFocus
                emails={emails}
                onChange={(next) => {
                  setEmails(next);
                  setError('');
                }}
              />
              <p className="mt-1.5 text-[12.5px] text-fg-3">{t('invite.emailsHint')}</p>
            </div>
            <AccessEditor value={access} onChange={setAccess} actor={actor} />
            {error && (
              <p role="alert" className="text-[13px] text-[var(--c-red-text)]">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <Button variant="ghost" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!emails.length} onClick={() => void submit()}>
              {emails.length > 1 ? t('invite.submitN', { n: emails.length }) : t('invite.submit')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* --------------------------------- Invites --------------------------------- */

function InvitesList({ invites, act }: { invites: PendingInvite[]; act: (work: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  if (!invites.length) return <div className="py-10 text-center text-[13px] text-fg-3">{t('invite.pendingEmpty')}</div>;
  return (
    <div>
      {invites.map((invite) => {
        const days = Math.max(1, Math.ceil((invite.expires - Date.now()) / 86_400_000));
        const admin = invite.role === 'owner' || invite.role === 'admin';
        const count = invite.projectIds?.filter((id) => projects[id]).length ?? 0;
        return (
          <div key={invite.email} className="flex min-h-[56px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-1 py-2">
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-fg-3">
              <Mail size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{invite.email}</div>
              <div className="truncate text-[12.5px] text-fg-3">
                {t(roleLabel(invite.role))} ·{' '}
                {admin || invite.projectIds === null ? t('people.allProjects') : count ? t('people.nProjects', { n: count }) : t('people.noProjects')}{' '}
                · {t('invite.expires', { n: days })}
                {invite.invitedBy && ` · ${t('invite.by', { name: invite.invitedBy })}`}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCw size={13} />}
              onClick={() =>
                void act(async () => {
                  const url = await renewInvite(invite);
                  await navigator.clipboard?.writeText(url).catch(() => undefined);
                }, t('invite.renewed'))
              }
            >
              {t('invite.renew')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void act(() => revokeInvite(invite.email), t('invite.revoke'))}>
              {t('invite.revoke')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- Access by project ----------------------------- */

function ProjectsAccess({ members }: { members: Member[] }) {
  const t = useT();
  const projects = useProjectsList();
  const [sharing, setSharing] = useState<ID | null>(null);
  const active = members.filter((m) => !m.suspended);
  if (!projects.length) return <div className="py-10 text-center text-[13px] text-fg-3">{t('people.noProjects')}</div>;
  return (
    <div>
      {projects.map((p) => {
        const withAccess = active.filter((m) => memberLevel(m, p.id));
        const limited = withAccess.filter((m) => m.projectIds !== null && m.role !== 'owner' && m.role !== 'admin');
        return (
          <button
            key={p.id}
            onClick={() => setSharing(p.id)}
            className="flex min-h-[52px] w-full items-center gap-3 border-b border-line px-1 py-2 text-left transition-colors duration-100 hover:bg-[var(--bg-subtle)]"
          >
            <PageIcon icon={p.icon} size={20} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{p.name || t('project.untitled')}</div>
              <div className="truncate text-[12.5px] text-fg-3">
                {t('people.nMembers', { n: withAccess.length })}
                {limited.length > 0 && ` · ${t('people.nLimited', { n: limited.length })}`}
              </div>
            </div>
            <span className="hidden sm:block">
              <AvatarStack people={withAccess.map((m) => m.person).filter((x): x is NonNullable<typeof x> => !!x)} size={24} max={5} />
            </span>
            <span className="shrink-0 rounded-md px-2 py-1 text-[13px] text-fg-2">{t('people.manage')}</span>
          </button>
        );
      })}
      {sharing && <ProjectShareDialog projectId={sharing} open onOpenChange={(o) => !o && setSharing(null)} />}
    </div>
  );
}
