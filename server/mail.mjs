// Outgoing email: invitations, password reset links and the admin's test message.
//
// Configured from the environment:
//   DONE_SMTP_URL                 smtps://user:pass@smtp.yandex.ru:465 (or the separate variables below)
//   DONE_SMTP_HOST / DONE_SMTP_PORT / DONE_SMTP_USER / DONE_SMTP_PASS / DONE_SMTP_SECURE
//   DONE_MAIL_FROM                "Done <noreply@company.ru>" (defaults to the SMTP user)
//   DONE_PUBLIC_URL               https://done.company.ru, used for links (falls back to DONE_ORIGIN)
//
// Links are only ever built from the configured public URL, never from the request's Host
// header, so a forged Host cannot turn a reset email into a link to someone else's site.
// Without a public URL, email is off and admins share links by hand.
import nodemailer from 'nodemailer';

const SEND_TIMEOUT = 10000;
const SAFE_ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** Escapes text for HTML element content and attribute values. */
export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** One line of plain text for a header or a sentence: no line breaks, bounded length. */
const oneLine = (value, max = 120) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);

/** The app's public address without a trailing slash, or '' when it is missing or not http(s). */
export function normalizePublicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/** SMTP settings from the environment, or null when email is not set up. */
export function smtpFromEnv(env = process.env) {
  const timeouts = { connectionTimeout: SEND_TIMEOUT, greetingTimeout: SEND_TIMEOUT, socketTimeout: SEND_TIMEOUT + 5000 };
  const url = (env.DONE_SMTP_URL ?? '').trim();
  if (url) {
    if (!/^smtps?:\/\//i.test(url)) return null;
    let user = '';
    try {
      user = decodeURIComponent(new URL(url).username);
    } catch {
      return null;
    }
    return { options: { url, ...timeouts }, user };
  }
  const host = (env.DONE_SMTP_HOST ?? '').trim();
  if (!host) return null;
  const flag = (env.DONE_SMTP_SECURE ?? '').trim().toLowerCase();
  const port = Number(env.DONE_SMTP_PORT) || (flag === 'true' ? 465 : 587);
  const secure = flag ? flag === 'true' : port === 465;
  const user = (env.DONE_SMTP_USER ?? '').trim();
  return {
    options: { host, port, secure, ...(user ? { auth: { user, pass: env.DONE_SMTP_PASS ?? '' } } : {}), ...timeouts },
    user,
  };
}

/**
 * The mail service of the server. `transport` (anything with sendMail) replaces SMTP in tests;
 * `publicUrl` and `from` override the environment.
 */
export function createMail({ transport, publicUrl, from, env = process.env } = {}) {
  const base = normalizePublicUrl(publicUrl !== undefined ? publicUrl : env.DONE_PUBLIC_URL || env.DONE_ORIGIN);
  let smtpUser = '';
  let owned = false;
  if (!transport) {
    const smtp = smtpFromEnv(env);
    if (smtp) {
      try {
        transport = nodemailer.createTransport(smtp.options);
        smtpUser = smtp.user;
        owned = true;
      } catch (error) {
        console.error('Done mail: invalid SMTP settings:', error.message);
        transport = undefined;
      }
    }
  }
  // The sender: DONE_MAIL_FROM, else the SMTP login when it is an address, else noreply at the app's host.
  const sender =
    oneLine(from !== undefined ? from : env.DONE_MAIL_FROM, 200) ||
    (smtpUser.includes('@') ? `Done <${smtpUser}>` : base ? `Done <noreply@${new URL(base).hostname}>` : '');
  const configured = !!(transport && base && sender);
  if (owned && !base) console.warn('Done mail: set DONE_PUBLIC_URL (or DONE_ORIGIN) to send email with links; email is off until then.');
  /** One attempt with a time limit. Errors (they may name the SMTP server) stay in the server log. */
  async function attempt(message) {
    // One plain address per message: nothing a mail library could read as a list or a display name.
    if (!SAFE_ADDRESS.test(String(message.to ?? ''))) return { ok: false, broken: false };
    let timer;
    try {
      await Promise.race([
        transport.sendMail({ from: sender, ...message }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('No answer from the SMTP server'), { code: 'ETIMEDOUT' })), SEND_TIMEOUT);
        }),
      ]);
      return { ok: true };
    } catch (error) {
      console.error(`Done mail: could not send "${oneLine(message.subject, 80)}":`, error?.code ?? '', error?.message ?? error);
      // Timeouts, refused connections and bad credentials break every message, not just this address.
      return { ok: false, broken: ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'EAUTH'].includes(error?.code) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sends one message; resolves to true or false and never throws. */
  const send = async (message) => configured && (await attempt(message)).ok;

  /**
   * Sends several messages, a few at a time, and reports which addresses got theirs (in the given
   * order). When the SMTP server cannot be reached the rest fail right away instead of each waiting.
   */
  async function sendAll(messages) {
    const status = new Array(messages.length).fill(false);
    if (configured) {
      let next = 0;
      let unreachable = false;
      const worker = async () => {
        while (next < messages.length && !unreachable) {
          const index = next++;
          const result = await attempt(messages[index]);
          status[index] = result.ok;
          if (result.broken) unreachable = true;
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, messages.length) }, worker));
    }
    return {
      sent: messages.filter((_, i) => status[i]).map((m) => m.to),
      failed: messages.filter((_, i) => !status[i]).map((m) => m.to),
    };
  }

  return {
    configured,
    from: configured ? sender : undefined,
    publicUrl: base,
    /** A link into the app, or null when there is no public URL. */
    link: (query) => (base ? `${base}/?${query}` : null),
    send,
    sendAll,
    close: () => {
      if (owned) transport.close?.();
    },
  };
}

/* --------------------------------------------------------------------------------------------- */
/* Messages. Plain text plus a simple HTML version; every value from users is escaped.            */
/* --------------------------------------------------------------------------------------------- */

const ROLE_NAMES = {
  ru: { owner: 'Суперадмин', admin: 'Администратор', editor: 'Редактор', viewer: 'Наблюдатель' },
  en: { owner: 'Super admin', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' },
};
export const roleName = (role, lang) => ROLE_NAMES[lang]?.[role] ?? String(role);

const formatDate = (time, lang) =>
  new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' }).format(new Date(time));

/** A calm Notion-like letter: title, paragraphs, one button, the raw link and a quiet footer. */
function layout({ lang, title, paragraphs, button, link, footer }) {
  const p = (text, style = 'margin:0 0 14px') => `<p style="${style}">${escapeHtml(text)}</p>`;
  const href = escapeHtml(link);
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f7f7f5">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#ffffff;border:1px solid #e9e9e7;border-radius:12px;padding:32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#37352f">
<div style="font-size:14px;font-weight:600;color:#37352f;margin:0 0 24px">Done</div>
<h1 style="font-size:22px;line-height:1.3;font-weight:700;margin:0 0 16px">${escapeHtml(title)}</h1>
${paragraphs.map((text) => p(text)).join('\n')}
<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#2383e2;color:#ffffff;text-decoration:none;font-weight:500;padding:10px 18px;border-radius:6px">${escapeHtml(button)}</a></p>
${p(lang === 'ru' ? 'Если кнопка не открывается, скопируйте ссылку в браузер:' : 'If the button does not work, paste this link into your browser:', 'margin:0 0 6px;font-size:13px;color:#787774')}
<p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${href}" style="color:#787774">${href}</a></p>
${p(footer, 'margin:0;font-size:13px;color:#9b9a97')}
</div></div></body></html>`;
}

/** Invitation to join the workspace. */
export function inviteEmail({ lang = 'ru', workspace, inviter, role, link, expires }) {
  const ws = oneLine(workspace, 100) || 'Done';
  const who = oneLine(inviter, 100);
  const roleText = roleName(role, lang);
  const until = formatDate(expires, lang);
  if (lang === 'en') {
    const subject = `Invitation to ${ws} · Done`;
    const intro = `${who || 'A teammate'} invited you to the “${ws}” workspace on Done.`;
    const roleLine = `Your role: ${roleText}.`;
    const action = 'Open the link to create your account and join the team.';
    const footer = `The link works until ${until}. If you were not expecting this invitation, you can ignore this email.`;
    return {
      subject,
      text: `${intro}\n${roleLine}\n\n${action}\n${link}\n\n${footer}\n`,
      html: layout({ lang, title: `You’re invited to ${ws}`, paragraphs: [intro, roleLine, action], button: 'Accept invitation', link, footer }),
    };
  }
  const subject = `Приглашение в ${ws} · Done`;
  const intro = `${who || 'Коллега'} приглашает вас в пространство «${ws}» в Done.`;
  const roleLine = `Ваша роль: ${roleText.toLowerCase()}.`;
  const action = 'Откройте ссылку, чтобы создать аккаунт и присоединиться к команде.';
  const footer = `Ссылка действует до ${until}. Если вы не ждали приглашения, просто проигнорируйте письмо.`;
  return {
    subject,
    text: `${intro}\n${roleLine}\n\n${action}\n${link}\n\n${footer}\n`,
    html: layout({ lang, title: `Приглашение в «${ws}»`, paragraphs: [intro, roleLine, action], button: 'Принять приглашение', link, footer }),
  };
}

/** Link to set a new password, requested by the person or created by an administrator. */
export function resetEmail({ lang = 'ru', name, email, link, hours, admin }) {
  const person = oneLine(name, 100);
  const by = oneLine(admin, 100);
  if (lang === 'en') {
    const greeting = person ? `Hi, ${person}!` : 'Hi!';
    const intro = by
      ? `${by}, an administrator of your workspace, sent you a link to set a new password for ${email} on Done.`
      : `Someone asked to reset the password for ${email} on Done.`;
    const action = 'Open the link to choose a new password.';
    const footer = `The link works for ${hours === 1 ? '1 hour' : `${hours} hours`} and only once. If you did not ask for this, ignore this email: your password stays the same.`;
    return {
      subject: 'Password reset · Done',
      text: `${greeting}\n\n${intro}\n${action}\n${link}\n\n${footer}\n`,
      html: layout({ lang, title: 'Reset your password', paragraphs: [greeting, intro, action], button: 'Choose a new password', link, footer }),
    };
  }
  const greeting = person ? `Здравствуйте, ${person}!` : 'Здравствуйте!';
  const intro = by
    ? `${by}, администратор вашего пространства, отправил(а) ссылку, чтобы задать новый пароль для ${email} в Done.`
    : `Кто-то запросил сброс пароля для ${email} в Done.`;
  const action = 'Откройте ссылку, чтобы задать новый пароль.';
  const footer = `Ссылка действует ${hours === 1 ? '1 час' : `${hours} ч.`} и сработает один раз. Если вы не запрашивали сброс, просто проигнорируйте письмо: пароль останется прежним.`;
  return {
    subject: 'Сброс пароля · Done',
    text: `${greeting}\n\n${intro}\n${action}\n${link}\n\n${footer}\n`,
    html: layout({ lang, title: 'Сброс пароля', paragraphs: [greeting, intro, action], button: 'Задать новый пароль', link, footer }),
  };
}

/** The administrator's check that email works. */
export function testEmail({ lang = 'ru', link }) {
  if (lang === 'en') {
    const intro =
      'This is a test email from Done. If you are reading it, email is set up correctly: invitations and password reset links will arrive by email.';
    const footer = 'You received this because an administrator checked the email settings.';
    return {
      subject: 'Email check · Done',
      text: `${intro}\n\n${link}\n\n${footer}\n`,
      html: layout({ lang, title: 'Email works', paragraphs: [intro], button: 'Open Done', link, footer }),
    };
  }
  const intro = 'Это тестовое письмо из Done. Раз оно дошло, почта настроена: приглашения и ссылки для сброса пароля будут приходить письмом.';
  const footer = 'Письмо отправлено, потому что администратор проверил настройки почты.';
  return {
    subject: 'Проверка почты · Done',
    text: `${intro}\n\n${link}\n\n${footer}\n`,
    html: layout({ lang, title: 'Почта работает', paragraphs: [intro], button: 'Открыть Done', link, footer }),
  };
}
