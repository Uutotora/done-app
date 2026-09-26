import { useEffect } from 'react';
import { translate, useT } from '@/lib/i18n';
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useHotkey, useIsDark } from '@/lib/hooks';
import { reportPresence, useAuth } from '@/lib/auth';
import { notificationHeadline, notificationTarget, unreadCount } from '@/lib/inbox';
import { toast } from '@/lib/ui';
import { isEditableTarget } from '@/lib/utils';
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
      useUI.setState({ sidebarPeek: false });
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
  useGoTo();

  useInboxSignals();

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

/** Unread count in the tab title, and a toast when a teammate's update arrives live. */
function useInboxSignals() {
  const navigate = useNavigate();
  const unread = useData(unreadCount);
  useEffect(() => {
    document.title = unread ? `(${unread}) Done` : 'Done';
  }, [unread]);
  useEffect(() => {
    const mine = (s: ReturnType<typeof useData.getState>) =>
      Object.values(s.notifications).filter((n) => n.recipientId === s.meId && !n.readAt && !n.archivedAt);
    let known = new Set(mine(useData.getState()).map((n) => n.id));
    return useData.subscribe((s) => {
      const current = mine(s);
      const fresh = current.filter((n) => !known.has(n.id));
      known = new Set(current.map((n) => n.id));
      if (!fresh.length || useAuth.getState().mode !== 'signedIn') return;
      const n = fresh.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const lang = s.prefs.lang;
      const target = notificationTarget(n, s, lang);
      toast({
        message: `${s.people[n.actorId]?.name ?? ''}: ${notificationHeadline(n, lang)} · ${target.title}`,
        duration: 6000,
        action: {
          label: translate(lang, 'inbox.open'),
          run: () => {
            useData.getState().markNotifications([n.id], true);
            if (target.peekItemId) useUI.getState().openPeek(target.peekItemId);
            else navigate(target.path);
          },
        },
      });
    });
  }, [navigate]);
}

/** Two-key navigation like Linear: G then I opens the inbox, G then M my tasks, and so on. */
const GO_TO: Record<string, string> = { i: '/inbox', m: '/my-work', h: '/', c: '/calendar', r: '/roadmap', f: '/files', s: '/settings' };
function useGoTo() {
  const navigate = useNavigate();
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isEditableTarget(e.target)) return;
      if (document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      const key = e.key.toLowerCase();
      if (armed && Date.now() - armed < 1200 && GO_TO[key]) {
        e.preventDefault();
        armed = 0;
        navigate(GO_TO[key]);
        return;
      }
      armed = key === 'g' ? Date.now() : 0;
    };
    // Capture phase, so "G C" is not also read as the "C" (new task) shortcut.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [navigate]);
}
