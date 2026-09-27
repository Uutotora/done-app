import { describe, expect, it } from 'vitest';
import { UTF8_BOM, csvField, csvFormat, datedFileName, safeFileName, toCsv } from '@/lib/csv';

const EN = csvFormat('en');
const RU = csvFormat('ru');

describe('csvFormat', () => {
  it('uses ; and a decimal comma for Russian, , and a dot for English', () => {
    expect(RU).toEqual({ delimiter: ';', decimal: ',' });
    expect(EN).toEqual({ delimiter: ',', decimal: '.' });
  });
});

describe('csvField', () => {
  it('leaves plain text and empty values alone', () => {
    expect(csvField('Onboarding', EN)).toBe('Onboarding');
    expect(csvField('Онбординг', RU)).toBe('Онбординг');
    expect(csvField('', EN)).toBe('');
    expect(csvField(null, EN)).toBe('');
    expect(csvField(undefined, EN)).toBe('');
  });

  it('quotes fields with the delimiter, quotes, CR or LF and doubles quotes (RFC 4180)', () => {
    expect(csvField('a,b', EN)).toBe('"a,b"');
    expect(csvField('a;b', RU)).toBe('"a;b"');
    expect(csvField('say "hi"', EN)).toBe('"say ""hi"""');
    expect(csvField('line 1\nline 2', EN)).toBe('"line 1\nline 2"');
    expect(csvField('line 1\r\nline 2', EN)).toBe('"line 1\r\nline 2"');
  });

  it('only quotes on the active delimiter', () => {
    expect(csvField('a;b', EN)).toBe('a;b');
    expect(csvField('a, b', RU)).toBe('a, b');
  });

  it('neutralises cells a spreadsheet would run as formulas', () => {
    expect(csvField('=SUM(A1:A2)', EN)).toBe("'=SUM(A1:A2)");
    expect(csvField('+1 day', EN)).toBe("'+1 day");
    expect(csvField('-cmd', EN)).toBe("'-cmd");
    expect(csvField('@import', EN)).toBe("'@import");
    expect(csvField('\tTab', EN)).toBe("'\tTab");
    expect(csvField('\rCR', EN)).toBe('"\'\rCR"');
    expect(csvField('＝1+1', EN)).toBe("'＝1+1");
    // Prefixed first, then quoted, so the apostrophe stays inside the quotes.
    expect(csvField('=HYPERLINK("http://x","y")', EN)).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    // Only the first character matters.
    expect(csvField('a=b', EN)).toBe('a=b');
  });

  it('writes numbers as numbers, never prefixed, with the locale decimal mark', () => {
    expect(csvField(-3, EN)).toBe('-3');
    expect(csvField(1.5, EN)).toBe('1.5');
    expect(csvField(1.5, RU)).toBe('1,5');
    expect(csvField(-0.25, RU)).toBe('-0,25');
    expect(csvField(0, EN)).toBe('0');
    expect(csvField(Number.NaN, EN)).toBe('');
    expect(csvField(Number.POSITIVE_INFINITY, EN)).toBe('');
  });

  it('quotes a decimal comma when the delimiter is a comma', () => {
    expect(csvField(1.5, { delimiter: ',', decimal: ',' })).toBe('"1,5"');
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 BOM and ends every line with CRLF', () => {
    const text = toCsv(
      [
        ['Title', 'Estimate'],
        ['Вход по телефону', 3],
        ['a;b', 0.5],
      ],
      RU,
    );
    expect(text.startsWith(UTF8_BOM)).toBe(true);
    expect(text.slice(1)).toBe('Title;Estimate\r\nВход по телефону;3\r\n"a;b";0,5\r\n');
  });

  it('encodes as UTF-8 with the BOM bytes EF BB BF', () => {
    const bytes = new TextEncoder().encode(toCsv([['Ж']], EN));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('can skip the BOM and keeps empty cells', () => {
    expect(toCsv([['a', '', null, 'd']], EN, { bom: false })).toBe('a,,,d\r\n');
  });
});

describe('safeFileName', () => {
  it('replaces characters file systems reject and collapses spaces', () => {
    expect(safeFileName('Q3: plan / "draft" <v2>?')).toBe('Q3 plan draft v2');
    expect(safeFileName('a\\b|c*d')).toBe('a b c d');
    expect(safeFileName('tab\there\nnew')).toBe('tab here new');
  });

  it('drops leading and trailing dots and spaces', () => {
    expect(safeFileName('  .hidden. ')).toBe('hidden');
    expect(safeFileName('Report...')).toBe('Report');
  });

  it('falls back for empty and reserved names', () => {
    expect(safeFileName('')).toBe('export');
    expect(safeFileName(' // ', 'done')).toBe('done');
    expect(safeFileName('CON')).toBe('export');
    expect(safeFileName('lpt1', 'doc')).toBe('doc');
  });

  it('keeps Cyrillic and limits the length without leaving a trailing dot', () => {
    expect(safeFileName('Мобильное приложение · Баги')).toBe('Мобильное приложение · Баги');
    const long = `${'a'.repeat(79)}.bcd`;
    expect(safeFileName(long)).toBe('a'.repeat(79));
    expect([...safeFileName('я'.repeat(200))].length).toBe(80);
  });
});

describe('datedFileName', () => {
  it('builds "<name>-<date>.<ext>"', () => {
    expect(datedFileName('Mobile app', '2026-09-26', 'csv')).toBe('Mobile app-2026-09-26.csv');
    expect(datedFileName('A/B', '2026-09-26', 'csv')).toBe('A B-2026-09-26.csv');
    expect(datedFileName('', '2026-09-26', 'csv', 'done')).toBe('done-2026-09-26.csv');
  });
});
