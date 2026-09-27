// Renders the letters with sample data: node docs/previews/email/render.mjs
// Letters carry their images inside (cid:); the previews point them at server/email-assets instead.
import { writeFileSync } from 'node:fs';
import { inviteEmail, resetEmail, testEmail } from '../../../server/mail.mjs';

const link = 'https://done.company.ru/?invite=Xy7abc&email=anna%40company.ru';
const expires = Date.UTC(2026, 9, 4);
const projects = [
  { name: 'Мобильное приложение 2.0', icon: '📱' },
  { name: 'Запуск веб-кабинета', icon: '🌐' },
];
const letters = {
  'invite-ru': inviteEmail({ lang: 'ru', workspace: 'Acme', inviter: 'Михаил', role: 'editor', link, expires, email: 'anna@company.ru', projects }),
  'invite-en': inviteEmail({
    lang: 'en',
    workspace: 'Acme',
    inviter: 'Mike',
    role: 'viewer',
    link,
    expires,
    email: 'anna@company.com',
    projects: null,
  }),
  'reset-ru': resetEmail({ lang: 'ru', name: 'Анна', email: 'anna@company.ru', link: 'https://done.company.ru/?reset=abc', hours: 1 }),
  'test-ru': testEmail({ lang: 'ru', link: 'https://done.company.ru/' }),
};
for (const [name, letter] of Object.entries(letters)) {
  const html = letter.html.replace(/cid:([\w-]+)@done/g, '../../../server/email-assets/$1.png');
  writeFileSync(new URL(`./${name}.html`, import.meta.url), html);
  writeFileSync(new URL(`./${name}.txt`, import.meta.url), `Subject: ${letter.subject}\n\n${letter.text}`);
}
console.log(Object.keys(letters).join(', '));
