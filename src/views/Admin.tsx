import { Copy, MailPlus, Shield, ShieldCheck, Users, History, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, isAdmin, useAuth, type AccessRole, type AuthUser } from '@/lib/auth';
import { useData } from '@/lib/store';
import { useLang } from '@/lib/i18n';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';

const labels = {
  ru: { owner: 'Владелец', admin: 'Администратор', member: 'Участник', viewer: 'Наблюдатель' },
  en: { owner: 'Owner', admin: 'Administrator', member: 'Member', viewer: 'Viewer' },
};
interface Invite {
  email: string;
  role: AccessRole;
  expires: number;
}
interface Audit {
  id: number;
  name: string;
  action: string;
  detail: string;
  at: string;
}
export default function Admin() {
  const lang = useLang();
  const ru = lang === 'ru';
  const user = useAuth((s) => s.user);
  const projects = useData((s) => s.projects);
  const [members, setMembers] = useState<AuthUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [events, setEvents] = useState<Audit[]>([]);
  const [tab, setTab] = useState<'members' | 'audit'>('members');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AuthUser | 'invite' | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AccessRole>('member');
  const [scope, setScope] = useState<string[] | null>(null);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const refresh = async () => {
    try {
      const [m, a] = await Promise.all([
        api<{ members: AuthUser[]; invites: Invite[] }>('/api/admin/members'),
        api<{ events: Audit[] }>('/api/admin/audit'),
      ]);
      setMembers(m.members);
      setInvites(m.invites);
      setEvents(a.events);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (isAdmin(user)) void refresh();
  }, [user?.id]);
  if (!isAdmin(user))
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Shield size={32} />
        <h1 className="text-xl font-semibold">{ru ? 'Доступ только администраторам' : 'Administrators only'}</h1>
        <p className="text-fg-3">{ru ? 'Войдите в аккаунт с нужными правами.' : 'Sign in with an administrator account.'}</p>
      </div>
    );
  function edit(member: AuthUser | 'invite') {
    setEditing(member);
    setEmail(typeof member === 'string' ? '' : member.email);
    setRole(typeof member === 'string' ? 'member' : member.role);
    setScope(typeof member === 'string' ? null : member.projectIds);
    setError('');
    setLink('');
    setCopied(false);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing === 'invite') {
        const result = await api<{ token: string; email: string }>('/api/admin/invites', 'POST', { email, role, projectIds: scope });
        setLink(`${window.location.origin}/?invite=${encodeURIComponent(result.token)}&email=${encodeURIComponent(result.email)}`);
      } else if (editing) {
        await api(`/api/admin/members/${editing.id}`, 'PATCH', { role, projectIds: scope });
        setEditing(null);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(member: AuthUser) {
    setBusy(true);
    try {
      await api(`/api/admin/members/${member.id}`, 'PATCH', { disabled: !member.disabled });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar crumbs={[{ label: ru ? 'Администрирование' : 'Administration', icon: 'icon:shield:gray' }]} />
      <div className="full-width min-h-0 flex-1 overflow-y-auto pb-20 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-[30px] font-bold tracking-tight">
              <ShieldCheck size={28} strokeWidth={1.5} />
              {ru ? 'Люди и доступ' : 'People & access'}
            </h1>
            <p className="mt-2 text-[14px] text-fg-3">
              {ru ? 'Кто в команде, что видит и что может менять.' : 'Who belongs, what they see, and what they can change.'}
            </p>
          </div>
          <Button variant="primary" icon={<MailPlus size={15} />} onClick={() => edit('invite')}>
            {ru ? 'Пригласить' : 'Invite member'}
          </Button>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            { label: ru ? 'Участники' : 'Members', n: members.filter((m) => !m.disabled).length },
            { label: ru ? 'Администраторы' : 'Administrators', n: members.filter((m) => isAdmin(m) && !m.disabled).length },
            { label: ru ? 'Ожидают приглашения' : 'Pending invitations', n: invites.length },
          ].map((metric) => (
            <div key={metric.label} className="rounded-lg border border-line px-4 py-3">
              <p className="text-[12px] text-fg-3">{metric.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{metric.n}</p>
            </div>
          ))}
        </div>
        <div className="mb-4 mt-7 flex gap-5 border-b border-line">
          {(['members', 'audit'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 border-b-2 pb-3 text-[13px] ${tab === key ? 'border-fg font-medium' : 'border-transparent text-fg-3'}`}
            >
              {key === 'members' ? <Users size={15} /> : <History size={15} />}
              {key === 'members' ? (ru ? 'Участники и приглашения' : 'Members & invitations') : ru ? 'Журнал безопасности' : 'Security log'}
            </button>
          ))}
        </div>
        {error && !editing && (
          <p role="alert" className="mb-4 text-[13px] text-[var(--c-red-text)]">
            {error}
          </p>
        )}
        {tab === 'members' ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[650px] text-left text-[13px]">
                <thead className="bg-subtle text-[12px] text-fg-3">
                  <tr>
                    {[ru ? 'Участник' : 'Member', ru ? 'Роль' : 'Role', ru ? 'Проекты' : 'Projects', ru ? 'Доступ' : 'Access', ''].map((title, i) => (
                      <th key={i} className="px-4 py-2 font-medium">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-t border-line">
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {m.name} {m.id === user?.id && <span className="text-fg-3">({ru ? 'вы' : 'you'})</span>}
                        </div>
                        <div className="text-[12px] text-fg-3">{m.email}</div>
                      </td>
                      <td className="px-4 py-3">{labels[lang][m.role]}</td>
                      <td className="px-4 py-3 text-fg-3">
                        {m.projectIds === null ? (ru ? 'Все проекты' : 'All projects') : `${m.projectIds.length} ${ru ? 'проектов' : 'projects'}`}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-[12px] ${m.disabled ? 'bg-hover text-fg-3' : 'bg-[var(--c-green-bg)] text-[var(--c-green-text)]'}`}
                        >
                          {m.disabled ? (ru ? 'Приостановлен' : 'Suspended') : ru ? 'Активен' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {m.id !== user?.id && m.role !== 'owner' && (m.role !== 'admin' || user?.role === 'owner') && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => edit(m)}>
                              {ru ? 'Изменить' : 'Edit'}
                            </Button>
                            <Button disabled={busy} size="sm" variant="ghost" onClick={() => void toggle(m)}>
                              {m.disabled ? (ru ? 'Вернуть доступ' : 'Restore') : ru ? 'Приостановить' : 'Suspend'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invites.length > 0 && (
              <section className="mt-7">
                <h2 className="mb-3 text-[13px] font-semibold">{ru ? 'Приглашения · действуют 7 дней' : 'Invitations · valid for 7 days'}</h2>
                {invites.map((inv) => (
                  <div key={inv.email} className="flex items-center justify-between gap-3 border-b border-line py-3 text-[13px]">
                    <span>
                      {inv.email}
                      <span className="ml-3 text-fg-3">{labels[lang][inv.role]}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await api('/api/admin/invites', 'DELETE', { email: inv.email });
                          await refresh();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      {ru ? 'Отозвать' : 'Revoke'}
                    </Button>
                  </div>
                ))}
              </section>
            )}
            <div className="mt-8 grid gap-4 text-[12px] text-fg-3 sm:grid-cols-3">
              <p>
                <strong className="mb-1 block text-fg-2">{labels[lang].admin}</strong>
                {ru
                  ? 'Управляет пространством, участниками и доступами. Назначается владельцем.'
                  : 'Manages workspace, members, and permissions. Appointed by the owner.'}
              </p>
              <p>
                <strong className="mb-1 block text-fg-2">{labels[lang].member}</strong>
                {ru ? 'Редактирует задачи, документы и доступные проекты.' : 'Edits tasks, documents, and permitted projects.'}
              </p>
              <p>
                <strong className="mb-1 block text-fg-2">{labels[lang].viewer}</strong>
                {ru ? 'Просматривает доступные проекты. Не может изменять данные.' : 'Views permitted projects. Cannot change data.'}
              </p>
            </div>
          </>
        ) : (
          <div className="divide-y divide-line">
            {events.map((e) => (
              <div key={e.id} className="flex flex-wrap items-start gap-3 py-3 text-[13px]">
                <Shield size={15} className="mt-0.5 text-fg-3" />
                <div className="min-w-0 flex-1">
                  <div>{e.action}</div>
                  <div className="break-words text-[12px] text-fg-3">
                    {e.name} · {e.detail}
                  </div>
                </div>
                <time className="text-[12px] text-fg-3">{new Date(e.at).toLocaleString(lang)}</time>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v && !busy) setEditing(null);
        }}
        title={ru ? 'Настроить доступ' : 'Configure access'}
        className="max-w-[480px] overflow-y-auto"
      >
        <form onSubmit={save} className="p-6">
          <h2 className="mb-1 text-xl font-semibold">
            {editing === 'invite' ? (ru ? 'Пригласить в команду' : 'Invite to your team') : ru ? 'Права участника' : 'Member permissions'}
          </h2>
          <p className="mb-5 text-[13px] text-fg-3">
            {ru ? 'Дайте доступ к нужным проектам и выберите роль.' : 'Choose a role and the projects they can access.'}
          </p>
          {link ? (
            <>
              <div className="mb-4 rounded-md bg-[var(--c-green-bg)] p-3 text-[13px] text-[var(--c-green-text)]">
                {ru
                  ? 'Приглашение создано. Передайте ссылку коллеге — письмо автоматически не отправляется.'
                  : 'Invitation created. Share this link with your colleague. No email is sent automatically.'}
              </div>
              <input
                readOnly
                aria-label={ru ? 'Ссылка приглашения' : 'Invitation link'}
                value={link}
                className="auth-input"
                onFocus={(e) => e.target.select()}
              />
              <Button
                className="mt-3"
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    setError(ru ? 'Скопируйте ссылку из поля.' : 'Copy the link from the field.');
                  }
                }}
              >
                {copied ? (ru ? 'Скопировано' : 'Copied') : ru ? 'Скопировать ссылку' : 'Copy link'}
              </Button>
              <Button type="button" className="ml-2 mt-3" onClick={() => setEditing(null)}>
                {ru ? 'Готово' : 'Done'}
              </Button>
            </>
          ) : (
            <>
              <label className="block text-[13px]">
                Email
                <input
                  required
                  type="email"
                  disabled={editing !== 'invite'}
                  className="auth-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="mt-4 block text-[13px]">
                {ru ? 'Роль' : 'Role'}
                <select aria-label={ru ? 'Роль' : 'Role'} className="auth-input" value={role} onChange={(e) => setRole(e.target.value as AccessRole)}>
                  {(['admin', 'member', 'viewer'] as const)
                    .filter((r) => r !== 'admin' || user?.role === 'owner')
                    .map((r) => (
                      <option key={r} value={r}>
                        {labels[lang][r]}
                      </option>
                    ))}
                </select>
              </label>
              {role !== 'admin' && (
                <div className="mt-4">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={scope === null} onChange={(e) => setScope(e.target.checked ? null : [])} />
                    {ru ? 'Все проекты, включая будущие' : 'All projects, including future projects'}
                  </label>
                  {scope !== null && (
                    <div className="mt-3 max-h-44 space-y-2 overflow-y-auto rounded border border-line p-3">
                      {Object.values(projects).map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-[13px]">
                          <input
                            type="checkbox"
                            checked={scope.includes(p.id)}
                            onChange={(e) => setScope(e.target.checked ? [...scope, p.id] : scope.filter((id) => id !== p.id))}
                          />
                          {p.name || (ru ? 'Без названия' : 'Untitled')}
                        </label>
                      ))}
                      {!Object.keys(projects).length && (
                        <p className="text-[12px] text-fg-3">{ru ? 'Сначала создайте проект.' : 'Create a project first.'}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" onClick={() => setEditing(null)}>
                  {ru ? 'Отмена' : 'Cancel'}
                </Button>
                <Button type="submit" variant="primary" loading={busy}>
                  {editing === 'invite' ? (ru ? 'Создать приглашение' : 'Create invitation') : ru ? 'Сохранить права' : 'Save permissions'}
                </Button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-[13px] text-[var(--c-red-text)]">
              {error}
            </p>
          )}
        </form>
      </Dialog>
    </div>
  );
}
