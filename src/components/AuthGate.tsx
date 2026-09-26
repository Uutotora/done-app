import { ArrowLeft, ArrowRight, Mail, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, bootstrapAuth, enterAccount, enterLocal, useAuth, type AuthUser } from '@/lib/auth';
import { createBlankData } from '@/lib/seed';
import { motion } from 'motion/react';
import { useLang } from '@/lib/i18n';
import { useData } from '@/lib/store';
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
  const [screen, setScreen] = useState<'welcome' | 'form'>(invite ? 'form' : 'welcome');
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
            <label className="block text-[13px] font-medium">
              {ru ? 'Пароль' : 'Password'}
              <input
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
            </label>
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
