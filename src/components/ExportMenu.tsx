import { Download, FileDown, MoreHorizontal } from 'lucide-react';
import { useData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { translate, useT, type TKey } from '@/lib/i18n';
import { csvFormat, datedFileName, toCsv } from '@/lib/csv';
import { todayISO } from '@/lib/dates';
import { exportItemMarkdown } from '@/lib/docExport';
import { itemTable, type ExportRow, type ItemColumn, type ItemExportContext } from '@/lib/itemExport';
import type { ID } from '@/lib/types';
import { downloadBlob } from '@/lib/utils';
import { EntriesMenu, type MenuEntry } from './ui/Overlay';
import { BarButton } from './ViewBar';

/** Store data an export needs, read when the export runs so the file matches the screen. */
export function itemExportContext(): ItemExportContext {
  const s = useData.getState();
  return {
    t: (key: TKey, vars?: Record<string, string | number>) => translate(s.prefs.lang, key, vars),
    items: s.items,
    people: s.people,
    sprints: s.sprints,
    projects: s.projects,
  };
}

/**
 * Downloads rows as "<name>-<yyyy-MM-dd>.csv" in the UI language's CSV
 * dialect. Nothing to export shows a calm hint instead of an empty file.
 */
export function downloadItemsCsv(
  rows: ExportRow[],
  columns: ItemColumn[],
  ctx: ItemExportContext,
  name: string,
  { withGroup = false }: { withGroup?: boolean } = {},
): void {
  if (!rows.length) {
    toast({ message: ctx.t('export.nothing') });
    return;
  }
  const lang = useData.getState().prefs.lang;
  const text = toCsv(itemTable(rows, columns, ctx, withGroup), csvFormat(lang));
  downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), datedFileName(name, todayISO(), 'csv', 'done'));
}

/** Downloads a task (properties and description) as Markdown. */
export function exportItemAsMarkdown(itemId: ID): void {
  const ctx = itemExportContext();
  const item = ctx.items[itemId];
  if (!item) return;
  exportItemMarkdown(item, ctx).catch(() => toast({ message: ctx.t('export.failed'), tone: 'error' }));
}

/** "Export to Markdown" entry for an item's "•••" menu. */
export function itemMarkdownEntry(itemId: ID, t: (key: TKey) => string): MenuEntry {
  return { key: 'export-md', icon: <FileDown size={15} />, label: t('item.exportMarkdown'), onSelect: () => exportItemAsMarkdown(itemId) };
}

/** "Export to CSV" entry for view menus. */
export function csvMenuEntry(onSelect: () => void, t: (key: TKey) => string): MenuEntry {
  return { key: 'export-csv', icon: <Download size={15} />, label: t('export.csv'), onSelect };
}

/** The "•••" button at the right of a database view bar, like Notion's view options. */
export function ViewMoreMenu({ entries }: { entries: MenuEntry[] }) {
  const t = useT();
  return <EntriesMenu align="end" entries={entries} trigger={<BarButton icon={<MoreHorizontal size={16} />} aria-label={t('common.more')} />} />;
}
