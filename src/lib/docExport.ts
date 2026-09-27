import { safeFileName } from './csv';
import { columnLabel, itemCell, type ItemColumn, type ItemExportContext } from './itemExport';
import type { Doc, DocFont, Item, Lang } from './types';
import { downloadBlob, escapeHtml } from './utils';

/**
 * Document export: Markdown files and print-ready HTML for "Save as PDF".
 * The helpers at the top are pure; the BlockNote conversion lives in
 * docExportEditor.ts and is imported on demand so the editor stays out of the
 * main bundle.
 */

/** Makes root-relative links and file URLs (e.g. /api/files/…) absolute so they work outside the app. */
export function absolutizeUrls<T>(value: T, origin: string): T {
  const base = origin.replace(/\/+$/, '');
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') return (key === 'url' || key === 'href') && /^\/(?!\/)/.test(v) ? base + v : v;
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value) as T;
}

/** Plain text that must not turn into Markdown formatting, e.g. a title with * or _. */
export function escapeMarkdownText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_[\]<>|]/g, '\\$&')
    .replace(/#+$/, (m) => m.replace(/#/g, '\\#'));
}

/** "# Title", then the non-empty sections separated by blank lines. */
export function markdownDocument(title: string, ...sections: string[]): string {
  const parts = sections.map((s) => s.replace(/\r\n?/g, '\n').trim()).filter(Boolean);
  return [`# ${escapeMarkdownText(title)}`, ...parts].join('\n\n') + '\n';
}

const ITEM_PROPS: ItemColumn[] = ['type', 'status', 'priority', 'assignee', 'start', 'due', 'sprint', 'tags', 'project', 'parent'];

/** An item's filled-in properties as a Markdown list, like the top of a Notion page export. */
export function itemPropertiesMarkdown(item: Item, ctx: ItemExportContext): string {
  return ITEM_PROPS.flatMap((col) => {
    const v = itemCell(item, col, ctx);
    return v === '' || v == null ? [] : [`- ${columnLabel(col, ctx.t)}: ${escapeMarkdownText(String(v))}`];
  }).join('\n');
}

const SANS = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";
const SERIF = "Lyon-Text, Georgia, ui-serif, serif, 'Apple Color Emoji', 'Segoe UI Emoji'";
const MONO = "'SFMono-Regular', Menlo, Consolas, 'PT Mono', 'Liberation Mono', Courier, monospace";

const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: #37352f; font-family: ${SANS}; font-size: 16px; line-height: 1.55; overflow-wrap: break-word; }
body.serif { font-family: ${SERIF}; }
body.mono { font-family: ${MONO}; }
body.small { font-size: 14px; }
.doc-title { font-size: 2.5em; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 0.8em; }
body.small .doc-title { font-size: 2.3em; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; margin: 1.3em 0 0.35em; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 1.875em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
h4, h5, h6 { font-size: 1em; }
p { margin: 0.3em 0; }
ul, ol { margin: 0.3em 0; padding-left: 1.6em; }
li { margin: 0.15em 0; }
li > p { margin: 0; }
blockquote { margin: 0.6em 0; padding: 0 0 0 0.9em; border-left: 3px solid #37352f; }
a { color: inherit; text-decoration: underline; text-decoration-color: rgba(55, 53, 47, 0.4); }
code { font-family: ${MONO}; font-size: 0.85em; background: rgba(135, 131, 120, 0.15); color: #eb5757; border-radius: 3px; padding: 0.15em 0.35em; }
pre { font-family: ${MONO}; font-size: 0.85em; line-height: 1.5; background: #f7f6f3; border-radius: 4px; padding: 12px 14px; margin: 0.6em 0; white-space: pre-wrap; }
pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
img, video { display: block; max-width: 100%; height: auto; margin: 0.5em 0; }
figure { margin: 0.6em 0; }
figcaption { font-size: 0.85em; color: #787774; }
table { border-collapse: collapse; width: 100%; margin: 0.6em 0; font-size: 0.9em; }
th, td { border: 1px solid #e3e2e0; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f7f6f3; font-weight: 600; }
hr { border: 0; border-top: 1px solid #e3e2e0; margin: 1.2em 0; }
input[type='checkbox'] { margin: 0 0.45em 0 0; vertical-align: -0.1em; }
img, video, pre, table, figure, blockquote, tr { break-inside: avoid; page-break-inside: avoid; }
`;

export interface PrintDocumentOptions {
  title: string;
  /** Trusted HTML produced by the BlockNote exporter. */
  bodyHtml: string;
  font?: DocFont;
  small?: boolean;
  lang: Lang;
  /** Base for any relative URL left in the body. */
  baseUrl?: string;
}

/** Standalone, print-ready HTML page for a document. */
export function printDocumentHtml({ title, bodyHtml, font = 'default', small, lang, baseUrl }: PrintDocumentOptions): string {
  const classes = [font === 'serif' ? 'serif' : font === 'mono' ? 'mono' : '', small ? 'small' : ''].filter(Boolean).join(' ');
  return [
    '<!doctype html>',
    `<html lang="${lang === 'en' ? 'en' : 'ru'}">`,
    '<head>',
    '<meta charset="utf-8">',
    baseUrl ? `<base href="${escapeHtml(baseUrl.replace(/\/*$/, '/'))}">` : '',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${PRINT_CSS}</style>`,
    '</head>',
    `<body${classes ? ` class="${classes}"` : ''}>`,
    '<main>',
    `<h1 class="doc-title">${escapeHtml(title)}</h1>`,
    bodyHtml,
    '</main>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------- Browser-only actions ------------------------- */

const docTitle = (doc: Pick<Doc, 'title'>, untitled: string) => doc.title.replace(/\s+/g, ' ').trim() || untitled;

function downloadMarkdown(markdown: string, name: string): void {
  downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(name, 'document')}.md`);
}

/** Downloads the page as "<title>.md". */
export async function exportDocMarkdown(doc: Doc, untitled: string): Promise<void> {
  const { blocksToMarkdown } = await import('./docExportEditor');
  const title = docTitle(doc, untitled);
  downloadMarkdown(markdownDocument(title, blocksToMarkdown(absolutizeUrls(doc.content ?? [], location.origin))), title);
}

/** Downloads a task with its properties and description as "<title>.md". */
export async function exportItemMarkdown(item: Item, ctx: ItemExportContext): Promise<void> {
  const { blocksToMarkdown } = await import('./docExportEditor');
  const title = docTitle(item, ctx.t('common.untitled'));
  const body = blocksToMarkdown(absolutizeUrls(item.content ?? [], location.origin));
  downloadMarkdown(markdownDocument(title, itemPropertiesMarkdown(item, ctx), body), title);
}

/** Opens the browser's print dialog for the page, where it can be saved as PDF. */
export async function printDoc(doc: Doc, lang: Lang, untitled: string): Promise<void> {
  const { blocksToHtml } = await import('./docExportEditor');
  const title = docTitle(doc, untitled);
  const bodyHtml = blocksToHtml(absolutizeUrls(doc.content ?? [], location.origin));
  printHtml(printDocumentHtml({ title, bodyHtml, font: doc.font, small: doc.smallText, lang, baseUrl: location.origin }), title);
}

const FRAME_ATTR = 'data-done-print';

/**
 * Prints HTML through a hidden iframe. The frame is sandboxed without scripts,
 * so nothing in the content can run; it is removed once printing ends.
 */
function printHtml(html: string, title: string): void {
  document.querySelectorAll(`iframe[${FRAME_ATTR}]`).forEach((f) => f.remove());
  const frame = document.createElement('iframe');
  frame.setAttribute(FRAME_ATTR, '');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  const prevTitle = document.title;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    // Only undo our own change, in case the app renamed the tab meanwhile.
    if (document.title === title) document.title = prevTitle;
    frame.remove();
  };
  frame.addEventListener(
    'load',
    () => {
      const win = frame.contentWindow;
      if (!win) return finish();
      win.addEventListener('afterprint', () => setTimeout(finish, 0));
      // Browsers suggest the PDF file name from the page title.
      document.title = title;
      win.focus();
      win.print();
    },
    { once: true },
  );
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
