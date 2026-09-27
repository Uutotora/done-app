import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Mail, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { api, bootstrapAuth, dismissSignedOut, enterAccount, enterLocal, useAuth, type AuthUser } from '@/lib/auth';
import { createEmptyData, useData } from '@/lib/store';
import { useLang } from '@/lib/i18n';
import { useIsDark } from '@/lib/hooks';
import { teamNameFromEmail } from '@/lib/team';
import type { ColorName, Person } from '@/lib/types';
import { Logo, Splash } from './Logo';
import { Button, Spinner } from './ui/Button';
import { Avatar, PageIcon } from './ui/bits';
import { StateIllustration } from './StatePanel';
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

/** 'join': a personal invitation by email; 'link': the team's shareable invite link. */
type Step = 'welcome' | 'setup' | 'join' | 'link' | 'login' | 'checking' | 'invalid' | 'forgot' | 'reset';
interface Invitation {
  /** Only personal invitations are bound to an address. */
  email?: string;
  workspace: string;
  inviter: string;
  inviterAvatar?: string;
  inviterPhoto?: string;
  inviterColor?: string;
  role: string;
  /** A project invite link: the project it opens and at which level. */
  project?: { id: string; name: string; icon: string };
  level?: 'editor' | 'commenter' | 'viewer';
}
function readDraft(): { email?: string; name?: string } {
  try {
    const value = JSON.parse(sessionStorage.getItem('done:auth-draft') || '{}');
    return {
      email: typeof value?.email === 'string' ? value.email : '',
      name: typeof value?.name === 'string' ? value.name : '',
    };
  } catch {
    return {};
  }
}

/** Light and dark, right on the sign-in screens: the choice is kept for the app too. */
function ThemeToggle({ ru }: { ru: boolean }) {
  const dark = useIsDark();
  const label = dark ? (ru ? 'Светлая тема' : 'Light theme') : ru ? 'Тёмная тема' : 'Dark theme';
  return (
    <button
      type="button"
      className="auth-theme"
      aria-label={label}
      title={label}
      onClick={() => useData.getState().setPrefs({ theme: dark ? 'light' : 'dark' })}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

const ROLE_AS: Record<string, [string, string]> = {
  owner: ['суперадмина', 'a super admin'],
  admin: ['администратора', 'an admin'],
  editor: ['редактора', 'an editor'],
  viewer: ['наблюдателя', 'a viewer'],
};

/** Who invites you and where to: the inviter's face, one title and one line. */
function InvitationHeader({ invitation, ru, heading }: { invitation: Invitation; ru: boolean; heading: React.RefObject<HTMLHeadingElement | null> }) {
  const team = invitation.workspace.trim();
  const as = ROLE_AS[invitation.role] ?? ROLE_AS.editor;
  const project = invitation.project;
  const to = ({ editor: ['редактировать', 'edit'], commenter: ['комментировать', 'comment on'], viewer: ['смотреть', 'view'] } as const)[
    invitation.level ?? 'viewer'
  ];
  const inviter: Person | undefined = invitation.inviter
    ? {
        id: 'inviter',
        name: invitation.inviter,
        color: (invitation.inviterColor || 'gray') as ColorName,
        avatar: invitation.inviterAvatar || undefined,
        photo: invitation.inviterPhoto || undefined,
      }
    : undefined;
  return (
    <header className="auth-invite-header">
      {project && (
        <span className="auth-invite-project" aria-hidden="true">
          <PageIcon icon={project.icon} size={30} />
        </span>
      )}
      <h1 ref={heading} tabIndex={-1}>
        {project
          ? ru
            ? `Присоединяйтесь к проекту «${project.name || 'Без названия'}»`
            : `Join the ${project.name || 'Untitled'} project`
          : ru
            ? team
              ? `Присоединяйтесь к «${team}»`
              : 'Присоединяйтесь к команде'
            : team
              ? `Join ${team}`
              : 'Join your team'}
      </h1>
      <p className="auth-invite-from">
        {inviter && <Avatar person={inviter} size={22} />}
        <span>
          {project
            ? ru
              ? `${inviter ? `${inviter.name} приглашает вас` : 'Вас пригласили'} ${to[0]} проект`
              : `${inviter ? `${inviter.name} invited you` : 'You’re invited'} to ${to[1]} the project`
            : inviter
              ? ru
                ? `${inviter.name} приглашает вас как ${as[0]}`
                : `${inviter.name} invited you as ${as[1]}`
              : ru
                ? `Вас пригласили как ${as[0]}`
                : `You’re invited as ${as[1]}`}
        </span>
      </p>
    </header>
  );
}

function AuthPage() {
  const lang = useLang();
  const ru = lang === 'ru';
  const { setup, error: serverError, user: currentUser, signedOutReason } = useAuth();
  const params = new URLSearchParams(location.search);
  const [inviteToken, setInviteToken] = useState(() => params.get('invite') || '');
  const [linkToken, setLinkToken] = useState(() => params.get('join') || '');
  const [resetToken, setResetToken] = useState(() => params.get('reset') || '');
  const [step, setStep] = useState<Step>(resetToken ? 'reset' : inviteToken || linkToken ? 'checking' : 'welcome');
  const [draft] = useState(readDraft);
  const [email, setEmail] = useState(draft.email || '');
  const [name, setName] = useState(draft.name || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState('');
  /** The address already has an account: offer to sign in instead. */
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeMotionPreference,
    () => window.matchMedia(motionQuery).matches,
    () => true,
  );
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const register = step === 'setup' || step === 'join' || step === 'link';
  const invited = step === 'join' || step === 'link';
  const showSignedOut = signedOutReason === 'logout' && !inviteToken && !linkToken && !resetToken;
  const changeStep = (next: Step) => {
    setError('');
    setExists(false);
    setPassword('');
    setShowPassword(false);
    setStep(next);
  };
  async function openDemo() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await enterLocal();
    } catch {
      setError(ru ? 'Не удалось открыть демо. Попробуйте ещё раз.' : 'Could not open the demo. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    try {
      sessionStorage.setItem('done:auth-draft', JSON.stringify({ name, email }));
    } catch {
      /* private browsing */
    }
  }, [name, email]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if ((!inviteToken && !linkToken) || resetToken) return;
    let live = true;
    setStep('checking');
    const request = inviteToken
      ? api<Invitation>('/api/auth/invitation', 'POST', { token: inviteToken })
      : api<Invitation>('/api/auth/join', 'POST', { token: linkToken });
    request
      .then((value) => {
        if (!live) return;
        setInvitation(value);
        if (value.email) {
          setEmail(value.email);
          setName(draft.email?.trim().toLowerCase() === value.email.toLowerCase() ? draft.name || '' : '');
        }
        setError('');
        setStep(inviteToken ? 'join' : 'link');
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
  }, [inviteToken, linkToken, resetToken, retry, draft]);
  function leaveLink(next: Step) {
    window.history.replaceState({}, '', '/');
    setInviteToken('');
    setLinkToken('');
    setResetToken('');
    setInvitation(null);
    changeStep(next);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (register && !name.trim()) {
      setError(ru ? 'Как вас зовут?' : 'What’s your name?');
      return;
    }
    setBusy(true);
    setError('');
    setExists(false);
    try {
      let data;
      if (step === 'setup') {
        // No workspace to invent: the team is named after the company domain and can be renamed in Settings.
        data = createEmptyData(lang);
        data.onboarded = true;
        data.workspace = { ...data.workspace, name: teamNameFromEmail(email) };
        data.people = {};
      }
      const result = await api<{ user: AuthUser; projectId?: string }>(`/api/auth/${register ? 'register' : 'login'}`, 'POST', {
        email: invitation?.email || email.trim(),
        password,
        name: name.trim(),
        data,
        ...(step === 'join' ? { invite: inviteToken } : step === 'link' ? { join: linkToken } : {}),
      });
      let user = result.user;
      // A project link opens its project right away, like any shared link would.
      let target = result.projectId ? `/p/${encodeURIComponent(result.projectId)}/overview` : '/';
      if (!register && linkToken) {
        // Signed in from an invite link: the link adds its project to the existing account.
        try {
          const accepted = await api<{ projectId: string | null }>('/api/auth/join/accept', 'POST', { token: linkToken });
          if (accepted.projectId) target = `/p/${encodeURIComponent(accepted.projectId)}/overview`;
          const fresh = await api<{ user: AuthUser | null }>('/api/auth/session');
          if (fresh.user) user = fresh.user;
        } catch {
          /* the account still opens; the link may have been turned off meanwhile */
        }
      }
      window.history.replaceState({}, '', target);
      await enterAccount(user);
      if (useAuth.getState().mode === 'signedIn') {
        sessionStorage.removeItem('done:auth-draft');
        setPassword('');
      } else setError(ru ? 'Не получилось войти. Попробуйте ещё раз.' : 'Could not sign you in. Please try again.');
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 401)
        setError(
          ru
            ? 'Почта или пароль не подходят. Проверьте их или восстановите пароль.'
            : 'Email or password does not match. Try again or reset your password.',
        );
      else if (status === 429) setError(ru ? 'Слишком много попыток. Попробуйте через 15 минут.' : 'Too many attempts. Try again in 15 minutes.');
      else if (status === 403 && invited) {
        setError('expired');
        setStep('invalid');
      } else if (status === 409 && step === 'link') setExists(true);
      else if (status === 403 || status === 409) {
        changeStep('login');
        setError(
          ru
            ? 'Done уже настроен. Войдите или откройте приглашение от коллеги.'
            : 'Done is already set up. Sign in, or open an invitation from a teammate.',
        );
      } else if (status === 400 && (cause as Error).message)
        setError(
          /12/.test((cause as Error).message)
            ? ru
              ? 'Пароль — не меньше 12 символов.'
              : 'Use at least 12 characters for the password.'
            : ru
              ? 'Проверьте почту и пароль.'
              : 'Check your email and password.',
        );
      else setError(ru ? 'Нет связи с сервером. Поля сохранены — попробуйте ещё раз.' : 'Could not connect. Your details are kept — try again.');
    } finally {
      setBusy(false);
    }
  }
  const illustrated = ['join', 'link', 'checking', 'invalid', 'forgot', 'reset'].includes(step);
  const title = step === 'setup' ? (ru ? 'Создайте аккаунт' : 'Create your account') : ru ? 'С возвращением' : 'Welcome back';
  return (
    <main className={`auth-shell ${illustrated ? 'auth-shell-illustrated' : ''}`}>
      <div className="auth-glow auth-glow-blue" aria-hidden="true" />
      <div className="auth-glow auth-glow-gold" aria-hidden="true" />
      <Logo size={32} className="auth-brand" />
      <nav className="auth-language" aria-label={ru ? 'Язык и тема' : 'Language and theme'}>
        <ThemeToggle ru={ru} />
        <span className="auth-language-divider" aria-hidden="true" />
        {(['ru', 'en'] as const).map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => useData.getState().setPrefs({ lang: l })}>
            {l.toUpperCase()}
          </button>
        ))}
      </nav>
      <div className={`auth-stage ${step === 'welcome' && !showSignedOut ? 'auth-stage-welcome' : ''} ${invited ? 'auth-stage-invitation' : ''}`}>
        {step === 'welcome' && !showSignedOut ? (
          <>
            <AuthWelcomeOrnaments />
            <AuthArtwork />
          </>
        ) : illustrated ? (
          <aside className={`auth-state-art ${invited ? 'auth-invitation-story' : ''}`}>
            <StateIllustration scene={invited || step === 'checking' ? 'team' : 'letter'} />
          </aside>
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
              <label htmlFor="welcome-email">{ru ? 'Рабочая почта' : 'Work email'}</label>
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
                {ru ? 'Продолжить' : 'Continue'}
              </Button>
              {serverError && (
                <p role="alert" className="auth-error">
                  {ru ? 'Сервер пока недоступен. Попробуйте чуть позже.' : 'The server is unavailable. Please try again shortly.'}
                </p>
              )}
              {!setup && (
                <p className="auth-caption">
                  {ru ? 'Нет аккаунта? Попросите у коллеги ссылку-приглашение.' : 'No account yet? Ask a teammate for an invite link.'}
                </p>
              )}
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
          <section className="auth-card auth-checking auth-state-card" aria-busy="true">
            <Spinner className="mx-auto mb-4" />
            <h1 ref={heading} tabIndex={-1}>
              {ru ? 'Открываем приглашение…' : 'Opening your invitation…'}
            </h1>
          </section>
        ) : step === 'invalid' ? (
          <section className="auth-card auth-state-card">
            <h1 ref={heading} tabIndex={-1}>
              {error === 'network'
                ? ru
                  ? 'Приглашение не открылось'
                  : 'Couldn’t open the invitation'
                : ru
                  ? 'Ссылка больше не работает'
                  : 'This link no longer works'}
            </h1>
            <p className="auth-description">
              {error === 'network'
                ? ru
                  ? 'Проверьте подключение и попробуйте ещё раз.'
                  : 'Check your connection and try again.'
                : ru
                  ? 'Попросите коллегу прислать новое приглашение.'
                  : 'Ask a teammate to send you a new invitation.'}
            </p>
            {error === 'network' && (
              <Button className="auth-submit mb-3" onClick={() => setRetry((v) => v + 1)}>
                {ru ? 'Повторить' : 'Retry'}
              </Button>
            )}
            <Button
              className={error === 'network' ? 'mt-2 w-full' : 'auth-submit'}
              onClick={() => (currentUser ? window.location.assign('/') : leaveLink('welcome'))}
            >
              {currentUser ? (ru ? 'Открыть Done' : 'Open Done') : ru ? 'Ко входу' : 'Go to sign in'}
            </Button>
          </section>
        ) : (
          <section className={`auth-card ${invited ? 'auth-join-card' : ''}`}>
            {invited && invitation ? (
              <InvitationHeader invitation={invitation} ru={ru} heading={heading} />
            ) : (
              <>
                <button type="button" className="auth-back" disabled={busy} onClick={() => changeStep(linkToken && invitation ? 'link' : 'welcome')}>
                  <ArrowLeft size={15} />
                  {ru ? 'Назад' : 'Back'}
                </button>
                <h1 ref={heading} tabIndex={-1}>
                  {title}
                </h1>
                {step === 'setup' && (
                  <p className="auth-description">
                    {ru
                      ? 'Вы здесь первый — станете администратором и пригласите команду.'
                      : 'You’re the first one here: you’ll be the admin and invite your team.'}
                  </p>
                )}
              </>
            )}
            {step !== 'link' && (
              <div className="auth-identity">
                <Mail size={15} />
                <span>{email}</span>
                {!invitation?.email && (
                  <button type="button" disabled={busy} onClick={() => changeStep('welcome')}>
                    {ru ? 'Изменить' : 'Change'}
                  </button>
                )}
              </div>
            )}
            {invitation?.email && currentUser && currentUser.email !== invitation.email && (
              <p className="auth-caption mb-4">{ru ? `Сейчас открыт аккаунт ${currentUser.email}.` : `You are signed in as ${currentUser.email}.`}</p>
            )}
            <form onSubmit={submit} className="auth-details">
              {step === 'link' && (
                <label>
                  {ru ? 'Рабочая почта' : 'Work email'}
                  <input
                    required
                    type="email"
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    maxLength={254}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setExists(false);
                    }}
                    className="auth-input"
                    placeholder="you@company.com"
                  />
                </label>
              )}
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
                    placeholder={ru ? 'Как к вам обращаться' : 'What should we call you'}
                  />
                </label>
              )}
              {step !== 'link' && (
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
              )}
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
                    placeholder={register ? (ru ? 'Не меньше 12 символов' : 'At least 12 characters') : ru ? 'Ваш пароль' : 'Your password'}
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
                  <p id="password-help" className="auth-password-help" data-ok={password.length >= 12 || undefined}>
                    {password.length >= 12 && <Check size={12} />} {ru ? 'От 12 символов — подойдёт фраза.' : '12+ characters — a phrase works well.'}
                  </p>
                )}
              </div>
              {exists && (
                <p role="alert" className="auth-error">
                  {ru ? 'У этой почты уже есть аккаунт. ' : 'This email already has an account. '}
                  <button type="button" className="auth-inline-link" onClick={() => changeStep('login')}>
                    {ru ? 'Войти' : 'Sign in'}
                  </button>
                </p>
              )}
              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}
              <Button type="submit" loading={busy} className="auth-submit" size="lg" iconRight={<ArrowRight size={16} />}>
                {invited
                  ? ru
                    ? 'Присоединиться'
                    : 'Join'
                  : step === 'setup'
                    ? ru
                      ? 'Создать аккаунт'
                      : 'Create account'
                    : ru
                      ? 'Войти'
                      : 'Sign in'}
              </Button>
            </form>
            {invited && (
              <p className="auth-caption auth-caption-center">
                {ru ? 'Уже есть аккаунт? ' : 'Already have an account? '}
                <button
                  type="button"
                  className="auth-inline-link"
                  // A team or project link stays in hand: after signing in, it opens what it leads to.
                  onClick={() => (step === 'link' ? changeStep(email.trim() ? 'login' : 'welcome') : leaveLink('welcome'))}
                >
                  {ru ? 'Войти' : 'Sign in'}
                </button>
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
