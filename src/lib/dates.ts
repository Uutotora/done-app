import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameYear,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
  formatDistanceToNowStrict,
} from 'date-fns';
import { dateLocale, translate } from './i18n';
import type { ISODate, Lang } from './types';

export function toISODate(d: Date): ISODate {
  return format(d, 'yyyy-MM-dd');
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

/** Parses `yyyy-MM-dd` as a local date (not UTC). */
export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function shiftISO(s: ISODate, days: number): ISODate {
  return toISODate(addDays(fromISODate(s), days));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return differenceInCalendarDays(fromISODate(b), fromISODate(a));
}

export function daysFromToday(s: ISODate): number {
  return differenceInCalendarDays(fromISODate(s), new Date());
}

/** "d MMM" without relative words, for chart axes. */
export function formatAxisDate(s: ISODate | undefined, lang: Lang): string {
  if (!s) return '';
  return format(fromISODate(s), 'd MMM', { locale: dateLocale(lang) }).replace('.', '');
}

export function formatShortDate(s: ISODate | undefined, lang: Lang): string {
  if (!s) return '';
  const d = fromISODate(s);
  if (isToday(d)) return translate(lang, 'common.today');
  if (isTomorrow(d)) return translate(lang, 'common.tomorrow');
  if (isYesterday(d)) return translate(lang, 'common.yesterday');
  return format(d, isSameYear(d, new Date()) ? 'd MMM' : 'd MMM yyyy', { locale: dateLocale(lang) }).replace('.', '');
}

export function formatLongDate(s: string | undefined, lang: Lang): string {
  if (!s) return '';
  const d = s.length > 10 ? parseISO(s) : fromISODate(s);
  return format(d, isSameYear(d, new Date()) ? 'd MMMM' : 'd MMMM yyyy', { locale: dateLocale(lang) });
}

export function formatRange(start: ISODate | undefined, end: ISODate | undefined, lang: Lang): string {
  if (start && end && start !== end) return `${formatShortDate(start, lang)} → ${formatShortDate(end, lang)}`;
  return formatShortDate(end || start, lang);
}

export function formatDateTime(s: string, lang: Lang): string {
  const d = parseISO(s);
  const day = isToday(d)
    ? translate(lang, 'common.today')
    : isYesterday(d)
      ? translate(lang, 'common.yesterday')
      : isTomorrow(d)
        ? translate(lang, 'common.tomorrow')
        : format(d, isSameYear(d, new Date()) ? 'd MMM' : 'd MMM yyyy', { locale: dateLocale(lang) }).replace('.', '');
  return `${day}, ${format(d, 'HH:mm')}`;
}

export function formatTime(s: string): string {
  return format(parseISO(s), 'HH:mm');
}

export function timeAgo(s: string, lang: Lang): string {
  const d = parseISO(s);
  if (Math.abs(Date.now() - d.getTime()) < 45_000) return translate(lang, 'common.justNow');
  return formatDistanceToNowStrict(d, { addSuffix: true, locale: dateLocale(lang) });
}

export function weekStartsOn(lang: Lang): 0 | 1 {
  return lang === 'en' ? 0 : 1;
}
