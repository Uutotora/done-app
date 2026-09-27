import { describe, expect, it } from 'vitest';
import { csvFormat, toCsv } from '@/lib/csv';
import { translate, type TKey } from '@/lib/i18n';
import {
  BOARD_COLUMNS,
  MY_WORK_COLUMNS,
  backlogColumns,
  columnLabel,
  groupLabel,
  itemCell,
  itemTable,
  pickRows,
  queryRows,
  type ItemExportContext,
} from '@/lib/itemExport';
import { EMPTY_FILTER } from '@/lib/itemQuery';
import { absolutizeUrls, escapeMarkdownText, itemPropertiesMarkdown, markdownDocument, printDocumentHtml } from '@/lib/docExport';
import type { Item, Lang, Person, Project, Sprint } from '@/lib/types';

let n = 0;
function item(p: Partial<Item>): Item {
  n++;
  return {
    id: p.id ?? `i${n}`,
    projectId: 'p1',
    type: 'task',
    title: `Item ${n}`,
    status: 'backlog',
    priority: 'none',
    tags: [],
    order: n,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...p,
  };
}

const people: Record<string, Person> = {
  u1: { id: 'u1', name: 'Анна Смирнова', color: 'blue' },
  u2: { id: 'u2', name: 'Boris', color: 'green' },
};
const sprints: Record<string, Sprint> = {
  s1: {
    id: 's1',
    projectId: 'p1',
    name: 'Sprint 7',
    startDate: '2026-09-21',
    endDate: '2026-10-04',
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
};
const projects: Record<string, Project> = {
  p1: {
    id: 'p1',
    name: 'Mobile app',
    icon: 'icon:box:gray',
    color: 'gray',
    status: 'on_track',
    order: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Project,
};

function ctxFor(lang: Lang, list: Item[]): ItemExportContext {
  return {
    t: (key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    items: Object.fromEntries(list.map((i) => [i.id, i])),
    people,
    sprints,
    projects,
  };
}

describe('itemCell', () => {
  const epic = item({ id: 'epic', type: 'epic', title: 'Onboarding' });
  const full = item({
    id: 'full',
    title: '  Phone sign-up  ',
    type: 'feature',
    status: 'in_progress',
    priority: 'high',
    horizon: 'now',
    assigneeId: 'u1',
    startDate: '2026-09-01',
    dueDate: '2026-09-30T12:00:00.000Z' as Item['dueDate'],
    estimate: 2.5,
    tags: ['growth', 'ios'],
    rice: { reach: 1000, impact: 2, confidence: 80, effort: 4 },
    parentId: 'epic',
    sprintId: 's1',
    plane: { issueId: 'x', projectId: 'y', key: 'MOB-12' },
  });
  const bare = item({ id: 'bare', title: '   ', assigneeId: 'gone', sprintId: 'gone', parentId: 'gone' });

  it('shows labels in the UI language and names instead of ids (ru)', () => {
    const ctx = ctxFor('ru', [epic, full, bare]);
    const cells = (['title', 'type', 'parent', 'project', 'status', 'priority', 'assignee', 'start', 'due', 'sprint'] as const).map((c) =>
      itemCell(full, c, ctx),
    );
    expect(cells).toEqual([
      'Phone sign-up',
      'Фича',
      'Onboarding',
      'Mobile app',
      'В работе',
      'Высокий',
      'Анна Смирнова',
      '2026-09-01',
      '2026-09-30',
      'Sprint 7',
    ]);
    expect(itemCell(full, 'horizon', ctx)).toBe('Сейчас');
    expect(itemCell(full, 'tags', ctx)).toBe('growth, ios');
    expect(itemCell(full, 'estimate', ctx)).toBe(2.5);
    expect(itemCell(full, 'rice', ctx)).toBe(400);
    expect(itemCell(full, 'plane', ctx)).toBe('MOB-12');
    expect(itemCell(full, 'id', ctx)).toBe('full');
  });

  it('uses English labels for en', () => {
    const ctx = ctxFor('en', [epic, full]);
    expect(itemCell(full, 'status', ctx)).toBe('In progress');
    expect(itemCell(full, 'type', ctx)).toBe(translate('en', 'type.feature'));
    expect(columnLabel('assignee', ctx.t)).toBe(translate('en', 'prop.assignee'));
    expect(columnLabel('id', ctx.t)).toBe('ID');
  });

  it('leaves missing values blank and names untitled items', () => {
    const ctx = ctxFor('ru', [bare]);
    expect(itemCell(bare, 'title', ctx)).toBe('Без названия');
    for (const col of ['parent', 'assignee', 'sprint', 'start', 'due', 'priority', 'horizon', 'tags', 'rice', 'estimate', 'plane'] as const) {
      expect(itemCell(bare, col, ctx)).toBe('');
    }
  });
});

describe('groupLabel', () => {
  const ctx = ctxFor('ru', []);
  it('names every kind of group like the views do', () => {
    expect(groupLabel('status', 'done', ctx)).toBe('Готово');
    expect(groupLabel('priority', 'none', ctx)).toBe('Без приоритета');
    expect(groupLabel('horizon', 'none', ctx)).toBe('Не распределено');
    expect(groupLabel('assignee', 'none', ctx)).toBe('Не назначен');
    expect(groupLabel('assignee', 'u2', ctx)).toBe('Boris');
    expect(groupLabel('sprint', 's1', ctx)).toBe('Sprint 7');
    expect(groupLabel('sprint', 'none', ctx)).toBe('Без спринта');
    expect(groupLabel('none', 'all', ctx)).toBe('');
  });
});

describe('queryRows', () => {
  const parent = item({ id: 'a', title: 'Parent', order: 1, status: 'in_progress', priority: 'low' });
  const child = item({ id: 'a1', title: 'Child', order: 2, parentId: 'a', status: 'backlog', priority: 'urgent' });
  const other = item({ id: 'b', title: 'Other', order: 3, status: 'backlog', priority: 'high' });
  const done = item({ id: 'c', title: 'Finished', order: 4, status: 'done', priority: 'medium' });
  const orphan = item({ id: 'd1', title: 'Orphan', order: 5, parentId: 'hidden', status: 'backlog' });
  const all = [done, other, child, parent, orphan];
  const ctx = ctxFor('en', all);

  it('keeps sub-items right under their parent in manual order', () => {
    const rows = queryRows(all, { filter: EMPTY_FILTER, sort: { field: 'manual', dir: 'asc' }, group: 'none' }, ctx);
    expect(rows.map((r) => r.item.id)).toEqual(['a', 'a1', 'b', 'c', 'd1']);
    expect(rows.every((r) => r.group === undefined)).toBe(true);
  });

  it('applies the filter, search and sort', () => {
    const rows = queryRows(all, { filter: { ...EMPTY_FILTER, hideDone: true }, sort: { field: 'priority', dir: 'asc' }, group: 'none' }, ctx);
    expect(rows.map((r) => r.item.id)).not.toContain('c');
    expect(rows[0].item.id).toBe('b');
    const found = queryRows(all, { filter: { ...EMPTY_FILTER, search: 'orph' }, sort: { field: 'manual', dir: 'asc' }, group: 'none' }, ctx);
    expect(found.map((r) => r.item.id)).toEqual(['d1']);
  });

  it('flattens groups in display order and labels each row', () => {
    const rows = queryRows(all, { filter: EMPTY_FILTER, sort: { field: 'manual', dir: 'asc' }, group: 'status' }, ctx);
    expect(rows.map((r) => [r.group, r.item.id])).toEqual([
      ['Backlog', 'a1'],
      ['Backlog', 'b'],
      ['Backlog', 'd1'],
      [translate('en', 'status.in_progress'), 'a'],
      [translate('en', 'status.done'), 'c'],
    ]);
  });

  it('can list cards without nesting (boards)', () => {
    const rows = queryRows(all, { filter: EMPTY_FILTER, sort: { field: 'manual', dir: 'asc' }, group: 'none' }, ctx, [], false);
    expect(rows.map((r) => r.item.id)).toEqual(['a', 'a1', 'b', 'c', 'd1']);
    const reversed = queryRows([child, parent], { filter: EMPTY_FILTER, sort: { field: 'title', dir: 'asc' }, group: 'none' }, ctx, [], false);
    expect(reversed.map((r) => r.item.id)).toEqual(['a1', 'a']);
  });
});

describe('pickRows', () => {
  it('keeps display order and appends selected rows the filter hides', () => {
    const a = item({ id: 'a' });
    const b = item({ id: 'b' });
    const c = item({ id: 'c' });
    const rows = [
      { item: a, group: 'G1' },
      { item: b, group: 'G2' },
    ];
    const picked = pickRows(rows, ['c', 'b', 'missing', 'a'], { a, b, c });
    expect(picked.map((r) => [r.item.id, r.group])).toEqual([
      ['a', 'G1'],
      ['b', 'G2'],
      ['c', undefined],
    ]);
  });
});

describe('columns', () => {
  it('puts title, type and parent first, expands dates and ends with the id', () => {
    expect(backlogColumns(['status', 'due', 'rice'])).toEqual(['title', 'type', 'parent', 'status', 'start', 'due', 'rice', 'id']);
    expect(backlogColumns([])).toEqual(['title', 'type', 'parent', 'id']);
    for (const cols of [MY_WORK_COLUMNS, BOARD_COLUMNS]) {
      expect(cols[0]).toBe('title');
      expect(cols.at(-1)).toBe('id');
    }
    expect(MY_WORK_COLUMNS).toContain('project');
  });
});

describe('itemTable', () => {
  const parent = item({ id: 'p', title: 'Epic "Q3"', type: 'epic' });
  const child = item({ id: 'k', title: '=cmd|calc', parentId: 'p', estimate: 1.5, assigneeId: 'u1' });
  const ctx = ctxFor('ru', [parent, child]);

  it('adds the group as the first column and makes a CSV Excel opens as-is', () => {
    const table = itemTable(
      [
        { item: parent, group: 'Бэклог' },
        { item: child, group: 'Бэклог' },
      ],
      ['title', 'parent', 'assignee', 'estimate', 'id'],
      ctx,
      true,
    );
    expect(table[0]).toEqual(['Группа', 'Название', 'Родитель', 'Исполнитель', 'Оценка', 'ID']);
    const csv = toCsv(table, csvFormat('ru'), { bom: false });
    expect(csv.split('\r\n')).toEqual([
      'Группа;Название;Родитель;Исполнитель;Оценка;ID',
      'Бэклог;"Epic ""Q3""";;;;p',
      'Бэклог;\'=cmd|calc;"Epic ""Q3""";Анна Смирнова;1,5;k',
      '',
    ]);
  });

  it('has no group column without grouping', () => {
    const table = itemTable([{ item: parent }], ['title', 'id'], ctxFor('en', [parent]));
    expect(table).toEqual([
      ['Title', 'ID'],
      ['Epic "Q3"', 'p'],
    ]);
  });
});

describe('markdown helpers', () => {
  it('escapes Markdown syntax in plain text', () => {
    expect(escapeMarkdownText('  Plan *v2*_draft  [x] <b>|\n')).toBe('Plan \\*v2\\*\\_draft \\[x\\] \\<b\\>\\|');
    expect(escapeMarkdownText('C# notes ##')).toBe('C# notes \\#\\#');
  });

  it('builds "# title" and joins non-empty sections', () => {
    expect(markdownDocument('Roadmap', 'First\r\n\r\nSecond', '  ', '- a')).toBe('# Roadmap\n\nFirst\n\nSecond\n\n- a\n');
    expect(markdownDocument('Без названия')).toBe('# Без названия\n');
  });

  it('lists an item’s filled-in properties', () => {
    const parent = item({ id: 'p', title: 'Onboarding' });
    const it = item({ id: 'x', status: 'done', priority: 'none', tags: ['a_b'], parentId: 'p', dueDate: '2026-10-01' });
    expect(itemPropertiesMarkdown(it, ctxFor('en', [parent, it])).split('\n')).toEqual([
      `- Type: ${translate('en', 'type.task')}`,
      `- Status: ${translate('en', 'status.done')}`,
      `- ${translate('en', 'prop.due')}: 2026-10-01`,
      `- ${translate('en', 'prop.tags')}: a\\_b`,
      `- ${translate('en', 'prop.project')}: Mobile app`,
      `- ${translate('en', 'prop.parent')}: Onboarding`,
    ]);
  });
});

describe('absolutizeUrls', () => {
  it('makes root-relative url and href values absolute and leaves the rest', () => {
    const blocks = [
      { type: 'image', props: { url: '/api/files/abc', caption: '/not-a-url' }, children: [] },
      { type: 'paragraph', content: [{ type: 'link', href: '/items/x', content: [{ type: 'text', text: '/items/x' }] }] },
      { type: 'image', props: { url: 'https://cdn.example.com/a.png' } },
      { type: 'image', props: { url: '//evil.example/a.png' } },
      { type: 'image', props: { url: 'data:image/png;base64,AAAA' } },
    ];
    const out = absolutizeUrls(blocks, 'https://done.example.com/');
    expect(out[0]).toEqual({ type: 'image', props: { url: 'https://done.example.com/api/files/abc', caption: '/not-a-url' }, children: [] });
    expect((out[1] as { content: { href: string; content: { text: string }[] }[] }).content[0].href).toBe('https://done.example.com/items/x');
    expect((out[1] as { content: { content: { text: string }[] }[] }).content[0].content[0].text).toBe('/items/x');
    expect(out.slice(2)).toEqual(blocks.slice(2));
    // The input is not mutated.
    expect(blocks[0].props?.url).toBe('/api/files/abc');
  });
});

describe('printDocumentHtml', () => {
  it('wraps the body with an escaped title, font and size classes and A4 print CSS', () => {
    const html = printDocumentHtml({
      title: 'Plan <script>alert(1)</script> & "notes"',
      bodyHtml: '<p>Hello</p>',
      font: 'serif',
      small: true,
      lang: 'en',
      baseUrl: 'https://done.example.com',
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<base href="https://done.example.com/">');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<title>Plan &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;notes&quot;</title>');
    expect(html).toContain('<body class="serif small">');
    expect(html).toContain('<p>Hello</p>');
    expect(html).toMatch(/@page \{ size: A4;/);
    expect(html).toMatch(/img, video \{[^}]*max-width: 100%/);
    expect(html).toMatch(/break-inside: avoid/);
  });

  it('uses the default font without extra classes', () => {
    const html = printDocumentHtml({ title: 'Без названия', bodyHtml: '', lang: 'ru' });
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain('<body>');
    expect(html).not.toContain('<base');
    expect(html).toContain('<h1 class="doc-title">Без названия</h1>');
    expect(printDocumentHtml({ title: 't', bodyHtml: '', lang: 'ru', font: 'mono' })).toContain('<body class="mono">');
  });
});
