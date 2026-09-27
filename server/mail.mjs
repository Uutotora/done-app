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
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** Mail settings an administrator saved in the app, checked before they are stored. */
export function normalizeMailSettings(input, previous) {
  const fail = (field) => {
    throw Object.assign(new Error(`Invalid ${field}`), { status: 400, field });
  };
  const host = String(input?.host ?? '')
    .trim()
    .toLowerCase();
  if ((host !== 'localhost' && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) || host.length > 253) fail('host');
  const port = Number(input?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('port');
  const user = String(input?.user ?? '').trim();
  if (!user || user.length > 254 || /[\s<>]/.test(user)) fail('user');
  // An empty password keeps the saved one for the same login, so the form never has to show it.
  let pass = typeof input?.pass === 'string' ? input.pass : '';
  if (!pass && previous?.pass && previous.user === user && previous.host === host) pass = previous.pass;
  if (!pass || pass.length > 512) fail('pass');
  const name = oneLine(input?.name, 80).replace(/["<>]/g, '') || 'Done';
  const publicUrl = normalizePublicUrl(input?.publicUrl);
  if (!publicUrl) fail('publicUrl');
  const secure = input?.secure === undefined ? port === 465 : !!input.secure;
  return { host, port, secure, user, pass, name, publicUrl };
}

/** The error of an SMTP check as a short code the app can explain. */
export const mailErrorCode = (error) =>
  error?.code === 'EAUTH' || /auth/i.test(String(error?.message ?? ''))
    ? 'auth'
    : ['EDNS', 'ENOTFOUND'].includes(error?.code)
      ? 'host'
      : ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET'].includes(error?.code)
        ? 'connect'
        : error?.code === 'EENVELOPE'
          ? 'sender'
          : 'unknown';

/**
 * The mail service of the server. SMTP comes from the environment (DONE_SMTP_URL and friends) or,
 * when that is not set, from settings saved in the app (`saved`, changed later with `configure`).
 * `transport` (anything with sendMail) replaces SMTP in tests; `createTransport` builds transports
 * for saved settings; `publicUrl` and `from` override the environment.
 */
export function createMail({ transport: fixed, publicUrl, from, env = process.env, saved, createTransport = nodemailer.createTransport } = {}) {
  const timeouts = { connectionTimeout: SEND_TIMEOUT, greetingTimeout: SEND_TIMEOUT, socketTimeout: SEND_TIMEOUT + 5000 };
  const envBase = normalizePublicUrl(publicUrl !== undefined ? publicUrl : env.DONE_PUBLIC_URL || env.DONE_ORIGIN);
  const envFrom = oneLine(from !== undefined ? from : env.DONE_MAIL_FROM, 200);
  const envSmtp = fixed ? null : smtpFromEnv(env);
  /** The environment (or a test transport) owns the settings; the app can only show them. */
  const fromEnv = !!(fixed || envSmtp);
  let state = { transport: undefined, owned: false, base: envBase, sender: '', source: null, details: null };

  function build(settings) {
    if (state.owned) state.transport.close?.();
    let transport;
    let owned = false;
    let smtpUser = '';
    let base = envBase;
    let sender = envFrom;
    let source = null;
    let details = null;
    if (fixed) {
      transport = fixed;
      source = 'env';
    } else if (envSmtp) {
      try {
        transport = nodemailer.createTransport(envSmtp.options);
        smtpUser = envSmtp.user;
        owned = true;
        source = 'env';
      } catch (error) {
        console.error('Done mail: invalid SMTP settings:', error.message);
      }
    } else if (settings?.host) {
      try {
        transport = createTransport({
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          auth: { user: settings.user, pass: settings.pass },
          ...timeouts,
        });
        owned = true;
        source = 'app';
        base = settings.publicUrl || envBase;
        // Most providers only accept letters from the login's own address.
        sender = settings.user.includes('@') ? `${settings.name || 'Done'} <${settings.user}>` : envFrom;
        details = {
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          user: settings.user,
          name: settings.name,
          publicUrl: settings.publicUrl,
        };
      } catch (error) {
        console.error('Done mail: invalid saved SMTP settings:', error.message);
      }
    }
    // The sender: DONE_MAIL_FROM, else the SMTP login when it is an address, else noreply at the app's host.
    if (!sender) sender = smtpUser.includes('@') ? `Done <${smtpUser}>` : base ? `Done <noreply@${new URL(base).hostname}>` : '';
    if (owned && source === 'env' && !base)
      console.warn('Done mail: set DONE_PUBLIC_URL (or DONE_ORIGIN) to send email with links; email is off until then.');
    state = { transport, owned, base, sender, source, details };
  }
  build(saved);

  const isConfigured = () => !!(state.transport && state.base && state.sender);

  /** One attempt with a time limit. Errors (they may name the SMTP server) stay in the server log. */
  async function attempt(message, transport = state.transport, sender = state.sender) {
    // One plain address per message: nothing a mail library could read as a list or a display name.
    if (!SAFE_ADDRESS.test(String(message.to ?? ''))) return { ok: false, broken: false, code: 'recipient' };
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
      return { ok: false, broken: ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'EAUTH'].includes(error?.code), code: mailErrorCode(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sends one message; resolves to true or false and never throws. */
  const send = async (message) => isConfigured() && (await attempt(message)).ok;

  /**
   * Sends several messages, a few at a time, and reports which addresses got theirs (in the given
   * order). When the SMTP server cannot be reached the rest fail right away instead of each waiting.
   */
  async function sendAll(messages) {
    const status = new Array(messages.length).fill(false);
    if (isConfigured()) {
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

  /**
   * Checks settings before they are saved: signs in to the SMTP server and sends the letter `message`
   * with them. Resolves to { ok } or { ok: false, code } and never throws.
   */
  async function check(settings, message) {
    let transport;
    try {
      transport = createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: { user: settings.user, pass: settings.pass },
        ...timeouts,
      });
      if (typeof transport.verify === 'function') {
        let timer;
        await Promise.race([
          transport.verify(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('No answer from the SMTP server'), { code: 'ETIMEDOUT' })), SEND_TIMEOUT);
          }),
        ]).finally(() => clearTimeout(timer));
      }
      const sender = settings.user.includes('@')
        ? `${settings.name || 'Done'} <${settings.user}>`
        : `Done <noreply@${new URL(settings.publicUrl).hostname}>`;
      const result = await attempt(message, transport, sender);
      return result.ok ? { ok: true } : { ok: false, code: result.code };
    } catch (error) {
      console.error('Done mail: SMTP check failed:', error?.code ?? '', error?.message ?? error);
      return { ok: false, code: mailErrorCode(error) };
    } finally {
      transport?.close?.();
    }
  }

  return {
    get configured() {
      return isConfigured();
    },
    get from() {
      return isConfigured() ? state.sender : undefined;
    },
    get publicUrl() {
      return state.base;
    },
    /** 'env' when the environment sets SMTP, 'app' when an administrator saved it, null when email is off. */
    get source() {
      return state.source;
    },
    /** Saved settings without the password, for the settings page. */
    get details() {
      return state.details;
    },
    fromEnv,
    /** Uses new saved settings (or none) from now on; the environment still wins when it sets SMTP. */
    configure: (settings) => build(settings),
    check,
    /** A link into the app, or null when there is no public URL. */
    link: (query) => (state.base ? `${state.base}/?${query}` : null),
    send,
    sendAll,
    close: () => {
      if (state.owned) state.transport.close?.();
    },
  };
}

/* --------------------------------------------------------------------------------------------- */
/* Messages. Plain text plus an HTML letter in the app's quiet style; every user value is escaped. */
/* --------------------------------------------------------------------------------------------- */

const ROLE_NAMES = {
  ru: { owner: 'Суперадмин', admin: 'Администратор', editor: 'Редактор', viewer: 'Наблюдатель' },
  en: { owner: 'Super admin', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' },
};
export const roleName = (role, lang) => ROLE_NAMES[lang]?.[role] ?? String(role);

const formatDate = (time, lang) =>
  new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' }).format(new Date(time));

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";

/** A project's emoji for the letter; icon-set ids such as "lucide:rocket" are left out. */
const emojiIcon = (icon) => (typeof icon === 'string' && icon && icon.length <= 16 && !/^[a-z-]+:/i.test(icon) ? icon : '');

/** Small copies of the logo and the ink illustrations, made for letters (server/email-assets). */
// Next to this file, or under the working directory when a bundler moved the code (vite.config).
const EMAIL_ASSETS = [fileURLToPath(new URL('./email-assets/', import.meta.url)), resolve(process.cwd(), 'server/email-assets')];
const IMAGE_CID = (name) => `${name}@done`;
/** The images a letter shows, attached inline so mail clients do not have to load them from Done. */
export function letterImages(art) {
  return ['done-mark', ...(art ? [art] : [])].flatMap((name) => {
    const path = EMAIL_ASSETS.map((dir) => join(dir, `${name}.png`)).find((file) => existsSync(file));
    return path ? [{ filename: `${name}.png`, path, cid: IMAGE_CID(name), contentType: 'image/png' }] : [];
  });
}

/**
 * The letter, as a Notion email would look: a small mark, an ink illustration, one clear title,
 * a short line, the details as a quiet table, one button and the raw link. Tables and inline styles
 * keep it intact in Outlook and Gmail; clients that know dark mode get a dark version.
 */
function layout({ lang, preheader, art, title, paragraphs = [], details = [], button, link, footer }) {
  const href = escapeHtml(link);
  const text = 'font-family:' + FONT + ';color:#37352f';
  // Images travel inside the letter (cid:), so they show even when Done runs on a local address.
  const logo = `<img src="cid:${IMAGE_CID('done-mark')}" width="26" height="26" alt="Done" style="display:block;width:26px;height:26px;border:0">`;
  const artwork = art
    ? `<tr><td class="done-art" align="center" style="background:#f7f6f3;border-radius:12px;padding:22px 16px 14px">
<img src="cid:${IMAGE_CID(art)}" width="236" alt="" style="display:block;width:236px;max-width:100%;height:auto;border:0">
</td></tr>
<tr><td style="height:30px;line-height:30px;font-size:0">&nbsp;</td></tr>`
    : '';
  const rows = details
    .filter(([, value]) => (Array.isArray(value) ? value.length : value))
    .map(
      ([label, value]) => `<tr>
<td class="done-muted" valign="top" style="padding:6px 16px 6px 0;width:92px;font-family:${FONT};font-size:13px;line-height:20px;color:#787774">${escapeHtml(label)}</td>
<td class="done-text" valign="top" style="padding:6px 0;font-family:${FONT};font-size:14px;line-height:22px;color:#37352f">${[value].flat().map(escapeHtml).join('<br>')}</td>
</tr>`,
    )
    .join('\n');
  const table = rows
    ? `<tr><td class="done-panel" style="background:#f7f7f5;border-radius:10px;padding:10px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr>
<tr><td style="height:28px;line-height:28px;font-size:0">&nbsp;</td></tr>`
    : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
@media (max-width:540px){.done-card{padding:28px 22px 26px!important}.done-h1{font-size:23px!important;line-height:30px!important}}
@media (prefers-color-scheme:dark){
.done-body{background:#191919!important}
.done-card{background:#202020!important;border-color:#2f2f2f!important}
.done-text,.done-h1{color:#ebebea!important}
.done-muted{color:#9b9b9b!important}
.done-panel{background:#2a2a2a!important}
.done-art{background:#252525!important}
.done-art img{filter:invert(1)}
.done-btn{background:#ebebea!important;color:#191919!important}
.done-link{color:#9b9b9b!important}
.done-mark{filter:invert(1)}
}
</style>
</head>
<body class="done-body" style="margin:0;padding:0;background:#f7f7f5">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader ?? title)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="done-body" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f7f5">
<tr><td align="center" style="padding:36px 14px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding:0 6px 18px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="done-mark" valign="middle" style="padding-right:9px">${logo}</td>
<td class="done-text" valign="middle" style="${text};font-size:15px;font-weight:700;letter-spacing:-0.2px">Done</td>
</tr></table>
</td></tr>
<tr><td class="done-card" style="background:#ffffff;border:1px solid #ebebea;border-radius:14px;padding:36px 36px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${artwork}
<tr><td class="done-h1" style="${text};font-size:26px;line-height:33px;font-weight:700;letter-spacing:-0.4px;padding:0 0 12px">${escapeHtml(title)}</td></tr>
${paragraphs.map((p) => `<tr><td class="done-text" style="${text};font-size:15px;line-height:24px;padding:0 0 12px">${escapeHtml(p)}</td></tr>`).join('\n')}
<tr><td style="height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>
${table}
<tr><td>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-radius:8px;background:#191919"><a class="done-btn" href="${href}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#191919;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(button)}</a></td>
</tr></table>
</td></tr>
<tr><td class="done-muted" style="font-family:${FONT};font-size:12px;line-height:18px;color:#9b9a97;padding:22px 0 0">${escapeHtml(lang === 'ru' ? 'Кнопка не открывается? Скопируйте ссылку:' : 'Button not working? Copy this link:')}<br>
<a class="done-link" href="${href}" style="color:#787774;word-break:break-all">${href}</a></td></tr>
</table>
</td></tr>
<tr><td class="done-muted" style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#9b9a97">${escapeHtml(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Plain-text twin of a letter: the same words in the same order, then the link. */
const plain = (lines) => `${lines.filter((line) => line !== null && line !== undefined).join('\n')}\n`;

/**
 * Invitation to join the team. `projects` lists what the invitation opens (null: every project);
 */
export function inviteEmail({ lang = 'ru', workspace, inviter, role, link, expires, email, projects = null }) {
  const ws = oneLine(workspace, 100);
  const who = oneLine(inviter, 100);
  const to = oneLine(email, 254);
  const roleText = roleName(role, lang);
  const until = formatDate(expires, lang);
  const admin = role === 'owner' || role === 'admin';
  const list = Array.isArray(projects)
    ? projects
        .slice(0, 6)
        .map((p) => [emojiIcon(p?.icon), oneLine(p?.name, 60)].filter(Boolean).join('\u00a0'))
        .filter(Boolean)
    : null;
  if (lang === 'en') {
    const place = ws || 'Done';
    const subject = who ? `${who} invited you to ${place}` : `Join ${place} on Done`;
    const intro = 'Your access is ready. All that’s left is to accept the invitation.';
    const scope = admin || list === null ? ['All projects'] : list.length ? list : ['Projects you are added to'];
    const footer = `${to ? `This invitation for ${to}` : 'This invitation'} works until ${until}. Not expecting it? You can safely ignore this email.`;
    return {
      subject,
      text: plain([
        subject,
        '',
        intro,
        `Your role: ${roleText}.`,
        `Projects: ${scope.join(', ')}.`,
        '',
        `Accept the invitation: ${link}`,
        '',
        footer,
      ]),
      html: layout({
        lang,
        preheader: `${intro} The link works until ${until}.`,
        art: 'team',
        title: subject,
        paragraphs: [intro],
        details: [
          ['Role', roleText],
          ['Projects', scope],
          ['Email', to],
        ],
        button: 'Accept invitation',
        link,
        footer,
      }),
      attachments: letterImages('team'),
    };
  }
  const place = ws ? `«${ws}»` : 'Done';
  const subject = who ? `${who} приглашает вас в ${place}` : `Приглашение в ${place}`;
  const intro = 'Ваш доступ уже настроен — осталось принять приглашение.';
  const scope = admin || list === null ? ['Все проекты'] : list.length ? list : ['Проекты, в которые вас добавят'];
  const footer = `${to ? `Приглашение для ${to}` : 'Приглашение'} действует до ${until}. Если вы его не ждали, просто удалите письмо.`;
  return {
    subject,
    text: plain([
      subject,
      '',
      intro,
      `Ваша роль: ${roleText.toLowerCase()}.`,
      `Проекты: ${scope.join(', ')}.`,
      '',
      `Принять приглашение: ${link}`,
      '',
      footer,
    ]),
    html: layout({
      lang,
      preheader: `${intro} Ссылка действует до ${until}.`,
      art: 'team',
      title: subject,
      paragraphs: [intro],
      details: [
        ['Роль', roleText],
        ['Проекты', scope],
        ['Почта', to],
      ],
      button: 'Принять приглашение',
      link,
      footer,
    }),
    attachments: letterImages('team'),
  };
}

/** Link to set a new password, requested by the person or created by an administrator. */
export function resetEmail({ lang = 'ru', name, email, link, hours, admin }) {
  const person = oneLine(name, 100);
  const by = oneLine(admin, 100);
  if (lang === 'en') {
    const greeting = person ? `Hi, ${person}!` : 'Hi!';
    const intro = by
      ? `${by}, an administrator of your team, sent you a link to set a new password for ${email}.`
      : `Someone asked to reset the password for ${email}.`;
    const footer = `The link works for ${hours === 1 ? '1 hour' : `${hours} hours`} and only once. If you did not ask for this, ignore this email: your password stays the same.`;
    return {
      subject: 'Password reset · Done',
      text: plain([greeting, '', intro, 'Open the link to choose a new password.', link, '', footer]),
      html: layout({
        lang,
        preheader: intro,
        art: 'letter',
        title: 'Choose a new password',
        paragraphs: [greeting, intro],
        button: 'Choose a new password',
        link,
        footer,
      }),
      attachments: letterImages('letter'),
    };
  }
  const greeting = person ? `Здравствуйте, ${person}!` : 'Здравствуйте!';
  const intro = by
    ? `${by}, администратор вашей команды, отправил(а) ссылку, чтобы задать новый пароль для ${email}.`
    : `Кто-то запросил сброс пароля для ${email}.`;
  const footer = `Ссылка действует ${hours === 1 ? '1 час' : `${hours} ч.`} и сработает один раз. Если вы не запрашивали сброс, просто проигнорируйте письмо: пароль останется прежним.`;
  return {
    subject: 'Сброс пароля · Done',
    text: plain([greeting, '', intro, 'Откройте ссылку, чтобы задать новый пароль.', link, '', footer]),
    html: layout({
      lang,
      preheader: intro,
      art: 'letter',
      title: 'Новый пароль',
      paragraphs: [greeting, intro],
      button: 'Задать новый пароль',
      link,
      footer,
    }),
    attachments: letterImages('letter'),
  };
}

/** The administrator's check that email works. */
export function testEmail({ lang = 'ru', link }) {
  if (lang === 'en') {
    const intro = 'If you are reading this, email is set up: invitations and password links will arrive on their own.';
    const footer = 'You received this because an administrator checked the email settings.';
    return {
      subject: 'Email check · Done',
      text: plain(['Email works', '', intro, '', link, '', footer]),
      html: layout({ lang, preheader: intro, art: 'letter', title: 'Email works', paragraphs: [intro], button: 'Open Done', link, footer }),
      attachments: letterImages('letter'),
    };
  }
  const intro = 'Раз письмо дошло, почта настроена: приглашения и ссылки для смены пароля будут приходить сами.';
  const footer = 'Письмо отправлено, потому что администратор проверил настройки почты.';
  return {
    subject: 'Проверка почты · Done',
    text: plain(['Почта работает', '', intro, '', link, '', footer]),
    html: layout({
      lang,
      preheader: intro,
      art: 'letter',
      title: 'Почта работает',
      paragraphs: [intro],
      button: 'Открыть Done',
      link,
      footer,
    }),
    attachments: letterImages('letter'),
  };
}
