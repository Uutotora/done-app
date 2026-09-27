import { ArrowUpRight, Check, CircleAlert, Eye, EyeOff, MailCheck, Server } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLang } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/ui';
import { removeMailSettings, saveMailSettings, sendTestMail, useMembers, type MailProblem, type MailSettings } from '@/lib/members';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Field, Switch, TextInput } from '@/components/ui/bits';
import { StateIllustration } from '@/components/StatePanel';
import { H, Note } from './common';

interface Provider {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  /** Where the mailbox owner creates a password for apps. */
  help?: string;
  domains: string[];
}
const PROVIDERS: Provider[] = [
  {
    id: 'yandex',
    label: 'Яндекс',
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    help: 'https://id.yandex.ru/security/app-passwords',
    domains: ['yandex.ru', 'ya.ru', 'yandex.com'],
  },
  {
    id: 'mailru',
    label: 'Mail.ru',
    host: 'smtp.mail.ru',
    port: 465,
    secure: true,
    help: 'https://account.mail.ru/user/2-step-auth/passwords/',
    domains: ['mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'internet.ru'],
  },
  {
    id: 'gmail',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    help: 'https://myaccount.google.com/apppasswords',
    domains: ['gmail.com', 'googlemail.com'],
  },
  { id: 'outlook', label: 'Outlook', host: 'smtp.office365.com', port: 587, secure: false, domains: ['outlook.com', 'hotmail.com', 'live.com'] },
];
const GOOGLE_2SV = 'https://myaccount.google.com/signinoptions/twosv';
const providerFor = (email: string) => PROVIDERS.find((p) => p.domains.includes(email.split('@')[1]?.toLowerCase() ?? ''));
const isLocal = (url: string) => /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(url);

/** Settings > Email: connect the team's mailbox so invitations and reset links arrive by themselves. */
export function MailPage() {
  const ru = useLang() === 'ru';
  const { mail, loaded } = useMembers();
  const [editing, setEditing] = useState(false);
  const connected = mail.configured || mail.source === 'app';
  return (
    <>
      <H
        sub={
          ru
            ? 'Приглашения и ссылки для смены пароля уходят письмом с ящика вашей команды.'
            : 'Invitations and password links go out from your team’s mailbox.'
        }
      >
        {ru ? 'Почта' : 'Email'}
      </H>
      {!loaded ? null : connected && !editing ? (
        <Connected mail={mail} onEdit={() => setEditing(true)} />
      ) : mail.editable ? (
        <ConnectForm mail={mail} onDone={() => setEditing(false)} onCancel={connected ? () => setEditing(false) : undefined} />
      ) : (
        <NotConnected />
      )}
    </>
  );
}

function Connected({ mail, onEdit }: { mail: MailSettings; onEdit: () => void }) {
  const ru = useLang() === 'ru';
  const [busy, setBusy] = useState<'test' | 'off' | null>(null);
  const test = async () => {
    setBusy('test');
    try {
      const to = await sendTestMail();
      toast({ message: ru ? `Тестовое письмо отправлено на ${to}` : `Test email sent to ${to}`, tone: 'success' });
    } catch (e) {
      const status = (e as { status?: number }).status;
      toast({
        message:
          status === 429
            ? ru
              ? 'Слишком много попыток. Попробуйте через 15 минут.'
              : 'Too many attempts. Try again in 15 minutes.'
            : ru
              ? 'Письмо не ушло. Проверьте настройки почты.'
              : 'The email was not sent. Check the email settings.',
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  };
  const off = async () => {
    if (!window.confirm(ru ? 'Отключить почту? Письма перестанут уходить.' : 'Disconnect email? Letters will stop going out.')) return;
    setBusy('off');
    try {
      await removeMailSettings();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-xl border border-line p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--c-green-bg)] text-[var(--c-green-text)]">
          <MailCheck size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{ru ? 'Почта подключена' : 'Email is connected'}</div>
          <div className="mt-0.5 truncate text-[13px] text-fg-3">{mail.from}</div>
          {mail.settings && (
            <div className="mt-0.5 truncate text-[12.5px] text-fg-4">
              {mail.settings.host}:{mail.settings.port} · {ru ? 'ссылки ведут на' : 'links open'} {mail.settings.publicUrl}
            </div>
          )}
          {mail.source === 'env' && (
            <div className="mt-1 text-[12.5px] text-fg-3">
              {ru ? 'Настроено на сервере, в переменных окружения.' : 'Set up on the server, in environment variables.'}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 pl-12">
        <Button size="sm" loading={busy === 'test'} onClick={() => void test()}>
          {ru ? 'Отправить тестовое письмо' : 'Send a test email'}
        </Button>
        {mail.editable && (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              {ru ? 'Изменить' : 'Change'}
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'off'} onClick={() => void off()}>
              {ru ? 'Отключить' : 'Disconnect'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function NotConnected() {
  const ru = useLang() === 'ru';
  return (
    <div className="text-center">
      <StateIllustration scene="letter" className="mx-auto mb-4 !w-[200px]" />
      <div className="text-[15px] font-semibold">{ru ? 'Почта ещё не подключена' : 'Email isn’t connected yet'}</div>
      <p className="mx-auto mt-1.5 max-w-[380px] text-[13.5px] leading-relaxed text-fg-3">
        {ru
          ? 'Подключить ящик может суперадмин. Пока приглашения можно отправлять ссылкой.'
          : 'The super admin can connect a mailbox. Until then, share invitations as links.'}
      </p>
    </div>
  );
}

function ConnectForm({ mail, onDone, onCancel }: { mail: MailSettings; onDone: () => void; onCancel?: () => void }) {
  const ru = useLang() === 'ru';
  const me = useAuth((s) => s.user?.email ?? '');
  const saved = mail.settings;
  const [user, setUser] = useState(saved?.user ?? me);
  const [provider, setProvider] = useState<string>(() => {
    if (saved) return PROVIDERS.find((p) => p.host === saved.host)?.id ?? 'custom';
    return providerFor(me)?.id ?? 'yandex';
  });
  const [host, setHost] = useState(saved?.host ?? '');
  const [port, setPort] = useState(String(saved?.port ?? 465));
  const [secure, setSecure] = useState(saved?.secure ?? true);
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [name, setName] = useState(saved?.name ?? 'Done');
  const [publicUrl, setPublicUrl] = useState(saved?.publicUrl ?? window.location.origin);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code?: MailProblem | 'field'; field?: string } | null>(null);
  const preset = PROVIDERS.find((p) => p.id === provider);
  // Typing a known address picks its provider, as long as the choice was not made by hand.
  const [picked, setPicked] = useState(!!saved);
  useEffect(() => {
    if (picked) return;
    const match = providerFor(user);
    if (match) setProvider(match.id);
  }, [user, picked]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const server = preset ?? { host: host.trim(), port: Number(port), secure };
    try {
      const { to } = await saveMailSettings({
        host: server.host,
        port: server.port,
        secure: server.secure,
        user: user.trim(),
        // Google shows app passwords in groups of four; the spaces are not part of it.
        pass: preset?.id === 'gmail' ? pass.replace(/\s+/g, '') : pass,
        name: name.trim() || 'Done',
        publicUrl: publicUrl.trim(),
      });
      toast({ message: ru ? `Почта подключена. Тестовое письмо отправлено на ${to}` : `Email connected. Test email sent to ${to}`, tone: 'success' });
      setPass('');
      onDone();
    } catch (err) {
      const body = (err as { body?: { code?: MailProblem; field?: string } }).body;
      const status = (err as { status?: number }).status;
      if (status === 429)
        toast({ message: ru ? 'Слишком много попыток. Попробуйте через 15 минут.' : 'Too many attempts. Try again in 15 minutes.', tone: 'error' });
      else setProblem(body?.field ? { code: 'field', field: body.field } : { code: body?.code ?? 'unknown' });
    } finally {
      setBusy(false);
    }
  };

  const server = preset ? `${preset.host}:${preset.port}` : `${host}:${port}`;
  const message =
    problem &&
    {
      auth: ru
        ? 'Почта не приняла логин или пароль. Для Яндекса, Mail.ru и Gmail нужен пароль приложения, а не обычный пароль от ящика.'
        : 'The mailbox rejected the login or password. Yandex, Mail.ru and Gmail need an app password, not your usual one.',
      host: ru ? `Сервер ${preset?.host ?? host} не найден.` : `Server ${preset?.host ?? host} was not found.`,
      connect: ru
        ? `Не удалось подключиться к ${server}. Проверьте сервер, порт и SSL.`
        : `Could not connect to ${server}. Check the server, port and SSL.`,
      sender: ru
        ? 'Сервер не принял адрес отправителя. Логин должен быть адресом этого ящика.'
        : 'The server rejected the sender. The login should be this mailbox’s address.',
      unknown: ru ? 'Письмо не ушло. Проверьте настройки и попробуйте ещё раз.' : 'The email was not sent. Check the settings and try again.',
      field:
        problem.field === 'publicUrl'
          ? ru
            ? 'Укажите адрес Done, начиная с https://'
            : 'Enter Done’s address starting with https://'
          : problem.field === 'pass'
            ? ru
              ? 'Введите пароль приложения.'
              : 'Enter the app password.'
            : problem.field === 'user'
              ? ru
                ? 'Введите адрес ящика.'
                : 'Enter the mailbox address.'
              : ru
                ? 'Проверьте сервер и порт.'
                : 'Check the server and port.',
    }[problem.code ?? 'unknown'];

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-5">
      <div>
        <div className="mb-2 text-[13px] font-medium text-fg-2">{ru ? 'Почтовый сервис' : 'Mail service'}</div>
        <div role="radiogroup" aria-label={ru ? 'Почтовый сервис' : 'Mail service'} className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {[...PROVIDERS, { id: 'custom', label: ru ? 'Другой' : 'Other' }].map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={provider === p.id}
              onClick={() => {
                setProvider(p.id);
                setPicked(true);
                setProblem(null);
              }}
              className={cn(
                'flex h-10 items-center justify-center gap-1.5 rounded-lg border text-[13.5px] transition-colors',
                provider === p.id ? 'border-accent bg-accent-soft font-medium' : 'border-line text-fg-2 hover:bg-hover',
              )}
            >
              {p.id === 'custom' && <Server size={14} />}
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <Field label={ru ? 'Адрес ящика' : 'Mailbox address'} hint={ru ? 'С него будут уходить письма.' : 'Letters are sent from it.'}>
        <TextInput
          required
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="team@company.ru"
        />
      </Field>

      <div>
        <Field
          label={ru ? 'Пароль приложения' : 'App password'}
          hint={
            saved && saved.user === user.trim() ? (
              ru ? (
                'Оставьте пустым, чтобы не менять сохранённый.'
              ) : (
                'Leave empty to keep the saved one.'
              )
            ) : preset?.id === 'gmail' ? (
              <span className="flex flex-col gap-0.5">
                <a
                  href={GOOGLE_2SV}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-fg-2"
                >
                  {ru ? '1. Включите двухэтапную аутентификацию Google' : '1. Turn on Google 2-Step Verification'}
                  <ArrowUpRight size={12} />
                </a>
                <a
                  href={preset.help}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-fg-2"
                >
                  {ru ? '2. Создайте пароль приложения (16 букв) и вставьте сюда' : '2. Create an app password (16 letters) and paste it here'}
                  <ArrowUpRight size={12} />
                </a>
              </span>
            ) : (
              preset?.help && (
                <a
                  href={preset.help}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-fg-2"
                >
                  {ru ? `Где взять пароль для ${preset.label}` : `Get an app password for ${preset.label}`}
                  <ArrowUpRight size={12} />
                </a>
              )
            )
          }
        >
          <div className="relative">
            <TextInput
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              value={pass}
              required={!(saved && saved.user === user.trim())}
              onChange={(e) => setPass(e.target.value)}
              placeholder={ru ? 'Не обычный пароль от почты' : 'Not your usual mail password'}
              className="pr-10"
            />
            <button
              type="button"
              aria-label={showPass ? (ru ? 'Скрыть пароль' : 'Hide password') : ru ? 'Показать пароль' : 'Show password'}
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-3 hover:bg-hover"
            >
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>
      </div>

      {provider === 'custom' && (
        <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto] sm:items-end">
          <Field label={ru ? 'SMTP-сервер' : 'SMTP server'}>
            <TextInput required value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.company.ru" spellCheck={false} />
          </Field>
          <Field label={ru ? 'Порт' : 'Port'}>
            <TextInput
              required
              inputMode="numeric"
              value={port}
              onChange={(e) => {
                setPort(e.target.value);
                setSecure(e.target.value.trim() === '465');
              }}
            />
          </Field>
          <label className="flex h-9 items-center gap-2 text-[13.5px] text-fg-2">
            <Switch checked={secure} onChange={setSecure} label="SSL" />
            SSL
          </label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={ru ? 'Имя отправителя' : 'Sender name'}>
          <TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Done" />
        </Field>
        <Field
          label={ru ? 'Адрес Done для ссылок' : 'Done address for links'}
          hint={
            isLocal(publicUrl)
              ? ru
                ? 'С localhost ссылки откроются только на этом компьютере.'
                : 'localhost links only open on this computer.'
              : undefined
          }
        >
          <TextInput
            required
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
            placeholder="https://done.company.ru"
            spellCheck={false}
          />
        </Field>
      </div>

      {message && (
        <p role="alert" className="flex gap-2 rounded-lg bg-[var(--c-red-bg)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--c-red-text)]">
          <CircleAlert size={15} className="mt-0.5 shrink-0" />
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button type="submit" variant="primary" loading={busy} icon={<Check size={15} />}>
          {ru ? 'Подключить' : 'Connect'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {ru ? 'Отмена' : 'Cancel'}
          </Button>
        )}
        <span className="text-[12.5px] text-fg-3">
          {ru
            ? `Сначала отправим тестовое письмо на ${useAuth.getState().user?.email ?? ''}.`
            : `We’ll send a test email to ${useAuth.getState().user?.email ?? ''} first.`}
        </span>
      </div>
      <Note>
        {ru
          ? 'Пароль хранится на сервере Done и никогда не показывается в приложении.'
          : 'The password is kept on the Done server and never shown in the app.'}
      </Note>
    </form>
  );
}
