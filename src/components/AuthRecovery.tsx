import { ArrowLeft, ArrowRight, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, enterAccount, useAuth, type AuthUser } from '@/lib/auth';
import { toast } from '@/lib/ui';
import { Button } from './ui/Button';
/** "Forgot password?": asks for the address and sends a reset link when the server has email. */
export function ForgotPassword({ ru, initialEmail, onBack }: { ru: boolean; initialEmail: string; onBack: (email?: string) => void }) {
  const mail = useAuth((s) => s.mail);
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/reset/request', 'POST', { email, lang: ru ? 'ru' : 'en' });
      setSent(true);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(
        status === 429
          ? ru
            ? 'Слишком много попыток. Попробуйте через 15 минут.'
            : 'Too many attempts. Try again in 15 minutes.'
          : status === 400
            ? ru
              ? 'Проверьте адрес почты.'
              : 'Check the email address.'
            : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div key={sent ? 'forgot-sent' : 'forgot'} className="auth-card auth-recovery-card">
      <button onClick={() => onBack(email)} className="mb-7 flex items-center gap-1 rounded px-1 py-1 text-[13px] text-fg-3 hover:bg-hover">
        <ArrowLeft size={14} />
        {ru ? 'Ко входу' : 'Back to sign in'}
      </button>
      {sent ? (
        <>
          <p className="state-eyebrow">{ru ? 'Ещё один шаг' : 'One more step'}</p>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{ru ? 'Проверьте почту' : 'Check your email'}</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-fg-2">
            {ru
              ? `Если для ${email} есть аккаунт, мы отправили на этот адрес ссылку для нового пароля. Она действует 1 час.`
              : `If there is an account for ${email}, we sent a link to set a new password to that address. It works for 1 hour.`}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-3">
            {ru
              ? 'Письма нет? Проверьте папку «Спам» или попросите администратора прислать ссылку.'
              : 'No email? Check your spam folder or ask your administrator for a link.'}
          </p>
          <Button onClick={() => onBack(email)} className="mt-7 w-full !bg-fg !text-bg hover:opacity-90" size="lg">
            {ru ? 'Вернуться ко входу' : 'Back to sign in'}
          </Button>
          <button
            onClick={() => {
              setSent(false);
              setError('');
            }}
            className="mt-4 w-full text-[13px] text-fg-3 hover:text-fg"
          >
            {ru ? 'Указать другую почту' : 'Use a different email'}
          </button>
        </>
      ) : (
        <>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{ru ? 'Забыли пароль?' : 'Forgot your password?'}</h1>
          <p className="mb-6 mt-2 text-[14px] leading-relaxed text-fg-3">
            {ru
              ? 'Укажите почту, с которой входите в Done, и мы пришлем ссылку, чтобы задать новый пароль.'
              : 'Enter the email you use for Done and we will send you a link to set a new password.'}
          </p>
          {mail ? (
            <form onSubmit={submit} className="space-y-4">
              <label className="block text-[13px] font-medium">
                Email
                <input
                  required
                  autoFocus
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input"
                  placeholder="you@company.com"
                />
              </label>
              {error && (
                <p role="alert" className="rounded-md bg-[var(--c-red-bg)] p-3 text-[13px] text-[var(--c-red-text)]">
                  {error}
                </p>
              )}
              <Button type="submit" loading={busy} className="w-full !bg-fg !text-bg hover:opacity-90" size="lg" iconRight={<ArrowRight size={16} />}>
                {ru ? 'Прислать ссылку' : 'Send reset link'}
              </Button>
            </form>
          ) : (
            <p className="flex gap-2.5 rounded-lg bg-subtle p-3 text-[13px] leading-relaxed text-fg-2">
              <Mail size={15} className="mt-0.5 shrink-0 text-fg-3" />
              {ru
                ? 'Сброс пароля по почте не настроен. Попросите администратора прислать ссылку для сброса.'
                : 'Password reset by email is not set up. Ask your administrator to send you a reset link.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The page behind a reset link: a new password (twice), then the person is signed in. */
export function ResetPassword({ ru, token, onForgot, onSignIn }: { ru: boolean; token: string; onForgot: () => void; onSignIn: () => void }) {
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'unavailable'>('checking');
  const [retry, setRetry] = useState(0);
  const [account, setAccount] = useState<{ email: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tooMany = ru ? 'Слишком много попыток. Попробуйте через 15 минут.' : 'Too many attempts. Try again in 15 minutes.';
  useEffect(() => {
    let alive = true;
    setState('checking');
    setError('');
    api<{ email: string; name: string }>('/api/auth/reset/check', 'POST', { token })
      .then((result) => {
        if (!alive) return;
        setAccount(result);
        setState('ready');
      })
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        if (e.status === 410) setState('invalid');
        else {
          setError(
            e.status === 429
              ? tooMany
              : ru
                ? 'Проверьте подключение и попробуйте ещё раз. Ваша ссылка может быть в порядке.'
                : 'Check your connection and try again. Your link may still be valid.',
          );
          setState('unavailable');
        }
      });
    return () => {
      alive = false;
    };
  }, [token, tooMany, ru, retry]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 12) return setError(ru ? 'Пароль должен быть не короче 12 символов.' : 'Use at least 12 characters.');
    if (password !== confirm) return setError(ru ? 'Пароли не совпадают.' : 'The passwords do not match.');
    setBusy(true);
    setError('');
    try {
      const result = await api<{ user: AuthUser }>('/api/auth/reset', 'POST', { token, password });
      // The link is used up: it leaves the address bar and the history entry.
      window.history.replaceState({}, '', '/');
      sessionStorage.removeItem('done:auth-draft');
      toast({ message: ru ? 'Пароль обновлен' : 'Password updated', tone: 'success' });
      await enterAccount(result.user);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 410) setState('invalid');
      else setError(status === 429 ? tooMany : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div key={`reset-${state}`} className="auth-card auth-recovery-card">
      {state === 'checking' ? (
        <p role="status" className="text-center text-[14px] text-fg-3">
          {ru ? 'Проверяем ссылку…' : 'Checking the link…'}
        </p>
      ) : state === 'unavailable' ? (
        <>
          <h1>{ru ? 'Не удалось проверить ссылку' : 'Couldn’t check this link'}</h1>
          <p role="alert" className="auth-description">
            {error}
          </p>
          <Button className="auth-submit" onClick={() => setRetry((value) => value + 1)}>
            {ru ? 'Повторить' : 'Try again'}
          </Button>
          <button className="mt-4 w-full text-[13px] text-fg-2" onClick={onSignIn}>
            {ru ? 'Вернуться ко входу' : 'Back to sign in'}
          </button>
        </>
      ) : state === 'invalid' ? (
        <>
          <p className="state-eyebrow">{ru ? 'Давайте попробуем снова' : 'Let’s try again'}</p>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{ru ? 'Ссылка больше не работает' : 'This link no longer works'}</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-fg-2">
            {ru
              ? 'Ссылка для сброса пароля устарела или уже использована. Запросите новую — она придет на почту.'
              : 'This password reset link has expired or has already been used. Request a new one and it will arrive by email.'}
          </p>
          <Button onClick={onForgot} className="mt-7 w-full !bg-fg !text-bg hover:opacity-90" size="lg" iconRight={<ArrowRight size={16} />}>
            {ru ? 'Запросить новую ссылку' : 'Request a new link'}
          </Button>
          <button onClick={onSignIn} className="mt-4 w-full text-[13px] text-fg-3 hover:text-fg">
            {ru ? 'Вернуться ко входу' : 'Back to sign in'}
          </button>
        </>
      ) : (
        <>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{ru ? 'Новый пароль' : 'New password'}</h1>
          <p className="mb-6 mt-2 text-[14px] leading-relaxed text-fg-3">
            {account
              ? ru
                ? `Для ${account.email}. После сохранения вы войдете в Done, а остальные сеансы завершатся.`
                : `For ${account.email}. After saving you will be signed in, and other sessions will end.`
              : ru
                ? 'После сохранения вы войдете в Done, а остальные сеансы завершатся.'
                : 'After saving you will be signed in, and other sessions will end.'}
          </p>
          <form onSubmit={submit} className="space-y-4">
            {/* Lets password managers save the new password for the right account. */}
            <input type="email" autoComplete="username" value={account?.email ?? ''} readOnly hidden />
            <label className="block text-[13px] font-medium">
              {ru ? 'Новый пароль' : 'New password'}
              <input
                required
                autoFocus
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                className="auth-input"
                placeholder={ru ? 'Не менее 12 символов' : 'At least 12 characters'}
              />
            </label>
            <label className="block text-[13px] font-medium">
              {ru ? 'Повторите пароль' : 'Confirm password'}
              <input
                required
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError('');
                }}
                className="auth-input"
              />
            </label>
            {error && (
              <p role="alert" className="rounded-md bg-[var(--c-red-bg)] p-3 text-[13px] text-[var(--c-red-text)]">
                {error}
              </p>
            )}
            <Button type="submit" loading={busy} className="w-full !bg-fg !text-bg hover:opacity-90" size="lg" iconRight={<ArrowRight size={16} />}>
              {ru ? 'Сохранить и войти' : 'Save and sign in'}
            </Button>
          </form>
          <button onClick={onSignIn} className="mt-4 w-full text-[13px] text-fg-3 hover:text-fg">
            {ru ? 'Вернуться ко входу' : 'Back to sign in'}
          </button>
        </>
      )}
    </div>
  );
}
