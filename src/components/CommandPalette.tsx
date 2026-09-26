import { Command } from 'cmdk';
import * as RDialog from '@radix-ui/react-dialog';
import {
  CalendarDays,
  ChartGantt,
  FilePlus,
  FolderPlus,
  House,
  ListTodo,
  Keyboard,
  FolderOpen,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  FileText,
  Inbox,
  IterationCw,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useData } from '@/lib/store';
import { useUI } from '@/lib/ui';
import { useT } from '@/lib/i18n';
import { useIsDark } from '@/lib/hooks';
import { blocksToText, matches, modKey } from '@/lib/utils';
import { PageIcon, Kbd } from './ui/bits';
import { StatusIcon, TypeIcon } from './pickers/icons';
import { NodeIcon } from './files/NodeIcon';
import { canCreateProjects } from '@/lib/auth';

export function CommandPalette() {
  const t = useT();
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const projects = useData((s) => s.projects);
  const items = useData((s) => s.items);
  const files = useData((s) => s.files);
  const docs = useData((s) => s.docs);
  const sprints = useData((s) => s.sprints);
  const recent = useData((s) => s.prefs.recent);
  const setPrefs = useData((s) => s.setPrefs);
  const createProject = useData((s) => s.createProject);
  const createDoc = useData((s) => s.createDoc);
  const ui = useUI();
  const isDark = useIsDark();

  const run = (fn: () => void) => {
    setOpen(false);
    setQ('');
    // Let the dialog close before navigating/opening other overlays.
    setTimeout(fn, 10);
  };

  const results = useMemo(() => {
    if (!q.trim()) return null;
    const lim = <T,>(arr: T[], n: number) => arr.slice(0, n);
    return {
      projects: lim(
        Object.values(projects).filter((p) => matches(`${p.name} ${p.summary ?? ''}`, q)),
        5,
      ),
      items: lim(
        Object.values(items).filter((i) => matches(`${i.title} ${i.tags.join(' ')} ${i.plane?.key ?? ''}`, q)),
        8,
      ),
      files: lim(
        Object.values(files).filter((f) => matches(`${f.name} ${f.url ?? ''} ${f.note ?? ''}`, q)),
        6,
      ),
      docs: lim(
        Object.values(docs).filter((d) => matches(`${d.title} ${blocksToText(d.content, 600)}`, q)),
        5,
      ),
      sprints: lim(
        Object.values(sprints).filter((sp) => sp.status !== 'completed' && projects[sp.projectId] && matches(`${sp.name} ${sp.goal ?? ''}`, q)),
        4,
      ),
    };
  }, [q, projects, items, files, docs, sprints]);
  const activeSprints = Object.values(sprints).filter((sp) => sp.status === 'active' && projects[sp.projectId] && !projects[sp.projectId].archived);

  const recentEntries = recent
    .map((r) => {
      if (r.kind === 'project' && projects[r.id]) return { key: r.id, label: projects[r.id].name, icon: projects[r.id].icon, to: `/p/${r.id}` };
      if (r.kind === 'doc' && docs[r.id])
        return { key: r.id, label: docs[r.id].title || t('common.untitled'), icon: docs[r.id].icon ?? '📄', to: `/docs/${r.id}` };
      return null;
    })
    .filter(Boolean)
    .slice(0, 5) as { key: string; label: string; icon: string; to: string }[];

  return (
    <RDialog.Root open={open} onOpenChange={(o) => (setOpen(o), o || setQ(''))}>
      <RDialog.Portal>
        <RDialog.Overlay className="anim-overlay fixed inset-0 z-40 bg-[var(--overlay)]" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]">
          <RDialog.Content className="anim-dialog pointer-events-auto w-full max-w-[620px] overflow-hidden rounded-xl bg-elevated shadow-lg outline-none">
            <RDialog.Title className="sr-only">{t('nav.search')}</RDialog.Title>
            <RDialog.Description className="sr-only">{t('cmd.placeholder')}</RDialog.Description>
            <Command shouldFilter={false} loop className="flex flex-col">
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search size={18} className="text-fg-3" />
                <Command.Input
                  value={q}
                  onValueChange={setQ}
                  placeholder={t('cmd.placeholder')}
                  className="h-[52px] flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-4"
                />
                <Kbd>Esc</Kbd>
              </div>
              <Command.List className="max-h-[420px] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3">
                <Command.Empty className="px-3 py-8 text-center text-[14px] text-fg-3">{t('cmd.noResults')}</Command.Empty>

                {results ? (
                  <>
                    {results.projects.length > 0 && (
                      <Command.Group heading={t('cmd.projects')}>
                        {results.projects.map((p) => (
                          <Row
                            key={p.id}
                            value={`p-${p.id}`}
                            icon={<PageIcon icon={p.icon} size={17} />}
                            onSelect={() => run(() => navigate(`/p/${p.id}/overview`))}
                          >
                            {p.name}
                          </Row>
                        ))}
                      </Command.Group>
                    )}
                    {results.items.length > 0 && (
                      <Command.Group heading={t('cmd.items')}>
                        {results.items.map((i) => (
                          <Row
                            key={i.id}
                            value={`i-${i.id}`}
                            icon={<TypeIcon type={i.type} size={15} />}
                            hint={
                              <span className="flex items-center gap-1.5">
                                <StatusIcon status={i.status} size={12} />
                                {projects[i.projectId]?.name}
                              </span>
                            }
                            onSelect={() => run(() => ui.openPeek(i.id))}
                          >
                            {i.title}
                          </Row>
                        ))}
                      </Command.Group>
                    )}
                    {results.files.length > 0 && (
                      <Command.Group heading={t('cmd.files')}>
                        {results.files.map((f) => (
                          <Row
                            key={f.id}
                            value={`f-${f.id}`}
                            icon={<NodeIcon node={f} size={16} />}
                            hint={f.kind === 'link' ? f.url?.replace(/^https?:\/\//, '').slice(0, 40) : undefined}
                            onSelect={() =>
                              run(() => {
                                if (f.kind === 'link' && f.url) window.open(f.url, '_blank', 'noopener');
                                else
                                  navigate(
                                    `${f.projectId ? `/p/${f.projectId}/files` : '/files'}?folder=${f.kind === 'folder' ? f.id : (f.parentId ?? '')}`,
                                  );
                              })
                            }
                          >
                            {f.name}
                          </Row>
                        ))}
                      </Command.Group>
                    )}
                    {results.sprints.length > 0 && (
                      <Command.Group heading={t('tab.sprints')}>
                        {results.sprints.map((sp) => (
                          <Row
                            key={sp.id}
                            value={`s-${sp.id}`}
                            icon={<IterationCw size={15} />}
                            hint={projects[sp.projectId]?.name}
                            onSelect={() => run(() => navigate(`/p/${sp.projectId}/sprints`))}
                          >
                            {sp.name}
                          </Row>
                        ))}
                      </Command.Group>
                    )}
                    {results.docs.length > 0 && (
                      <Command.Group heading={t('cmd.docs')}>
                        {results.docs.map((d) => (
                          <Row
                            key={d.id}
                            value={`d-${d.id}`}
                            icon={d.icon ? <PageIcon icon={d.icon} size={17} /> : <FileText size={16} />}
                            onSelect={() => run(() => navigate(`/docs/${d.id}`))}
                          >
                            {d.title || t('common.untitled')}
                          </Row>
                        ))}
                      </Command.Group>
                    )}
                  </>
                ) : (
                  recentEntries.length > 0 && (
                    <Command.Group heading={t('home.jumpBack')}>
                      {recentEntries.map((r) => (
                        <Row key={r.key} value={`r-${r.key}`} icon={<PageIcon icon={r.icon} size={17} />} onSelect={() => run(() => navigate(r.to))}>
                          {r.label}
                        </Row>
                      ))}
                    </Command.Group>
                  )
                )}

                {(() => {
                  const actions = [
                    { k: 'new-item', icon: <Plus size={16} />, label: t('cmd.newItem'), sc: 'C', fn: () => ui.openCreateItem() },
                    ...(canCreateProjects()
                      ? [
                          {
                            k: 'new-project',
                            icon: <FolderPlus size={16} />,
                            label: t('cmd.newProject'),
                            fn: () => {
                              const id = createProject({ name: '' });
                              if (id) navigate(`/p/${id}/overview`);
                            },
                          },
                        ]
                      : []),
                    {
                      k: 'new-doc',
                      icon: <FilePlus size={16} />,
                      label: t('cmd.newDoc'),
                      fn: () => {
                        const id = createDoc({});
                        if (id) navigate(`/docs/${id}`);
                      },
                    },
                    {
                      k: 'theme',
                      icon: <Moon size={16} />,
                      label: t('cmd.toggleTheme'),
                      sc: `${modKey()}⇧L`,
                      fn: () => setPrefs({ theme: isDark ? 'light' : 'dark' }),
                    },
                    {
                      k: 'sidebar',
                      icon: <PanelLeft size={16} />,
                      label: t('cmd.toggleSidebar'),
                      sc: `${modKey()}\\`,
                      fn: () => setPrefs({ sidebarCollapsed: !useData.getState().prefs.sidebarCollapsed }),
                    },
                    { k: 'shortcuts', icon: <Keyboard size={16} />, label: t('cmd.shortcuts'), sc: '?', fn: () => ui.setShortcuts(true) },
                  ].filter((a) => !q || matches(a.label, q));
                  return actions.length ? (
                    <Command.Group heading={t('cmd.actions')}>
                      {actions.map((a) => (
                        <Row key={a.k} value={a.k} icon={a.icon} shortcut={a.sc} onSelect={() => run(a.fn)}>
                          {a.label}
                        </Row>
                      ))}
                    </Command.Group>
                  ) : null;
                })()}

                {(() => {
                  const nav: { k: string; icon: ReactNode; label: string; to: string; sc?: string }[] = [
                    { k: 'inbox', icon: <Inbox size={16} />, label: t('nav.inbox'), to: '/inbox', sc: 'G I' },
                    { k: 'my-work', icon: <ListTodo size={16} />, label: t('nav.myWork'), to: '/my-work', sc: 'G M' },
                    { k: 'home', icon: <House size={16} />, label: t('nav.home'), to: '/', sc: 'G H' },
                    ...activeSprints.map((sp) => ({
                      k: `sprint-${sp.id}`,
                      icon: <IterationCw size={16} />,
                      label: `${sp.name} · ${projects[sp.projectId].name}`,
                      to: `/p/${sp.projectId}/sprints`,
                    })),
                    { k: 'cal', icon: <CalendarDays size={16} />, label: t('nav.calendar'), to: '/calendar', sc: 'G C' },
                    { k: 'road', icon: <ChartGantt size={16} />, label: t('nav.roadmap'), to: '/roadmap', sc: 'G R' },
                    { k: 'files', icon: <FolderOpen size={16} />, label: t('nav.files'), to: '/files', sc: 'G F' },
                    { k: 'set', icon: <Settings size={16} />, label: t('nav.settings'), to: '/settings' },
                  ].filter((a) => !q || matches(a.label, q));
                  return nav.length ? (
                    <Command.Group heading={t('cmd.navigation')}>
                      {nav.map((a) => (
                        <Row key={a.k} value={`nav-${a.k}`} icon={a.icon} shortcut={a.sc} onSelect={() => run(() => navigate(a.to))}>
                          {t('cmd.go', { name: a.label })}
                        </Row>
                      ))}
                    </Command.Group>
                  ) : null;
                })()}
              </Command.List>
            </Command>
          </RDialog.Content>
        </div>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function Row({
  value,
  icon,
  children,
  onSelect,
  hint,
  shortcut,
}: {
  value: string;
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  hint?: ReactNode;
  shortcut?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[14px] text-fg data-[selected=true]:bg-hover"
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-fg-2">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 truncate text-[12.5px] text-fg-3">{hint}</span>}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </Command.Item>
  );
}
