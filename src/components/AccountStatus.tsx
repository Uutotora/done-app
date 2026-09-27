import { ChevronDown, CircleHelp, Loader2, LogOut, Moon, Settings, ShieldCheck, Sun, UserPlus, UserRound, WifiOff } from 'lucide-react';
import { NavLink, useMatch, useNavigate } from 'react-router';
import { api, flushWorkspace, isAdmin, logout, reconnectWorkspace, refreshWorkspace, useAuth, type SyncStatus } from '@/lib/auth';
import { useLang, useT } from '@/lib/i18n';
import { dataSnapshot, useData } from '@/lib/store';
import { cn, downloadBlob } from '@/lib/utils';
import { toast, useUI } from '@/lib/ui';
import { useIsDark } from '@/lib/hooks';
import { useState } from 'react';
import { usePresence } from '@/lib/presence';
import { Avatar, AvatarStack } from './ui/bits';
import { EntriesMenu, Tooltip, type MenuEntry } from './ui/Overlay';
import { Button } from './ui/Button';
import { SIDEBAR_ICON_BUTTON } from './sidebarStyles';

/**
 * Bottom of the sidebar: who you are, not a workspace switcher. The menu holds the account,
 * sync status, inviting people, the theme and signing out.
 */
export function WorkspaceBar() {
  const t = useT();
  const ru = useLang() === 'ru';
  const navigate = useNavigate();
  const state = useAuth();
  const me = useData((s) => s.people[s.meId]);
  const people = useData((s) => s.people);
  const setPrefs = useData((s) => s.setPrefs);
  const isDark = useIsDark();
  const setShortcuts = useUI((s) => s.setShortcuts);
  const setInvite = useUI((s) => s.setInvite);
  const live = usePresence((s) => s.live);
  const peers = usePresence((s) => s.peers).filter((p) => p.id !== state.user?.id && people[p.id]);
  const signedIn = state.mode === 'signedIn';
  const canInvite = state.mode === 'local' || isAdmin(state.user);
  const onSettings = !!useMatch('/settings/*');
  const name = me?.name || state.user?.name || (ru ? 'Профиль' : 'Profile');
  const syncLabels: Record<SyncStatus, string> = {
    saved: t('sync.allSaved'),
    saving: t('sync.saving'),
    offline: t('sync.offline'),
    error: t('sync.failed'),
  };

  const header = (
    <div className="px-2.5 pb-2 pt-2">
      <div className="flex items-center gap-2.5">
        <Avatar person={me} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{name}</div>
          <div className="truncate text-[12px] text-fg-3">{state.user ? state.user.email : ru ? 'Демо в этом браузере' : 'Demo in this browser'}</div>
        </div>
      </div>
      {signedIn && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-fg-3">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              state.sync === 'error' ? 'bg-[var(--c-red-solid)]' : live && state.sync !== 'offline' ? 'bg-[var(--c-green-solid)]' : 'bg-fg-4',
            )}
          />
          {syncLabels[state.sync]}
          {peers.length > 0 && (
            <span className="ml-auto flex items-center gap-1.5" title={peers.map((p) => p.name).join(', ')}>
              <AvatarStack people={peers.map((p) => people[p.id])} size={16} max={4} />
              {ru ? 'в сети' : 'online'}
            </span>
          )}
        </div>
      )}
      <div className="mt-2 h-px bg-line" />
    </div>
  );
  const entries: MenuEntry[] = [
    { key: 'account', icon: <UserRound size={15} />, label: t('set.nav.account'), onSelect: () => navigate('/settings/account') },
    { key: 'settings', icon: <Settings size={15} />, label: t('nav.settings'), onSelect: () => navigate('/settings/preferences') },
    ...(canInvite
      ? [
          { key: 'invite', icon: <UserPlus size={15} />, label: t('profile.invite'), onSelect: () => setInvite(true) },
          {
            key: 'people',
            icon: <ShieldCheck size={15} />,
            label: ru ? 'Люди и доступ' : 'People & access',
            onSelect: () => navigate('/settings/people'),
          },
        ]
      : []),
    {
      key: 'theme',
      icon: isDark ? <Sun size={15} /> : <Moon size={15} />,
      label: isDark ? (ru ? 'Светлая тема' : 'Light theme') : ru ? 'Тёмная тема' : 'Dark theme',
      onSelect: () => setPrefs({ theme: isDark ? 'light' : 'dark' }),
    },
    { key: 's', separator: true },
    {
      key: 'logout',
      icon: <LogOut size={15} />,
      label: ru ? 'Выйти' : 'Sign out',
      onSelect: () => void logout().catch((e) => toast({ message: e.message, tone: 'error' })),
    },
  ];

  return (
    <div className="flex h-12 shrink-0 items-center gap-0.5 border-t border-[var(--sb-divider)] px-2">
      <EntriesMenu
        side="top"
        header={header}
        entries={entries}
        trigger={
          <button
            aria-label={t('profile.menu')}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 transition-colors duration-[20ms] ease-in hover:bg-[var(--sb-hover)] data-[state=open]:bg-[var(--sb-hover)]"
          >
            <Avatar person={me} size={22} />
            <span className="truncate text-[14px] font-medium text-[var(--sb-text-strong)]">{name}</span>
            <ChevronDown size={14} className="shrink-0 text-[var(--sb-icon)]" />
            {signedIn && state.sync === 'saving' && <Loader2 size={12} className="shrink-0 animate-spin text-[var(--sb-icon)]" />}
            {signedIn && state.sync === 'offline' && <WifiOff size={12} aria-label={t('sync.offline')} className="shrink-0 text-[var(--sb-icon)]" />}
            {signedIn && state.sync === 'error' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-red-solid)]" />}
          </button>
        }
      />
      {canInvite && (
        <Tooltip content={t('profile.invite')}>
          <button aria-label={t('profile.invite')} onClick={() => setInvite(true)} className={SIDEBAR_ICON_BUTTON}>
            <UserPlus size={18} strokeWidth={1.7} />
          </button>
        </Tooltip>
      )}
      <Tooltip content={t('cmd.shortcuts')} shortcut="?">
        <button aria-label={t('cmd.shortcuts')} onClick={() => setShortcuts(true)} className={SIDEBAR_ICON_BUTTON}>
          <CircleHelp size={18} strokeWidth={1.7} />
        </button>
      </Tooltip>
      <Tooltip content={t('nav.settings')}>
        <NavLink
          to="/settings"
          aria-label={t('nav.settings')}
          className={cn(SIDEBAR_ICON_BUTTON, onSettings && 'bg-[var(--sb-selected)] text-[var(--sb-text-strong)]')}
        >
          <Settings size={18} strokeWidth={1.7} />
        </NavLink>
      </Tooltip>
    </div>
  );
}
export function SyncNotice() {
  const { mode, sync, syncError } = useAuth();
  const t = useT();
  if (mode !== 'signedIn') return null;
  // Losing the network is not a failure: a calm line, edits keep working and save on their own.
  if (sync === 'offline')
    return (
      <div role="status" className="flex items-center gap-2 border-b border-line bg-subtle px-4 py-1.5 text-[12px] text-fg-2">
        <WifiOff size={13} className="shrink-0 text-fg-3" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={t('sync.offlineNotice')}>
          {t('sync.offlineNotice')}
        </span>
        <button
          type="button"
          onClick={() => void reconnectWorkspace()}
          className="shrink-0 rounded px-1.5 py-0.5 font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        >
          {t('sync.retry')}
        </button>
      </div>
    );
  if (sync === 'error')
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-line bg-[var(--c-orange-bg)] px-4 py-2 text-[12px]">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{t('sync.errorTitle')}</span>
          {syncError && <span className="text-fg-2">: {syncError}</span>}
        </span>
        <Button
          size="xs"
          onClick={() => {
            const data = structuredClone(dataSnapshot());
            data.plane.config.apiKey = '';
            data.ai.apiKey = '';
            downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'done-unsaved.json');
          }}
        >
          {t('sync.download')}
        </Button>
        <Button size="xs" onClick={() => void flushWorkspace()}>
          {t('sync.retry')}
        </Button>
        <Button
          size="xs"
          onClick={() => {
            if (window.confirm(t('sync.loadServerConfirm'))) void refreshWorkspace(true).catch((e) => toast({ message: e.message, tone: 'error' }));
          }}
        >
          {t('sync.loadServer')}
        </Button>
      </div>
    );
  return null;
}
export function PasswordSettings() {
  const user = useAuth((s) => s.user);
  const ru = useLang() === 'ru';
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!user) return null;
  return (
    <form
      className="mt-8 border-t border-line pt-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          await api('/api/auth/password', 'POST', { current, password });
          setCurrent('');
          setPassword('');
          setMessage(ru ? 'Пароль обновлён. Другие сессии завершены.' : 'Password updated. Other sessions signed out.');
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="mb-4 text-[15px] font-semibold">{ru ? 'Безопасность аккаунта' : 'Account security'}</h2>
      <p className="mb-4 text-[13px] text-fg-3">{user.email}</p>
      <label className="block text-[13px]">
        {ru ? 'Текущий пароль' : 'Current password'}
        <input
          required
          type="password"
          autoComplete="current-password"
          className="auth-input"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="mt-3 block text-[13px]">
        {ru ? 'Новый пароль' : 'New password'}
        <input
          required
          minLength={12}
          maxLength={256}
          type="password"
          autoComplete="new-password"
          className="auth-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <Button type="submit" loading={busy} className="mt-4">
        {ru ? 'Обновить пароль' : 'Update password'}
      </Button>
      {message && (
        <p role="status" className="mt-3 text-[13px] text-fg-3">
          {message}
        </p>
      )}
    </form>
  );
}
