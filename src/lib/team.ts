/** Mail services people use privately: their domain says nothing about the company. */
const PUBLIC_MAIL = new Set([
  'gmail',
  'googlemail',
  'yandex',
  'ya',
  'mail',
  'bk',
  'inbox',
  'list',
  'internet',
  'rambler',
  'outlook',
  'hotmail',
  'live',
  'msn',
  'icloud',
  'me',
  'mac',
  'yahoo',
  'proton',
  'protonmail',
  'pm',
  'gmx',
  'aol',
  'zoho',
  'fastmail',
  'tutanota',
]);
/** Second-level parts of country domains, such as co.uk or com.ru. */
const SUFFIXES = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'msk', 'spb']);

/**
 * A team name from a work address, so nobody has to invent a "workspace" before they start:
 * anna@acme.ru gives "Acme", anna@gmail.com gives "" (the name can be set later in Settings).
 */
export function teamNameFromEmail(email: string): string {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return '';
  let index = labels.length - 2;
  if (SUFFIXES.has(labels[index]) && index > 0) index--;
  const label = labels[index];
  if (!label || PUBLIC_MAIL.has(label) || /^xn--/.test(label)) return '';
  const words = label.split(/[-_]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
