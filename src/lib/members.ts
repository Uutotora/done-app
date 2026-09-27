import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { api, isAdmin, levelOf, useAuth, type AccessLevel, type AccessRole, type AuthUser, type ProjectLevel } from './auth';
import { useData } from './store';
import { COLORS } from './constants';
import type { ID, LocalAccess, Person } from './types';

/**
 * People of the workspace with their access, in one shape for both modes:
 * accounts on the server (source of truth for roles) and the local demo,
 * where access is kept on the person record so the whole model can be tried out.
 */
export interface Member {
  id: ID;
  name: string;
  email?: string;
  person?: Person;
  role: AccessRole;
  projectIds: ID[] | null;
  projectRoles: Record<ID, ProjectLevel>;
  canCreateProjects: boolean;
  suspended: boolean;
  lastSeen?: number | null;
  isMe: boolean;
}

export interface PendingInvite {
  email: string;
  role: AccessRole;
  projectIds: ID[] | null;
  projectRoles: Record<ID, ProjectLevel>;
  canCreateProjects: boolean;
  expires: number;
  createdAt?: number;
  invitedBy?: string;
}

export interface AccessInput {
  role: AccessRole;
  projectIds: ID[] | null;
  projectRoles: Record<ID, ProjectLevel>;
  canCreateProjects: boolean;
}

export interface InviteResult {
  links: { email: string; url: string }[];
  skipped: { email: string; reason: string }[];
  /** The server sends email: addresses that got their invitation and those it could not reach. */
  mailed?: boolean;
  emailed?: string[];
  failed?: string[];
}

/** Outgoing email on the server, as administrators see it. */
export interface MailSettings {
  configured: boolean;
  from?: string;
  /** 'env': set by the server's environment; 'app': saved in Settings > Email. */
  source?: 'env' | 'app' | null;
  /** Whether this person may connect or change the mailbox (the owner, unless the environment sets it). */
  editable?: boolean;
  settings?: SavedMailSettings | null;
}

/** A mailbox saved in the app; the password never comes back from the server. */
export interface SavedMailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  name: string;
  publicUrl: string;
}

export interface MailSettingsInput extends SavedMailSettings {
  /** Empty keeps the saved password for the same login. */
  pass: string;
}

/** Why the server could not send a letter with new settings. */
export type MailProblem = 'auth' | 'host' | 'connect' | 'sender' | 'unknown';

/**
 * A shareable invite link. The team link gives `editor` or `viewer` on every project; a project link
 * gives that project at `editor`, `commenter` or `viewer`.
 */
export interface JoinLink {
  enabled: boolean;
  token: string | null;
  url: string | null;
  level: 'editor' | 'commenter' | 'viewer';
  joined: number;
  createdAt: number | null;
}
export const NO_LINK: JoinLink = { enabled: false, token: null, url: null, level: 'editor', joined: 0, createdAt: null };

export const ROLE_ORDER: AccessRole[] = ['owner', 'admin', 'editor', 'viewer'];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RemoteState {
  users: AuthUser[];
  invites: PendingInvite[];
  mail: MailSettings;
  link: JoinLink;
  loaded: boolean;
  error: string;
}
const useRemote = create<RemoteState>(() => ({ users: [], invites: [], mail: { configured: false }, link: NO_LINK, loaded: false, error: '' }));
const uiLang = () => useData.getState().prefs.lang;

let inflight: Promise<void> | null = null;
/**
 * Reloads the people of the workspace. Admins get accounts with their access and
 * pending invitations; everyone else the directory of names and roles.
 * Calls made while a request is running share it.
 */
export function refreshMembers(): Promise<void> {
  const user = useAuth.getState().user;
  if (!user) return Promise.resolve();
  inflight ??= (
    isAdmin(user)
      ? api<{ members: AuthUser[]; invites: PendingInvite[]; mail?: MailSettings; link?: JoinLink }>('/api/admin/members')
      : api<{ members: AuthUser[] }>('/api/members').then((r) => ({ members: r.members, invites: [], mail: undefined, link: undefined }))
  )
    .then((result) =>
      useRemote.setState({
        users: result.members,
        invites: result.invites,
        mail: result.mail ?? { configured: false },
        link: result.link ?? NO_LINK,
        loaded: true,
        error: '',
      }),
    )
    .catch((e: Error) => useRemote.setState({ error: e.message, loaded: true }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const localAccess = (p: Person, meId: ID): LocalAccess => p.access ?? { role: p.id === meId ? 'owner' : 'editor', projectIds: null };

export function useMembers() {
  const mode = useAuth((s) => s.mode);
  const user = useAuth((s) => s.user);
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const remote = useRemote();
  const signedIn = mode === 'signedIn';
  // Someone joining or leaving changes the people of the workspace, which arrives live.
  const headcount = Object.values(people).filter((p) => !p.removed).length;
  useEffect(() => {
    if (signedIn) void refreshMembers();
  }, [signedIn, user?.id, user?.role, headcount]);

  const members = useMemo<Member[]>(() => {
    if (signedIn)
      return sortMembers(
        remote.users.map<Member>((u) => ({
          id: u.id,
          name: people[u.id]?.name ?? u.name,
          email: u.email,
          person: people[u.id],
          role: u.role,
          // The directory for non-admins has no project access; null keeps the shape.
          projectIds: u.projectIds ?? null,
          projectRoles: u.projectRoles ?? {},
          canCreateProjects: u.role !== 'viewer' && u.canCreateProjects !== false,
          suspended: !!u.disabled,
          lastSeen: u.lastSeen,
          isMe: u.id === user?.id,
        })),
      );
    return sortMembers(
      Object.values(people)
        .filter((p) => !p.removed)
        .map((p) => {
          const a = localAccess(p, meId);
          return {
            id: p.id,
            name: p.name,
            email: p.email,
            person: p,
            role: a.role,
            projectIds: a.projectIds,
            projectRoles: a.projectRoles ?? {},
            canCreateProjects: a.role !== 'viewer' && a.canCreateProjects !== false,
            suspended: !!a.suspended,
            lastSeen: p.id === meId ? Date.now() : null,
            isMe: p.id === meId,
          };
        }),
    );
  }, [signedIn, user, remote.users, people, meId]);

  return {
    members,
    invites: signedIn ? remote.invites : [],
    mail: signedIn ? remote.mail : { configured: false },
    link: signedIn ? withJoinUrl(remote.link) : NO_LINK,
    loaded: !signedIn || remote.loaded,
    error: signedIn ? remote.error : '',
    remote: signedIn,
  };
}

function sortMembers(list: Member[]): Member[] {
  return list.sort(
    (a, b) => Number(b.isMe) - Number(a.isMe) || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name),
  );
}

/** Level of a member in a project, or null. */
export function memberLevel(m: Member, projectId: ID): AccessLevel | null {
  return levelOf({ id: m.id, name: m.name, email: m.email ?? '', role: m.role, projectIds: m.projectIds, projectRoles: m.projectRoles }, projectId);
}

/** Who may change a member: owners everyone but themselves, admins editors and viewers. */
export function canManageMember(actor: { id: ID; role: AccessRole } | null, target: Member): boolean {
  if (!actor || target.isMe) return false;
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && (target.role === 'editor' || target.role === 'viewer');
}

export function canAssignRole(actor: { role: AccessRole } | null, role: AccessRole): boolean {
  if (!actor) return false;
  return actor.role === 'owner' || (actor.role === 'admin' && (role === 'editor' || role === 'viewer'));
}

/** The acting person: the account, or the owner of the local demo. */
export function useActor(): { id: ID; role: AccessRole } | null {
  const mode = useAuth((s) => s.mode);
  const user = useAuth((s) => s.user);
  const meId = useData((s) => s.meId);
  const me = useData((s) => s.people[s.meId]);
  if (mode === 'signedIn') return user ? { id: user.id, role: user.role } : null;
  return { id: meId, role: me?.access?.role ?? 'owner' };
}

const nameFromEmail = (email: string) => {
  const local = email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim();
  return local ? local.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : email;
};

export const inviteUrl = (token: string, email: string) =>
  `${window.location.origin}/?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

/** The server builds the link from its public address; without one it is made from this page's origin. */
export const withJoinUrl = (link: JoinLink): JoinLink =>
  link.token && !link.url ? { ...link, url: `${window.location.origin}/?join=${encodeURIComponent(link.token)}` } : link;

/**
 * Turns the team's invite link on or off, changes the role it gives, or replaces it (`reset`),
 * after which the old link stops working.
 */
export async function updateJoinLink(patch: { enabled?: boolean; level?: 'editor' | 'viewer'; reset?: boolean }): Promise<JoinLink> {
  const { link } = await api<{ link: JoinLink }>('/api/admin/invite-link', 'POST', patch);
  useRemote.setState({ link });
  return withJoinUrl(link);
}

/** A project's invite link (administrators only). */
export async function getProjectJoinLink(projectId: ID): Promise<JoinLink> {
  const { link } = await api<{ link: JoinLink }>(`/api/projects/${encodeURIComponent(projectId)}/invite-link`);
  return withJoinUrl(link);
}

/** Creates, turns off, changes the level of, or resets a project's invite link. */
export async function updateProjectJoinLink(
  projectId: ID,
  patch: { enabled?: boolean; level?: JoinLink['level']; reset?: boolean },
): Promise<JoinLink> {
  const { link } = await api<{ link: JoinLink }>(`/api/projects/${encodeURIComponent(projectId)}/invite-link`, 'POST', patch);
  return withJoinUrl(link);
}

function cleanAccess(input: AccessInput): AccessInput {
  const admin = input.role === 'owner' || input.role === 'admin';
  // Viewers never edit: a project where someone could edit falls back to the viewer default.
  const projectRoles = Object.fromEntries(
    Object.entries(input.projectRoles).filter(([, level]) => input.role !== 'viewer' || level !== 'editor'),
  ) as Record<ID, ProjectLevel>;
  return {
    role: input.role,
    projectIds: admin ? null : input.projectIds,
    projectRoles: admin ? {} : projectRoles,
    canCreateProjects: input.role === 'viewer' ? false : admin || input.canCreateProjects,
  };
}

export async function inviteMembers(emails: string[], input: AccessInput): Promise<InviteResult> {
  const access = cleanAccess(input);
  if (useAuth.getState().mode === 'signedIn') {
    const result = await api<{
      invites: { email: string; token: string; url?: string | null }[];
      skipped: { email: string; reason: string }[];
      emailed?: string[];
      failed?: string[];
    }>('/api/admin/invites', 'POST', { emails, ...access, lang: uiLang() });
    await refreshMembers();
    return {
      // The server builds links from its public address when it has one.
      links: result.invites.map((i) => ({ email: i.email, url: i.url || inviteUrl(i.token, i.email) })),
      skipped: result.skipped,
      // Without email on the server both lists are empty.
      mailed: !!(result.emailed?.length || result.failed?.length),
      emailed: result.emailed ?? [],
      failed: result.failed ?? [],
    };
  }
  // Local demo: people are added right away; there is nobody to accept an invitation.
  const s = useData.getState();
  const byEmail = new Map(Object.values(s.people).map((p) => [p.email?.toLowerCase(), p]));
  const skipped: InviteResult['skipped'] = [];
  let n = Object.keys(s.people).length;
  for (const email of emails) {
    const known = byEmail.get(email);
    if (known?.removed) {
      // Someone who left comes back with their old name and history.
      s.updatePerson(known.id, { removed: false, access, invitedAt: new Date().toISOString() });
      continue;
    }
    if (known) {
      skipped.push({ email, reason: 'exists' });
      continue;
    }
    s.addPerson({
      name: nameFromEmail(email),
      email,
      color: COLORS[n++ % COLORS.length],
      access,
      invitedAt: new Date().toISOString(),
    });
  }
  return { links: [], skipped };
}

export async function updateMember(member: Member, patch: Partial<AccessInput> & { suspended?: boolean }) {
  const next = cleanAccess({
    role: patch.role ?? member.role,
    projectIds: patch.projectIds !== undefined ? patch.projectIds : member.projectIds,
    projectRoles: patch.projectRoles ?? member.projectRoles,
    canCreateProjects: patch.canCreateProjects ?? member.canCreateProjects,
  });
  if (useAuth.getState().mode === 'signedIn') {
    await api(`/api/admin/members/${member.id}`, 'PATCH', { ...next, ...(patch.suspended !== undefined ? { disabled: patch.suspended } : {}) });
    await refreshMembers();
    return;
  }
  useData.getState().updatePerson(member.id, { access: { ...next, suspended: patch.suspended ?? member.suspended } });
}

export async function removeMember(member: Member) {
  if (useAuth.getState().mode === 'signedIn') {
    await api(`/api/admin/members/${member.id}`, 'DELETE', {});
    await refreshMembers();
    return;
  }
  // Like the server: the person stays on past work but leaves the workspace.
  useData.getState().updatePerson(member.id, { removed: true, access: undefined });
}

/** Gives, changes or takes away access to one project, with the same rules as the server. */
export async function setProjectLevel(member: Member, projectId: ID, level: ProjectLevel | null) {
  if (useAuth.getState().mode === 'signedIn') {
    await api(`/api/projects/${encodeURIComponent(projectId)}/access`, 'PUT', { userId: member.id, level });
    await refreshMembers();
    return;
  }
  const projectRoles = { ...member.projectRoles };
  let projectIds = member.projectIds;
  if (level === null) {
    if (projectIds === null) return;
    projectIds = projectIds.filter((id) => id !== projectId);
    delete projectRoles[projectId];
  } else {
    if (projectIds !== null && !projectIds.includes(projectId)) projectIds = [...projectIds, projectId];
    if (level === (member.role === 'viewer' ? 'viewer' : 'editor')) delete projectRoles[projectId];
    else projectRoles[projectId] = level;
  }
  await updateMember(member, { projectIds, projectRoles });
}

export async function revokeInvite(email: string) {
  await api('/api/admin/invites', 'DELETE', { email });
  await refreshMembers();
}

/**
 * A fresh link for a pending invitation, with the same access (the old link stops working).
 * When the server sends email, the invitation goes out again.
 */
export async function renewInvite(invite: PendingInvite): Promise<{ url: string; emailed: boolean }> {
  const result = await api<{ token: string; url?: string | null; emailed?: boolean }>('/api/admin/invites/resend', 'POST', {
    email: invite.email,
    lang: uiLang(),
  });
  await refreshMembers();
  return { url: result.url || inviteUrl(result.token, invite.email), emailed: !!result.emailed };
}

/** A one-time link to set a new password, emailed to the member when the server sends email. */
export async function createResetLink(member: Member): Promise<{ url: string; emailed: boolean; expires: number }> {
  const result = await api<{ token: string; url?: string | null; emailed?: boolean; expires: number }>(
    `/api/admin/members/${encodeURIComponent(member.id)}/reset`,
    'POST',
    { lang: uiLang() },
  );
  return {
    url: result.url || `${window.location.origin}/?reset=${encodeURIComponent(result.token)}`,
    emailed: !!result.emailed,
    expires: result.expires,
  };
}

/**
 * Connects the team's mailbox: the server signs in and sends a test letter to the owner,
 * and saves the settings only when that worked. Rejects with `problem` or `field` otherwise.
 */
export async function saveMailSettings(input: MailSettingsInput): Promise<{ to: string }> {
  const result = await api<{ mail: MailSettings; to: string }>('/api/admin/mail', 'PUT', { ...input, lang: uiLang() });
  useRemote.setState({ mail: result.mail });
  return { to: result.to };
}

/** Stops sending email from the saved mailbox. */
export async function removeMailSettings(): Promise<void> {
  const result = await api<{ mail: MailSettings }>('/api/admin/mail', 'DELETE', {});
  useRemote.setState({ mail: result.mail });
}

/** Sends a test email to the administrator's own address; resolves to that address. */
export async function sendTestMail(): Promise<string> {
  const result = await api<{ to: string }>('/api/admin/mail/test', 'POST', { lang: uiLang() });
  return result.to;
}

/** Invitation text for a mail client, for when the server does not send email itself. */
export function inviteMailto(email: string, url: string, workspace: string, lang: 'ru' | 'en'): string {
  const team = workspace.trim();
  const subject = lang === 'ru' ? `Приглашение в ${team ? `«${team}»` : 'Done'}` : `Join ${team || 'Done'}`;
  const body =
    lang === 'ru'
      ? `Привет!\n\nПриглашаю тебя в ${team ? `команду «${team}» в Done` : 'нашу команду в Done'}. Открой ссылку, чтобы создать аккаунт (действует 7 дней):\n\n${url}\n`
      : `Hi!\n\nJoin ${team ? `the ${team} team on Done` : 'our team on Done'}. Open this link to create your account (valid for 7 days):\n\n${url}\n`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
