import { Fragment } from 'react';
import { useUI } from '@/lib/ui';
import { useT, type TFunction, type TKey } from '@/lib/i18n';
import { isMac } from '@/lib/utils';
import { Dialog } from './ui/Overlay';
import { Kbd } from './ui/bits';

interface Shortcut {
  label: TKey;
  keys: string[];
  /** Keys pressed one after another (G then I) instead of together. */
  then?: boolean;
  /** Another way to do the same thing. */
  or?: string[];
}

/**
 * Every shortcut that actually works, grouped like Notion's list. Global ones live in
 * AppShell (palette, C, G sequences, sidebar, theme, ?), the rest in the inbox, backlog,
 * files, comments, the new task dialog and the BlockNote editor.
 */
function sections(t: TFunction): { title: TKey; rows: Shortcut[] }[] {
  const mac = isMac();
  const mod = mac ? '⌘' : 'Ctrl';
  const shift = mac ? '⇧' : 'Shift';
  const alt = mac ? '⌥' : 'Alt';
  return [
    {
      title: 'shortcuts.section.navigation',
      rows: [
        { label: 'shortcuts.palette', keys: [mod, 'K'] },
        { label: 'shortcuts.goHome', keys: ['G', 'H'], then: true },
        { label: 'shortcuts.goInbox', keys: ['G', 'I'], then: true },
        { label: 'shortcuts.goMyWork', keys: ['G', 'M'], then: true },
        { label: 'shortcuts.goCalendar', keys: ['G', 'C'], then: true },
        { label: 'shortcuts.goRoadmap', keys: ['G', 'R'], then: true },
        { label: 'shortcuts.goFiles', keys: ['G', 'F'], then: true },
        { label: 'shortcuts.goSettings', keys: ['G', 'S'], then: true },
      ],
    },
    {
      title: 'shortcuts.section.create',
      rows: [
        { label: 'shortcuts.newItem', keys: ['C'] },
        { label: 'shortcuts.createSubmit', keys: [mod, 'Enter'] },
        { label: 'shortcuts.commentSend', keys: ['Enter'] },
        { label: 'shortcuts.commentNewline', keys: [shift, 'Enter'] },
        { label: 'shortcuts.mention', keys: ['@'] },
      ],
    },
    {
      title: 'shortcuts.section.inbox',
      rows: [
        { label: 'shortcuts.inboxMove', keys: ['↓', '↑'], or: ['J', 'K'] },
        { label: 'shortcuts.inboxArchive', keys: ['E'] },
        { label: 'shortcuts.inboxRead', keys: ['U'] },
      ],
    },
    {
      title: 'shortcuts.section.interface',
      rows: [
        { label: 'shortcuts.sidebar', keys: [mod, '\\'] },
        { label: 'shortcuts.theme', keys: [mod, shift, 'L'] },
        { label: 'shortcuts.close', keys: ['Esc'] },
        { label: 'shortcuts.rangeSelect', keys: [shift, t('shortcuts.click')] },
        { label: 'shortcuts.paste', keys: [mod, 'V'] },
        { label: 'shortcuts.preview', keys: ['←', '→'] },
        { label: 'shortcuts.help', keys: ['?'] },
      ],
    },
    {
      title: 'shortcuts.section.editor',
      rows: [
        { label: 'shortcuts.slash', keys: ['/'] },
        { label: 'shortcuts.bold', keys: [mod, 'B'] },
        { label: 'shortcuts.italic', keys: [mod, 'I'] },
        { label: 'shortcuts.underline', keys: [mod, 'U'] },
        { label: 'shortcuts.strike', keys: [mod, shift, 'S'] },
        { label: 'shortcuts.code', keys: [mod, 'E'] },
        { label: 'shortcuts.heading', keys: [mod, alt, '1–3'] },
        { label: 'shortcuts.bullets', keys: [mod, shift, '8'] },
        { label: 'shortcuts.numbers', keys: [mod, shift, '7'] },
        { label: 'shortcuts.checklist', keys: [mod, shift, '9'] },
        { label: 'shortcuts.indent', keys: ['Tab'], or: [shift, 'Tab'] },
        { label: 'shortcuts.moveBlock', keys: [mod, shift, '↑↓'] },
        { label: 'shortcuts.undo', keys: [mod, 'Z'] },
        { label: 'shortcuts.redo', keys: [mod, shift, 'Z'] },
      ],
    },
  ];
}

function Keys({ keys, then, thenLabel }: { keys: string[]; then?: boolean; thenLabel: string }) {
  return (
    <>
      {keys.map((key, i) => (
        <Fragment key={`${key}${i}`}>
          {then && i > 0 && <span className="px-0.5 text-[11.5px] text-fg-4">{thenLabel}</span>}
          <Kbd className="h-[22px] min-w-[22px] px-1.5 text-[12px]">{key}</Kbd>
        </Fragment>
      ))}
    </>
  );
}

export function ShortcutsDialog() {
  const t = useT();
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcuts);
  return (
    <Dialog open={open} onOpenChange={setOpen} className="flex max-w-[480px] flex-col" title={t('shortcuts.title')}>
      <div className="shrink-0 border-b border-line px-5 pb-3 pt-4 text-[16px] font-semibold">{t('shortcuts.title')}</div>
      <div className="max-h-[min(640px,70vh)] overflow-y-auto px-3 pb-4">
        {sections(t).map((section) => (
          <section key={section.title} aria-labelledby={`shortcuts-${section.title}`}>
            <h3 id={`shortcuts-${section.title}`} className="px-2 pb-1 pt-4 text-[12px] font-medium text-fg-3">
              {t(section.title)}
            </h3>
            {section.rows.map((row) => (
              <div key={row.label} className="flex min-h-8 items-center justify-between gap-4 rounded-md px-2 py-1 hover:bg-hover">
                <span className="min-w-0 text-[13.5px] text-fg-2">{t(row.label)}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Keys keys={row.keys} then={row.then} thenLabel={t('shortcuts.then')} />
                  {row.or && (
                    <>
                      <span className="px-0.5 text-[11.5px] text-fg-4">{t('shortcuts.or')}</span>
                      <Keys keys={row.or} thenLabel={t('shortcuts.then')} />
                    </>
                  )}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
