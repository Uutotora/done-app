// Renders the letters with sample data: node docs/previews/email/render.mjs
// The HTML files open straight from disk; images come from public/ next to them.
import { writeFileSync } from 'node:fs';
import { inviteEmail, resetEmail, testEmail } from '../../../server/mail.mjs';

const assets = '../../../public';
const link = 'https://done.company.ru/?invite=Xy7abc&email=anna%40company.ru';
const expires = Date.UTC(2026, 9, 4);
const projects = [
  { name: 'Мобильное приложение 2.0', icon: '📱' },
  { name: 'Запуск веб-кабинета', icon: '🌐' },
];
const letters = {
  'invite-ru': inviteEmail({ lang: 'ru', workspace: 'Acme', inviter: 'Михаил', role: 'editor', link, expires, email: 'anna@company.ru', projects, assets }),
  'invite-en': inviteEmail({ lang: 'en', workspace: 'Acme', inviter: 'Mike', role: 'viewer', link, expires, email: 'anna@company.com', projects: null, assets }),
  'reset-ru': resetEmail({ lang: 'ru', name: 'Анна', email: 'anna@company.ru', link: 'https://done.company.ru/?reset=abc', hours: 1, assets }),
  'test-ru': testEmail({ lang: 'ru', link: 'https://done.company.ru/', assets }),
};
for (const [name, letter] of Object.entries(letters)) {
  writeFileSync(new URL(`./${name}.html`, import.meta.url), letter.html);
  writeFileSync(new URL(`./${name}.txt`, import.meta.url), `Subject: ${letter.subject}\n\n${letter.text}`);
}
console.log(Object.keys(letters).join(', '));
