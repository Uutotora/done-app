import { ArrowLeft, ArrowRight, KeyRound, Mail, MailCheck, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, bootstrapAuth, enterAccount, enterLocal, useAuth, type AuthUser } from '@/lib/auth';
import { createBlankData } from '@/lib/seed';
import { motion } from 'motion/react';
import { useLang } from '@/lib/i18n';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { Logo, Splash } from './Logo';
import { Button } from './ui/Button';
let started = false;

export function AuthGate({ children }: { children: ReactNode }) {
  const mode = useAuth((s) => s.mode);
  useEffect(() => {
    if (!started) {
      started = true;
      void bootstrapAuth();
    }
  }, []);
  if (mode === 'loading') return <Splash />;
  if (mode === 'signedOut') return <AuthPage />;
  return <>{children}</>;
}
function AuthPage() {
  const lang = useLang();
  const ru = lang === 'ru';
  const setup = useAuth((s) => s.setup);
  const serverError = useAuth((s) => s.error);
  const invite = new URLSearchParams(window.location.search).get('invite') ?? '';
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('reset') ?? '');
  const [screen, setScreen] = useState<'welcome' | 'form' | 'forgot' | 'reset'>(resetToken ? 'reset' : invite ? 'form' : 'welcome');
  const [register, setRegister] = useState(!!invite || setup);
  const [draft] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('done:auth-draft') || '{}');
    } catch {
      return {};
    }
  });
  const [email, setEmail] = useState(new URLSearchParams(window.location.search).get('email') ?? draft.email ?? '');
  const [name, setName] = useState(draft.name ?? '');
  const [password, setPassword] = useState('');
  const [workspace, setWorkspace] = useState(draft.workspace ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Leaves the reset link: it disappears from the address bar so a reload does not open it again. */
  const leaveReset = (next: 'form' | 'forgot') => {
    window.history.replaceState({}, '', '/');
    setResetToken('');
    setRegister(false);
    setError('');
    setScreen(next);
  };
  useEffect(() => {
    try {
      sessionStorage.setItem('done:auth-draft', JSON.stringify({ name, email, workspace }));
    } catch {
      /* private mode */
    }
  }, [name, email, workspace]);
  const title = register
    ? ru
      ? setup
        ? 'Создайте своё пространство'
        : 'Присоединяйтесь к команде'
      : setup
        ? 'Create your workspace'
        : 'Join your team'
    : ru
      ? 'С возвращением в Done'
      : 'Welcome back to Done';
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = register && setup ? createBlankData({ lang, name, role: '', workspaceName: workspace || 'Done' }) : undefined;
      if (data) {
        data.people = {};
        data.projects = {};
        data.items = {};
        data.docs = {};
        data.groups = {};
      }
      const result = await api<{ user: AuthUser }>(`/api/auth/${register ? 'register' : 'login'}`, 'POST', { email, password, name, invite, data });
      if (invite) window.history.replaceState({}, '', '/');
      sessionStorage.removeItem('done:auth-draft');
      await enterAccount(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto bg-bg px-6 py-16">
      <div
        className="pointer-events-none fixed -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #a1c4fd 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none fixed -bottom-48 -right-32 h-[560px] w-[560px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #fbc2eb 0%, transparent 70%)' }}
      />
      <div className="absolute right-5 top-4 flex gap-1">
        {(['ru', 'en'] as const).map((l) => (
          <button
            key={l}
            onClick={() => useData.getState().setPrefs({ lang: l })}
            className={`rounded-md px-2 py-1 text-[13px] font-medium uppercase ${lang === l ? 'bg-active text-fg' : 'text-fg-3 hover:bg-hover'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {screen === 'welcome' ? (
        <motion.div
          key="welcome"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-[460px] text-center"
        >
          <div className="mb-8 flex justify-center">
            <Logo size={48} animate />
          </div>
          <h1 className="mb-3 text-[40px] font-bold leading-tight tracking-[-0.02em]">{ru ? 'Добро пожаловать в Done' : 'Welcome to Done'}</h1>
          <p className="mx-auto mb-10 max-w-[400px] text-[16px] leading-relaxed text-fg-2">
            {ru
              ? 'Пространство для тех, кто ведет продукты и проекты. Роадмапы, бэклог, документы, файлы и связь с разработкой в Plane.'
              : 'A workspace for people who lead products and projects. Roadmaps, backlog, documents, files, and a connection to development in Plane.'}
          </p>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setRegister(setup);
              setScreen('form');
            }}
            iconRight={<ArrowRight size={16} />}
          >
            {ru ? 'Начать' : 'Get started'}
          </Button>
          <div className="mt-5 flex justify-center gap-5 text-[13px] text-fg-3">
            <button
              className="hover:text-fg"
              onClick={() => {
                setRegister(false);
                setScreen('form');
              }}
            >
              {ru ? 'Уже есть аккаунт? Войти' : 'Already a member? Sign in'}
            </button>
            <button className="hover:text-fg" onClick={() => void enterLocal()}>
              {ru ? 'Попробовать демо' : 'Try the demo'}
            </button>
          </div>
        </motion.div>
      ) : screen === 'forgot' ? (
        <ForgotPassword
          ru={ru}
          initialEmail={email}
          onBack={(value) => {
            if (value) setEmail(value);
            setRegister(false);
            setScreen('form');
          }}
        />
      ) : screen === 'reset' ? (
        <ResetPassword
          ru={ru}
          token={resetToken}
          onForgot={() => leaveReset('forgot')}
          onSignIn={() => {
            leaveReset('form');
            // A browser that is still signed in goes back to its workspace.
            api<{ user: AuthUser | null }>('/api/auth/session')
              .then((result) => result.user && enterAccount(result.user))
              .catch(() => undefined);
          }}
        />
      ) : (
        <motion.div
          key="form"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="relative my-auto w-full max-w-[400px]"
        >
          <button
            onClick={() => setScreen('welcome')}
            className="mb-7 flex items-center gap-1 rounded px-1 py-1 text-[13px] text-fg-3 hover:bg-hover"
          >
            <ArrowLeft size={14} />
            {ru ? 'Назад' : 'Back'}
          </button>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
          <p className="mb-6 mt-2 text-[14px] text-fg-3">
            {ru
              ? register
                ? 'Одно место для вашей команды и проектов.'
                : 'Продолжите с того места, где остановились.'
              : register
                ? 'One place for your team and projects.'
                : 'Pick up right where you left off.'}
          </p>
          <form onSubmit={submit} className="space-y-4">
            {register && (
              <label className="block text-[13px] font-medium">
                {ru ? 'Имя' : 'Name'}
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="auth-input"
                  placeholder={ru ? 'Как к вам обращаться' : 'Your name'}
                />
              </label>
            )}
            {register && setup && (
              <label className="block text-[13px] font-medium">
                {ru ? 'Название пространства' : 'Workspace name'}
                <input
                  required
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  className="auth-input"
                  placeholder={ru ? 'Команда продукта' : 'Product team'}
                />
              </label>
            )}
            <label className="block text-[13px] font-medium">
              Email
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input"
                placeholder="you@company.com"
              />
            </label>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="auth-password" className="text-[13px] font-medium">
                  {ru ? 'Пароль' : 'Password'}
                </label>
                {!register && (
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setScreen('forgot');
                    }}
                    className="text-[12.5px] text-fg-3 hover:text-fg"
                  >
                    {ru ? 'Забыли пароль?' : 'Forgot password?'}
                  </button>
                )}
              </div>
              <input
                id="auth-password"
                required
                type="password"
                minLength={register ? 12 : 1}
                maxLength={256}
                autoComplete={register ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="auth-input"
                placeholder={register ? (ru ? 'Не менее 12 символов' : 'At least 12 characters') : '••••••••••••'}
              />
            </div>
            {(error || serverError) && (
              <p role="alert" className="rounded-md bg-[var(--c-red-bg)] p-3 text-[13px] text-[var(--c-red-text)]">
                {error || serverError}
              </p>
            )}
            <Button type="submit" loading={busy} className="w-full !bg-fg !text-bg hover:opacity-90" size="lg" iconRight={<ArrowRight size={16} />}>
              {register ? (ru ? 'Создать аккаунт' : 'Create account') : ru ? 'Войти' : 'Sign in'}
            </Button>
          </form>
          {(setup || invite) && (
            <button
              className="mt-4 w-full text-[13px] text-fg-3 hover:text-fg"
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? (ru ? 'Уже есть аккаунт? Войти' : 'Already have an account? Sign in') : ru ? 'Создать аккаунт' : 'Create account'}
            </button>
          )}
          {!setup && !invite && (
            <p className="mt-4 flex items-center gap-2 text-[12px] text-fg-3">
              <Mail size={14} />
              {ru ? 'Для регистрации попросите приглашение у администратора.' : 'Ask your administrator for an invitation to join.'}
            </p>
          )}
          <div className="my-7 border-t border-line" />
          <button
            onClick={() => void enterLocal()}
            className="flex w-full items-center justify-center gap-2 rounded-md py-2 text-[13px] text-fg-2 hover:bg-hover"
          >
            <Users size={15} />
            {ru ? 'Посмотреть локальное демо' : 'Explore the local demo'}
          </button>
          <p className="mt-1 text-center text-[11px] text-fg-3">
            {ru ? 'Без аккаунта · данные только в этом браузере' : 'No account · data stays in this browser'}
          </p>
        </motion.div>
      )}
    </div>
  );
}

/** "Forgot password?": asks for the address and sends a reset link when the server has email. */
function ForgotPassword({ ru, initialEmail, onBack }: { ru: boolean; initialEmail: string; onBack: (email?: string) => void }) {
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
    <motion.div
      key={sent ? 'forgot-sent' : 'forgot'}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="relative my-auto w-full max-w-[400px]"
    >
      <button onClick={() => onBack(email)} className="mb-7 flex items-center gap-1 rounded px-1 py-1 text-[13px] text-fg-3 hover:bg-hover">
        <ArrowLeft size={14} />
        {ru ? 'Ко входу' : 'Back to sign in'}
      </button>
      {sent ? (
        <>
          <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--c-green-bg)] text-[var(--c-green-text)]">
            <MailCheck size={22} />
          </span>
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
    </motion.div>
  );
}

/** The page behind a reset link: a new password (twice), then the person is signed in. */
function ResetPassword({ ru, token, onForgot, onSignIn }: { ru: boolean; token: string; onForgot: () => void; onSignIn: () => void }) {
  const [state, setState] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [account, setAccount] = useState<{ email: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tooMany = ru ? 'Слишком много попыток. Попробуйте через 15 минут.' : 'Too many attempts. Try again in 15 minutes.';
  useEffect(() => {
    let alive = true;
    api<{ email: string; name: string }>('/api/auth/reset/check', 'POST', { token })
      .then((result) => {
        if (!alive) return;
        setAccount(result);
        setState('ready');
      })
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        if (e.status === 429) {
          setError(tooMany);
          setState('ready');
        } else setState('invalid');
      });
    return () => {
      alive = false;
    };
  }, [token, tooMany]);
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
    <motion.div
      key={`reset-${state}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="relative my-auto w-full max-w-[400px]"
    >
      {state === 'checking' ? (
        <p className="text-center text-[14px] text-fg-3">{ru ? 'Проверяем ссылку…' : 'Checking the link…'}</p>
      ) : state === 'invalid' ? (
        <>
          <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--c-red-bg)] text-[var(--c-red-text)]">
            <KeyRound size={21} />
          </span>
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
    </motion.div>
  );
}
