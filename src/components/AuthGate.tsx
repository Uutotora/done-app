import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { api, bootstrapAuth, dismissSignedOut, enterAccount, enterLocal, useAuth, type AuthUser } from '@/lib/auth';
import { createEmptyData, useData } from '@/lib/store';
import { useLang } from '@/lib/i18n';
import { Logo, Splash } from './Logo';
import { Button } from './ui/Button';
import { ForgotPassword, ResetPassword } from './AuthRecovery';
import { WelcomeHeading } from './WelcomeHeading';
import { AuthArtwork } from './AuthArtwork';
import { AuthStationery } from './AuthStationery';
import { SignedOutScreen } from './SignedOutScreen';
import { AuthWelcomeOrnaments } from './AuthWelcomeOrnaments';
import './auth.css';

const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotionPreference(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
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
  return mode === 'signedOut' ? <AuthPage /> : <>{children}</>;
}
type Step = 'welcome' | 'setup' | 'join' | 'login' | 'checking' | 'invalid' | 'forgot' | 'reset';
interface Invitation {
  email: string;
  workspace: string;
  inviter: string;
  role: string;
  expires: number;
}
function readDraft(): { email?: string; name?: string; workspace?: string } {
  try {
    const value = JSON.parse(sessionStorage.getItem('done:auth-draft') || '{}');
    return {
      email: typeof value?.email === 'string' ? value.email : '',
      name: typeof value?.name === 'string' ? value.name : '',
      workspace: typeof value?.workspace === 'string' ? value.workspace : '',
    };
  } catch {
    return {};
  }
}
function AuthPage() {
  const lang = useLang();
  const ru = lang === 'ru';
  const { setup, error: serverError, user: currentUser, signedOutReason } = useAuth();
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(location.search).get('invite') || '');
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(location.search).get('reset') || '');
  const [step, setStep] = useState<Step>(resetToken ? 'reset' : inviteToken ? 'checking' : 'welcome');
  const [draft] = useState(readDraft);
  const [email, setEmail] = useState(draft.email || '');
  const [name, setName] = useState(draft.name || '');
  const [workspace, setWorkspace] = useState(draft.workspace || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeMotionPreference,
    () => window.matchMedia(motionQuery).matches,
    () => true,
  );
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const register = step === 'setup' || step === 'join';
  const showSignedOut = signedOutReason === 'logout' && !inviteToken && !resetToken;
  const changeStep = (next: Step) => {
    setError('');
    setPassword('');
    setShowPassword(false);
    setStep(next);
  };
  async function openDemo() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await enterLocal(true);
    } catch {
      setError(ru ? 'Не удалось открыть демо. Попробуйте ещё раз.' : 'Could not open the demo. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    try {
      sessionStorage.setItem('done:auth-draft', JSON.stringify({ name, email, workspace }));
    } catch {
      /* private browsing */
    }
  }, [name, email, workspace]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if (!inviteToken || resetToken) return;
    let live = true;
    setStep('checking');
    api<Invitation>('/api/auth/invitation', 'POST', { token: inviteToken })
      .then((value) => {
        if (!live) return;
        setInvitation(value);
        setEmail(value.email);
        setName(draft.email?.trim().toLowerCase() === value.email.toLowerCase() ? draft.name || '' : '');
        setError('');
        setStep('join');
      })
      .catch((e) => {
        if (live) {
          setError((e as { status?: number }).status === 410 ? 'expired' : 'network');
          setStep('invalid');
        }
      });
    return () => {
      live = false;
    };
  }, [inviteToken, resetToken, retry, draft]);
  function leaveLink(next: Step) {
    window.history.replaceState({}, '', '/');
    setInviteToken('');
    setResetToken('');
    setInvitation(null);
    changeStep(next);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (register && (!name.trim() || (step === 'setup' && !workspace.trim()))) {
      setError(ru ? 'Заполните имя и название пространства.' : 'Please enter your name and workspace name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let data;
      if (step === 'setup') {
        data = createEmptyData(lang);
        data.onboarded = true;
        data.workspace = { ...data.workspace, name: workspace.trim() };
        data.people = {};
      }
      const result = await api<{ user: AuthUser }>(`/api/auth/${register ? 'register' : 'login'}`, 'POST', {
        email: invitation?.email || email.trim(),
        password,
        name: name.trim(),
        data,
        ...(step === 'join' ? { invite: inviteToken } : {}),
      });
      await enterAccount(result.user);
      if (useAuth.getState().mode === 'signedIn') {
        window.history.replaceState({}, '', '/');
        sessionStorage.removeItem('done:auth-draft');
        setPassword('');
      } else setError(ru ? 'Не удалось открыть пространство. Попробуйте войти ещё раз.' : 'Could not open the workspace. Please sign in again.');
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 401)
        setError(
          ru
            ? 'Почта или пароль не совпадают. Проверьте их или восстановите пароль.'
            : 'Email or password does not match. Try again or reset your password.',
        );
      else if (status === 429) setError(ru ? 'Слишком много попыток. Попробуйте через 15 минут.' : 'Too many attempts. Try again in 15 minutes.');
      else if (status === 403 && step === 'join') {
        setError('expired');
        setStep('invalid');
      } else if (status === 403 || status === 409) {
        changeStep('login');
        setError(
          ru
            ? 'Пространство уже настроено. Войдите в аккаунт; для регистрации нужна ссылка приглашения.'
            : 'The workspace is already set up. Sign in, or open your invitation to create an account.',
        );
      } else
        setError(
          ru
            ? 'Не получилось подключиться. Ваши поля сохранены — попробуйте ещё раз.'
            : 'Could not connect. Your details are kept — please try again.',
        );
    } finally {
      setBusy(false);
    }
  }
  const role = (
    {
      owner: ru ? 'Владелец' : 'Owner',
      admin: ru ? 'Администратор' : 'Administrator',
      editor: ru ? 'Участник' : 'Member',
      viewer: ru ? 'Наблюдатель' : 'Viewer',
    } as Record<string, string>
  )[invitation?.role || ''];
  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow-blue" aria-hidden="true" />
      <div className="auth-glow auth-glow-gold" aria-hidden="true" />
      <Logo size={32} className="auth-brand" />
      <nav className="auth-language" aria-label={ru ? 'Язык' : 'Language'}>
        {(['ru', 'en'] as const).map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => useData.getState().setPrefs({ lang: l })}>
            {l.toUpperCase()}
          </button>
        ))}
      </nav>
      <div className={`auth-stage ${step === 'welcome' && !showSignedOut ? 'auth-stage-welcome' : ''}`}>
        {step === 'welcome' && !showSignedOut ? (
          <>
            <AuthWelcomeOrnaments />
            <AuthArtwork />
          </>
        ) : (
          <AuthStationery />
        )}
        {showSignedOut ? (
          <SignedOutScreen
            ru={ru}
            onContinue={() => {
              dismissSignedOut();
              changeStep('welcome');
            }}
            onDemo={() => {
              void openDemo();
            }}
            busy={busy}
            error={error}
          />
        ) : step === 'welcome' ? (
          <section className="auth-welcome">
            <WelcomeHeading ru={ru} reducedMotion={reduced} />
            <form
              className="auth-email-form"
              onSubmit={(e) => {
                e.preventDefault();
                setEmail(email.trim());
                changeStep(setup ? 'setup' : 'login');
              }}
            >
              <label htmlFor="welcome-email">{ru ? 'Ваша рабочая почта' : 'Your work email'}</label>
              <input
                id="welcome-email"
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                required
                maxLength={254}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input"
              />
              <Button type="submit" className="auth-submit" size="lg" iconRight={<ArrowRight size={16} />}>
                {ru ? 'Продолжить с почтой' : 'Continue with email'}
              </Button>
              {serverError && (
                <p role="alert" className="auth-error">
                  {ru ? 'Сервер пока недоступен. Попробуйте чуть позже.' : 'The server is unavailable. Please try again shortly.'}
                </p>
              )}
              <p className="auth-caption">
                {setup
                  ? ru
                    ? 'Первый шаг к вашему пространству.'
                    : 'Your workspace starts here.'
                  : ru
                    ? 'Вход в вашу команду. Для нового аккаунта откройте приглашение из письма.'
                    : 'Sign in to your team. To create an account, open your email invitation.'}
              </p>
            </form>
            <button
              type="button"
              className="auth-demo"
              disabled={busy}
              onClick={() => {
                void openDemo();
              }}
            >
              {ru ? 'Посмотреть демо' : 'Explore demo'}
              <ArrowRight size={13} />
            </button>
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
          </section>
        ) : step === 'forgot' ? (
          <ForgotPassword
            ru={ru}
            initialEmail={email}
            onBack={(value) => {
              if (value) setEmail(value);
              changeStep('login');
            }}
          />
        ) : step === 'reset' ? (
          <ResetPassword ru={ru} token={resetToken} onForgot={() => leaveLink('forgot')} onSignIn={() => leaveLink('welcome')} />
        ) : step === 'checking' ? (
          <section className="auth-card auth-checking">
            <h1 ref={heading} tabIndex={-1}>
              {ru ? 'Открываем приглашение…' : 'Opening your invitation…'}
            </h1>
            <p className="auth-caption" role="status">
              {ru ? 'Проверяем команду и доступ.' : 'Checking your team and access.'}
            </p>
          </section>
        ) : step === 'invalid' ? (
          <section className="auth-card">
            <Mail size={28} className="mb-6 text-fg-3" />
            <h1 ref={heading} tabIndex={-1}>
              {error === 'network'
                ? ru
                  ? 'Приглашение пока недоступно'
                  : 'Cannot open the invitation'
                : ru
                  ? 'Эта ссылка уже не действует'
                  : 'This invitation is no longer valid'}
            </h1>
            <p className="auth-description">
              {error === 'network'
                ? ru
                  ? 'Проверьте подключение и попробуйте ещё раз.'
                  : 'Check your connection and try again.'
                : ru
                  ? 'Возможно, приглашение принято, отозвано или прошло 7 дней. Если аккаунт уже создан, войдите. Иначе попросите администратора отправить новую ссылку.'
                  : 'It may have been accepted, revoked, or expired after 7 days. Sign in if you already joined, or ask your administrator for a new link.'}
            </p>
            {error === 'network' && (
              <Button className="auth-submit mb-3" onClick={() => setRetry((v) => v + 1)}>
                {ru ? 'Повторить' : 'Retry'}
              </Button>
            )}
            <Button className="auth-submit" onClick={() => leaveLink('welcome')}>
              {ru ? 'Перейти ко входу' : 'Go to sign in'}
            </Button>
          </section>
        ) : (
          <section className="auth-card">
            <button type="button" className="auth-back" disabled={busy} onClick={() => (invitation ? leaveLink('welcome') : changeStep('welcome'))}>
              <ArrowLeft size={15} />
              {ru ? 'Назад' : 'Back'}
            </button>
            {invitation && (
              <div className="auth-invite-badge">
                <ShieldCheck size={14} />
                {ru ? 'Приглашение в команду' : 'Team invitation'}
              </div>
            )}
            <h1 ref={heading} tabIndex={-1}>
              {invitation
                ? invitation.workspace
                : step === 'setup'
                  ? ru
                    ? 'Ваше начало в Done'
                    : 'Your beginning in Done'
                  : ru
                    ? 'С возвращением'
                    : 'Welcome back'}
            </h1>
            <p className="auth-description">
              {invitation
                ? ru
                  ? `${invitation.inviter} приглашает вас присоединиться. Осталось познакомиться.`
                  : `${invitation.inviter} invited you to join. Let’s get you settled in.`
                : step === 'setup'
                  ? ru
                    ? 'Как вас зовут и как назовём вашу команду?'
                    : 'What should we call you and your team?'
                  : ru
                    ? 'Введите пароль — и вы снова в команде.'
                    : 'Enter your password to get back to your team.'}
            </p>
            <div className="auth-identity">
              <Mail size={15} />
              <span>{email}</span>
              {!invitation && (
                <button type="button" disabled={busy} onClick={() => changeStep('welcome')}>
                  {ru ? 'Изменить' : 'Change'}
                </button>
              )}
              {invitation && <span className="auth-role">{role}</span>}
            </div>
            {invitation && currentUser && currentUser.email !== invitation.email && (
              <p className="auth-caption mb-4">
                {ru
                  ? `Сейчас открыт аккаунт ${currentUser.email}. После регистрации вы войдёте как ${invitation.email}.`
                  : `You are signed in as ${currentUser.email}. Registration will switch to ${invitation.email}.`}
              </p>
            )}
            <form onSubmit={submit} className="auth-details">
              {register && (
                <label>
                  {ru ? 'Имя' : 'Name'}
                  <input
                    required
                    name="name"
                    autoComplete="name"
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="auth-input"
                    placeholder={ru ? 'Как к вам обращаться' : 'Your name'}
                  />
                </label>
              )}
              {step === 'setup' && (
                <label>
                  {ru ? 'Название пространства' : 'Workspace name'}
                  <input
                    required
                    name="organization"
                    autoComplete="organization"
                    maxLength={100}
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    className="auth-input"
                    placeholder={ru ? 'Например, Команда продукта' : 'For example, Product team'}
                  />
                </label>
              )}
              <input
                type="email"
                name="username"
                autoComplete="username"
                value={email}
                readOnly
                className="sr-only"
                tabIndex={-1}
                aria-label="Email"
              />
              <div>
                <div className="auth-password-label">
                  <label htmlFor="auth-password">{register ? (ru ? 'Придумайте пароль' : 'Create a password') : ru ? 'Пароль' : 'Password'}</label>
                  {!register && (
                    <button type="button" onClick={() => changeStep('forgot')}>
                      {ru ? 'Забыли пароль?' : 'Forgot password?'}
                    </button>
                  )}
                </div>
                <div className="auth-password">
                  <input
                    id="auth-password"
                    name="password"
                    required
                    type={showPassword ? 'text' : 'password'}
                    minLength={register ? 12 : 1}
                    maxLength={256}
                    autoComplete={register ? 'new-password' : 'current-password'}
                    aria-describedby={register ? 'password-help' : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="auth-input"
                    placeholder={register ? (ru ? 'Не менее 12 символов' : 'At least 12 characters') : ru ? 'Ваш пароль' : 'Your password'}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? (ru ? 'Скрыть пароль' : 'Hide password') : ru ? 'Показать пароль' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {register && (
                  <p id="password-help" className="auth-password-help">
                    {password.length >= 12 && <Check size={12} />}{' '}
                    {ru ? 'От 12 символов. Можно использовать фразу.' : 'At least 12 characters. A phrase works well.'}
                  </p>
                )}
              </div>
              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}
              <Button type="submit" loading={busy} className="auth-submit" size="lg" iconRight={<ArrowRight size={16} />}>
                {invitation
                  ? ru
                    ? 'Присоединиться к команде'
                    : 'Join the team'
                  : step === 'setup'
                    ? ru
                      ? 'Создать пространство'
                      : 'Create workspace'
                    : ru
                      ? 'Войти'
                      : 'Sign in'}
              </Button>
            </form>
            {invitation && (
              <p className="auth-caption">
                {ru
                  ? 'Ваш доступ уже настроен. После регистрации вы сразу попадёте в пространство команды.'
                  : 'Your access is already set up. Registration takes you straight to your team’s workspace.'}
              </p>
            )}
          </section>
        )}
      </div>
      <footer className="auth-footer">
        Done <span>·</span> {ru ? 'Хорошие идеи начинаются вместе.' : 'Good ideas start together.'}
      </footer>
    </main>
  );
}
