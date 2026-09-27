import type { Lang } from './types';

/** A CSV value. Numbers stay numbers (never prefixed); everything else is text. */
export type CsvCell = string | number | null | undefined;

export interface CsvFormat {
  /** Russian Excel splits columns on ';', English on ','. */
  delimiter: ',' | ';';
  /** Decimal separator for numbers: ',' pairs with ';' so Russian Excel reads 1,5 as a number. */
  decimal: '.' | ',';
}

export function csvFormat(lang: Lang): CsvFormat {
  return lang === 'ru' ? { delimiter: ';', decimal: ',' } : { delimiter: ',', decimal: '.' };
}

/**
 * Characters that make a spreadsheet treat a text cell as a formula (OWASP CSV injection),
 * plus their fullwidth forms, which some spreadsheet apps normalise.
 */
const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

function formatNumber(n: number, decimal: CsvFormat['decimal']): string {
  if (!Number.isFinite(n)) return '';
  const s = String(n);
  return decimal === ',' ? s.replace('.', ',') : s;
}

/** One field, RFC 4180 quoted when needed and neutralised against formula injection. */
export function csvField(value: CsvCell, format: CsvFormat): string {
  if (value == null) return '';
  let s: string;
  if (typeof value === 'number') {
    s = formatNumber(value, format.decimal);
  } else {
    s = String(value);
    if (FORMULA_START.test(s)) s = `'${s}`;
  }
  if (s.includes(format.delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Builds CSV text: CRLF line endings and, by default, a UTF-8 BOM so Excel
 * opens Cyrillic text correctly.
 */
export function toCsv(rows: CsvCell[][], format: CsvFormat, { bom = true }: { bom?: boolean } = {}): string {
  const body = rows.map((row) => row.map((cell) => csvField(cell, format)).join(format.delimiter)).join('\r\n');
  return `${bom ? UTF8_BOM : ''}${body}\r\n`;
}

/** U+FEFF, written as a char code so the source never holds an invisible character. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Makes a name safe for Windows, macOS and Linux file systems. */
export function safeFileName(name: string, fallback = 'export'): string {
  const cleaned = name
    // Reserved on Windows or path separators everywhere, plus control characters.
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows drops trailing dots and spaces; a leading dot hides the file on Unix.
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const short = [...cleaned]
    .slice(0, 80)
    .join('')
    .replace(/[.\s]+$/, '');
  if (!short || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(short)) return fallback;
  return short;
}

/** "<name>-<yyyy-MM-dd>.<ext>", e.g. "Mobile app-2026-09-26.csv". */
export function datedFileName(name: string, date: string, ext: string, fallback?: string): string {
  return `${safeFileName(name, fallback)}-${date}.${ext}`;
}
