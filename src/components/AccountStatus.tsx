import { CloudCheck, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { api, flushWorkspace, isAdmin, logout, refreshWorkspace, useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { dataSnapshot } from '@/lib/store';
import { downloadBlob } from '@/lib/utils';
import { toast } from '@/lib/ui';
import { useState } from 'react';
import { Button } from './ui/Button';
export function AccountStatus() {
  const state = useAuth();
  const ru = useLang() === 'ru';
  return (
    <div className="border-t border-line px-3 py-3 text-[12px]">
      {isAdmin(state.user) && (
        <Link to="/admin" className="mb-2 flex items-center gap-2 rounded px-1 py-1.5 text-fg-2 hover:bg-hover">
          <ShieldCheck size={15} />
          {ru ? 'Люди и доступ' : 'People & access'}
        </Link>
      )}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{state.user?.name ?? (ru ? 'Локальное демо' : 'Local demo')}</span>
        <button
          aria-label={ru ? 'Выйти' : 'Sign out'}
          onClick={() => void logout().catch((e) => toast({ message: e.message, tone: 'error' }))}
          className="rounded p-1 text-fg-3 hover:bg-hover"
        >
          <LogOut size={14} />
        </button>
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-3">
        {state.mode === 'signedIn' ? (
          <>
            {state.sync === 'saving' ? <Loader2 size={11} className="animate-spin" /> : <CloudCheck size={11} />}
            {state.sync === 'saved'
              ? ru
                ? 'Сохранено на сервере'
                : 'Saved to server'
              : state.sync === 'saving'
                ? ru
                  ? 'Сохранение…'
                  : 'Saving…'
                : ru
                  ? 'Требуется внимание'
                  : 'Needs attention'}
          </>
        ) : ru ? (
          'Хранится в этом браузере'
        ) : (
          'Stored in this browser'
        )}
      </div>
    </div>
  );
}
export function SyncNotice() {
  const { mode, sync, syncError, user } = useAuth();
  const ru = useLang() === 'ru';
  if (mode !== 'signedIn') return null;
  if (sync === 'error' || sync === 'conflict')
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-line bg-[var(--c-orange-bg)] px-4 py-2 text-[12px]">
        <span className="flex-1">
          {sync === 'conflict'
            ? ru
              ? 'Другой участник изменил пространство. Скачайте свои изменения перед загрузкой новой версии.'
              : 'Another member changed the workspace. Download your changes before loading the latest version.'
            : syncError}
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
          {ru ? 'Скачать изменения' : 'Download changes'}
        </Button>
        {sync === 'error' && (
          <Button size="xs" onClick={() => void flushWorkspace()}>
            {ru ? 'Повторить' : 'Retry'}
          </Button>
        )}
        <Button
          size="xs"
          onClick={() => {
            if (
              window.confirm(
                ru
                  ? 'Загрузить серверную версию? Несохранённые изменения будут заменены. Сначала скачайте их.'
                  : 'Load the server version? Unsaved changes will be replaced. Download them first.',
              )
            )
              void refreshWorkspace().catch((e) => toast({ message: e.message, tone: 'error' }));
          }}
        >
          {ru ? 'Загрузить версию сервера' : 'Load server version'}
        </Button>
      </div>
    );
  return user?.role === 'viewer' ? (
    <div className="border-b border-line bg-subtle px-4 py-1.5 text-[12px] text-fg-3">
      {ru ? 'Режим просмотра · для изменений нужен доступ участника' : 'Read-only · member access is required to make changes'}
    </div>
  ) : null;
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
