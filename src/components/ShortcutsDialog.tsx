import { useUI } from '@/lib/ui';
import { useT, type TKey } from '@/lib/i18n';
import { modKey } from '@/lib/utils';
import { Dialog } from './ui/Overlay';
import { Kbd } from './ui/bits';

export function ShortcutsDialog() {
  const t = useT();
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcuts);
  const mod = modKey();
  const rows: [TKey, string[]][] = [
    ['shortcuts.palette', [mod, 'K']],
    ['shortcuts.newItem', ['C']],
    ['shortcuts.sidebar', [mod, '\\']],
    ['shortcuts.theme', [mod, '⇧', 'L']],
    ['shortcuts.slash', ['/']],
    ['shortcuts.close', ['Esc']],
    ['shortcuts.help', ['?']],
  ];
  return (
    <Dialog open={open} onOpenChange={setOpen} className="max-w-[420px]" title={t('shortcuts.title')}>
      <div className="p-5">
        <div className="mb-4 text-[16px] font-semibold">{t('shortcuts.title')}</div>
        <div className="space-y-1">
          {rows.map(([k, keys]) => (
            <div key={k} className="flex h-9 items-center justify-between rounded-md px-2 hover:bg-hover">
              <span className="text-[14px] text-fg-2">{t(k)}</span>
              <span className="flex gap-1">
                {keys.map((key) => (
                  <Kbd key={key} className="h-[22px] min-w-[22px] text-[12px]">
                    {key}
                  </Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
