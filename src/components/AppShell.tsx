import { useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { Outlet, useLocation, useMatch } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useHotkey, useIsDark } from '@/lib/hooks';
import { reportPresence } from '@/lib/auth';
import { SyncNotice } from './AccountStatus';
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
  const t = useT();
  useEffect(() => {
    useUI.getState().openPeek(undefined);
    const timer = setTimeout(() => reportPresence(location.pathname), 300);
    return () => clearTimeout(timer);
  }, [location.pathname]);
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
      <a href="#main-content" className="skip-link">
        {t('nav.skip')}
      </a>
      <Sidebar />
      <main id="main-content" tabIndex={-1} className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <SyncNotice />
        <>
          <div key={sectionKey} className="flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
        </>
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
