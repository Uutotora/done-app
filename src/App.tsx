import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { MotionConfig } from 'motion/react';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { detectLang } from '@/lib/i18n';
import { collectGarbageBlobs } from '@/lib/storage';
import { TooltipProvider } from '@/components/ui/Overlay';
import { AppShell } from '@/components/AppShell';
import { Onboarding } from '@/views/Onboarding';
import { Splash } from '@/components/Logo';
import { Home } from '@/views/Home';
import { ProjectLayout } from '@/views/project/ProjectLayout';
import { Overview } from '@/views/project/Overview';
import { RoadmapView } from '@/views/Roadmap';
import { BacklogView } from '@/views/Backlog';
import { BoardView } from '@/views/Board';
import { CalendarView } from '@/views/Calendar';
import { DocsView } from '@/views/Docs';
import { FilesView } from '@/views/Files';
import { NotFound } from '@/views/NotFound';

const MapView = lazy(() => import('@/views/ProjectMap'));
const DocPage = lazy(() => import('@/views/DocPage'));
const ItemPage = lazy(() => import('@/views/ItemPage'));
const Settings = lazy(() => import('@/views/Settings'));

function useHydration() {
  const hydrated = useUI((s) => s.hydrated);
  useEffect(() => {
    const done = () => {
      const s = useData.getState();
      if (!s.onboarded) s.setPrefs({ lang: detectLang() });
      s.pruneTrash();
      useUI.setState({ hydrated: true });
      // Drop blobs of files deleted in earlier sessions (after the undo window).
      void collectGarbageBlobs(new Set(Object.keys(useData.getState().files))).catch(() => undefined);
    };
    if (useData.persist.hasHydrated()) done();
    const unsub = useData.persist.onFinishHydration(done);
    return unsub;
  }, []);
  return hydrated;
}

function useTheme() {
  const theme = useData((s) => s.prefs.theme);
  const lang = useData((s) => s.prefs.lang);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && systemDark);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191919' : '#ffffff');
    try {
      localStorage.setItem('done:theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme, systemDark]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
}

export function App() {
  const hydrated = useHydration();
  const onboarded = useData((s) => s.onboarded);
  useTheme();

  if (!hydrated) return <Splash />;

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        {!onboarded ? (
          <Onboarding />
        ) : (
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Home />} />
                <Route path="calendar" element={<CalendarView />} />
                <Route path="roadmap" element={<RoadmapView />} />
                <Route path="files" element={<FilesView />} />
                <Route path="docs/:docId" element={<Lazy el={<DocPage />} />} />
                <Route path="items/:itemId" element={<Lazy el={<ItemPage />} />} />
                <Route path="settings/:tab?" element={<Lazy el={<Settings />} />} />
                <Route path="p/:projectId" element={<ProjectLayout />}>
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview" element={<Overview />} />
                  <Route path="roadmap" element={<RoadmapView />} />
                  <Route path="backlog" element={<BacklogView />} />
                  <Route path="board" element={<BoardView />} />
                  <Route path="calendar" element={<CalendarView />} />
                  <Route path="map" element={<Lazy el={<MapView />} />} />
                  <Route path="docs" element={<DocsView />} />
                  <Route path="files" element={<FilesView />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        )}
      </TooltipProvider>
    </MotionConfig>
  );
}

function Lazy({ el }: { el: React.ReactNode }) {
  return <Suspense fallback={<div className="p-24" />}>{el}</Suspense>;
}
