import { AnimatePresence, motion } from 'motion/react';
import { Outlet, useLocation, useMatch } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useHotkey, useIsDark } from '@/lib/hooks';
import { Sidebar } from './Sidebar';
import { Toaster } from './Toaster';
import { Celebration } from './Celebration';
import { CommandPalette } from './CommandPalette';
import { CreateItemDialog } from './CreateItemDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { SidePeek } from './SidePeek';
import { LinkDialog } from './files/LinkDialog';
import { FilePreview } from './files/FilePreview';

export function AppShell() {
  const location = useLocation();
  const setPrefs = useData((s) => s.setPrefs);
  const isDark = useIsDark();
  const ui = useUI();
  const projectMatch = useMatch('/p/:projectId/*');

  useHotkey(
    'mod+k',
    (e) => {
      e.preventDefault();
      ui.setPalette(!useUI.getState().paletteOpen);
    },
    { allowInInputs: true },
  );
  useHotkey(
    'mod+\\',
    (e) => {
      e.preventDefault();
      setPrefs({ sidebarCollapsed: !useData.getState().prefs.sidebarCollapsed });
    },
    { allowInInputs: true },
  );
  useHotkey(
    'mod+shift+l',
    (e) => {
      e.preventDefault();
      setPrefs({ theme: isDark ? 'light' : 'dark' });
    },
    { allowInInputs: true },
  );
  useHotkey('c', (e) => {
    if (useUI.getState().createItem.open || useUI.getState().paletteOpen) return;
    e.preventDefault();
    ui.openCreateItem(projectMatch ? { projectId: projectMatch.params.projectId } : undefined);
  });
  useHotkey('shift+?', () => ui.setShortcuts(true));

  // Page-level transitions keyed by the section, so switching project tabs feels calm.
  const sectionKey = location.pathname.split('/').slice(0, 3).join('/');

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg text-fg">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={sectionKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <SidePeek />
      <CommandPalette />
      <CreateItemDialog />
      <ShortcutsDialog />
      <LinkDialog />
      <FilePreview />
      <Toaster />
      <Celebration />
    </div>
  );
}
