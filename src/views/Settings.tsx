import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CircleAlert,
  Database,
  Download,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Sun,
  Trash2,
  Upload,
  User,
  Users,
  Building2,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useData, dataSnapshot, isDataState, createEmptyData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { COLORS, PLANE_DEFAULTS } from '@/lib/constants';
import { listPlaneProjects, planeReady, syncPlaneProject, type PlaneProjectInfo } from '@/lib/plane';
import { createSampleData } from '@/lib/seed';
import { putFileBlob } from '@/lib/storage';
import { useProjectsList } from '@/lib/selectors';
import type { ColorName, ID, Lang, ThemePref } from '@/lib/types';
import { cn, downloadBlob } from '@/lib/utils';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/ui/Button';
import { Avatar, Field, PageIcon, Segmented, Switch, TextInput } from '@/components/ui/bits';
import { Dialog, Popover } from '@/components/ui/Overlay';
import { IconPicker } from '@/components/pickers/IconPicker';
import { OptionList } from '@/components/pickers/OptionList';
import { PlaneLogo } from '@/components/PlanePanel';

type Tab = 'account' | 'workspace' | 'members' | 'appearance' | 'plane' | 'data';
const TABS: { key: Tab; label: TKey; icon: ReactNode }[] = [
  { key: 'account', label: 'settings.account', icon: <User size={16} /> },
  { key: 'workspace', label: 'settings.workspace', icon: <Building2 size={16} /> },
  { key: 'members', label: 'settings.members', icon: <Users size={16} /> },
  { key: 'appearance', label: 'settings.appearance', icon: <Palette size={16} /> },
  { key: 'plane', label: 'settings.plane', icon: <PlaneLogo size={16} /> },
  { key: 'data', label: 'settings.data', icon: <Database size={16} /> },
];

export default function Settings() {
  const t = useT();
  const { tab } = useParams();
  const active: Tab = TABS.some((x) => x.key === tab) ? (tab as Tab) : 'account';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar crumbs={[{ label: t('settings.title'), icon: '⚙️' }]} />
      <div className="flex min-h-0 flex-1">
        <nav className="w-[240px] shrink-0 overflow-y-auto border-r border-line px-3 py-6">
          <div className="mb-2 px-2 text-[12px] font-medium text-fg-3">{t('settings.title')}</div>
          {TABS.map((x) => (
            <NavLink
              key={x.key}
              to={`/settings/${x.key}`}
              className={cn(
                'flex h-[30px] items-center gap-2 rounded-md px-2 text-[14px] transition-colors',
                active === x.key ? 'bg-active font-medium text-fg' : 'text-fg-2 hover:bg-hover',
              )}
            >
              <span className="flex w-5 justify-center text-fg-3">{x.icon}</span>
              {t(x.label)}
            </NavLink>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="mx-auto max-w-[720px] px-10 pb-24 pt-10"
            >
              {active === 'account' && <Account />}
              {active === 'workspace' && <WorkspaceTab />}
              {active === 'members' && <Members />}
              {active === 'appearance' && <Appearance />}
              {active === 'plane' && <PlaneTab />}
              {active === 'data' && <DataTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function H({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6 border-b border-line pb-4">
      <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{children}</h1>
      {sub && <p className="mt-1.5 max-w-[560px] text-[14px] leading-relaxed text-fg-3">{sub}</p>}
    </div>
  );
}

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-fg-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ColorDots({ value, onChange }: { value: ColorName; onChange: (c: ColorName) => void }) {
  return (
    <div className="flex gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          data-color={c}
          onClick={() => onChange(c)}
          aria-label={c}
          className={cn(
            'tint-solid h-5 w-5 rounded-full transition-transform hover:scale-110',
            value === c && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg)]',
          )}
        />
      ))}
    </div>
  );
}

/* --------------------------------- Account --------------------------------- */

function Account() {
  const t = useT();
  const meId = useData((s) => s.meId);
  const me = useData((s) => s.people[s.meId]);
  const updatePerson = useData((s) => s.updatePerson);
  if (!me) return null;
  return (
    <>
      <H>{t('settings.account')}</H>
      <div className="mb-6 flex items-center gap-4">
        <Avatar person={me} size={64} />
        <div className="flex-1 space-y-3">
          <Field label={t('settings.name')}>
            <TextInput defaultValue={me.name} onBlur={(e) => e.target.value.trim() && updatePerson(meId, { name: e.target.value.trim() })} />
          </Field>
        </div>
      </div>
      <Field label={t('settings.role')}>
        <TextInput
          defaultValue={me.role}
          onBlur={(e) => updatePerson(meId, { role: e.target.value.trim() || undefined })}
          placeholder={t('people.rolePlaceholder')}
        />
      </Field>
      <div className="mt-5">
        <div className="mb-1.5 text-[13px] font-medium text-fg-2">{t('people.color')}</div>
        <ColorDots value={me.color} onChange={(c) => updatePerson(meId, { color: c })} />
      </div>
    </>
  );
}

/* -------------------------------- Workspace -------------------------------- */

function WorkspaceTab() {
  const t = useT();
  const ws = useData((s) => s.workspace);
  const update = useData((s) => s.updateWorkspace);
  return (
    <>
      <H>{t('settings.workspace')}</H>
      <div className="flex items-end gap-3">
        <IconPicker value={ws.icon} onChange={(v) => update({ icon: v ?? '🚀' })} allowRemove={false}>
          <button className="flex h-16 w-16 items-center justify-center rounded-xl border border-line-strong hover:bg-hover">
            <PageIcon icon={ws.icon} size={36} />
          </button>
        </IconPicker>
        <div className="flex-1">
          <Field label={t('settings.workspaceName')}>
            <TextInput defaultValue={ws.name} onBlur={(e) => e.target.value.trim() && update({ name: e.target.value.trim() })} />
          </Field>
        </div>
      </div>
    </>
  );
}

/* --------------------------------- Members --------------------------------- */

function Members() {
  const t = useT();
  const people = useData((s) => s.people);
  const meId = useData((s) => s.meId);
  const items = useData((s) => s.items);
  const addPerson = useData((s) => s.addPerson);
  const updatePerson = useData((s) => s.updatePerson);
  const removePerson = useData((s) => s.removePerson);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const list = useMemo(
    () => Object.values(people).sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.name.localeCompare(b.name))),
    [people, meId],
  );
  const counts = useMemo(() => {
    const c: Record<ID, number> = {};
    for (const it of Object.values(items))
      if (it.assigneeId && it.status !== 'done' && it.status !== 'canceled') c[it.assigneeId] = (c[it.assigneeId] ?? 0) + 1;
    return c;
  }, [items]);
  const submit = () => {
    if (!name.trim()) return;
    addPerson({ name: name.trim(), role: role.trim() || undefined, color: COLORS[(list.length + 3) % COLORS.length] });
    setName('');
    setRole('');
    setAdding(false);
  };
  return (
    <>
      <H>{t('people.title')}</H>
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
          {t('people.add')}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        <AnimatePresence initial={false}>
          {list.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              className="group flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <Popover
                trigger={
                  <button className="rounded-full">
                    <Avatar person={p} size={32} />
                  </button>
                }
              >
                <div className="p-3">
                  <div className="mb-2 text-[12px] font-medium text-fg-3">{t('people.color')}</div>
                  <ColorDots value={p.color} onChange={(c) => updatePerson(p.id, { color: c })} />
                </div>
              </Popover>
              <div className="min-w-0 flex-1">
                <input
                  defaultValue={p.name}
                  onBlur={(e) => e.target.value.trim() && updatePerson(p.id, { name: e.target.value.trim() })}
                  className="w-full rounded bg-transparent text-[14px] font-medium outline-none focus:bg-hover"
                />
                <input
                  defaultValue={p.role}
                  placeholder={t('people.rolePlaceholder')}
                  onBlur={(e) => updatePerson(p.id, { role: e.target.value.trim() || undefined })}
                  className="w-full rounded bg-transparent text-[13px] text-fg-3 outline-none placeholder:text-fg-4 focus:bg-hover"
                />
              </div>
              {p.id === meId && <span className="rounded bg-hover px-1.5 py-0.5 text-[11.5px] font-medium text-fg-3">{t('settings.you')}</span>}
              <span className="w-[80px] text-right text-[12.5px] text-fg-3">{t('people.assigned', { n: counts[p.id] ?? 0 })}</span>
              {p.id !== meId ? (
                <button
                  onClick={() => {
                    removePerson(p.id);
                    toast({ message: t('people.removed') });
                  }}
                  aria-label={t('people.remove')}
                  className="rounded p-1.5 text-fg-4 opacity-0 transition-opacity hover:bg-[var(--c-red-bg)] hover:text-[var(--c-red-text)] group-hover:opacity-100"
                >
                  <Trash2 size={15} />
                </button>
              ) : (
                <span className="w-[27px]" />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <Dialog open={adding} onOpenChange={setAdding} className="max-w-[420px]" title={t('people.add')}>
        <form
          className="p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="mb-4 text-[16px] font-semibold">{t('people.add')}</div>
          <div className="space-y-3">
            <Field label={t('settings.name')}>
              <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('people.namePlaceholder')} />
            </Field>
            <Field label={t('settings.role')}>
              <TextInput value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('people.rolePlaceholder')} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              {t('common.add')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/* -------------------------------- Appearance ------------------------------- */

function Appearance() {
  const t = useT();
  const lang = useLang();
  const theme = useData((s) => s.prefs.theme);
  const setPrefs = useData((s) => s.setPrefs);
  const options: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: 'light', label: t('settings.theme.light'), icon: <Sun size={18} /> },
    { value: 'dark', label: t('settings.theme.dark'), icon: <Moon size={18} /> },
    { value: 'system', label: t('settings.theme.system'), icon: <Monitor size={18} /> },
  ];
  return (
    <>
      <H>{t('settings.appearance')}</H>
      <div className="mb-2 text-[14px] font-medium">{t('settings.theme')}</div>
      <div className="grid grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => setPrefs({ theme: o.value })}
            className={cn(
              'overflow-hidden rounded-xl border-2 text-left transition-colors',
              theme === o.value ? 'border-accent' : 'border-line hover:border-line-strong',
            )}
          >
            <div
              className={cn(
                'flex h-20 items-end gap-1.5 p-2.5',
                o.value === 'dark'
                  ? 'bg-[#191919]'
                  : o.value === 'light'
                    ? 'bg-[#f7f7f5]'
                    : 'bg-gradient-to-r from-[#f7f7f5] from-50% to-[#191919] to-50%',
              )}
            >
              <div className={cn('h-full w-1/3 rounded-md', o.value === 'dark' ? 'bg-[#252525]' : 'bg-white shadow-sm')} />
              <div className="flex h-full flex-1 flex-col gap-1.5 pt-1">
                <div className={cn('h-2 w-3/4 rounded', o.value === 'dark' ? 'bg-white/20' : 'bg-black/10')} />
                <div className={cn('h-2 w-1/2 rounded', o.value === 'dark' ? 'bg-white/10' : 'bg-black/5')} />
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 text-[13.5px] font-medium">
              {o.icon}
              {o.label}
              {theme === o.value && <Check size={14} className="ml-auto text-accent" />}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-6">
        <Row label={t('settings.language')}>
          <Segmented
            value={lang}
            onChange={(v: Lang) => setPrefs({ lang: v })}
            options={[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Row>
      </div>
    </>
  );
}

/* ---------------------------------- Plane ---------------------------------- */

function PlaneTab() {
  const t = useT();
  const cfg = useData((s) => s.plane.config);
  const setCfg = useData((s) => s.setPlaneConfig);
  const projects = useProjectsList();
  const updateProject = useData((s) => s.updateProject);
  const setSnapshot = useData((s) => s.setPlaneSnapshot);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [planeProjects, setPlaneProjects] = useState<PlaneProjectInfo[] | null>(null);

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const list = await listPlaneProjects(useData.getState().plane.config);
      setPlaneProjects(list);
      setStatus({ ok: true, text: t('settings.plane.ok', { n: list.length }) });
    } catch (e) {
      setStatus({ ok: false, text: t('settings.plane.fail', { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <H sub={t('settings.plane.intro')}>
        <span className="flex items-center gap-2.5">
          <PlaneLogo size={22} /> Plane
        </span>
      </H>
      <div className="space-y-4">
        <Field label={t('settings.plane.baseUrl')} hint={t('settings.plane.baseUrlHint')}>
          <TextInput
            defaultValue={cfg.baseUrl}
            placeholder={PLANE_DEFAULTS.baseUrl}
            onBlur={(e) => setCfg({ baseUrl: e.target.value.trim() || PLANE_DEFAULTS.baseUrl })}
          />
        </Field>
        <Field label={t('settings.plane.webUrl')} hint={t('settings.plane.webUrlHint')}>
          <TextInput
            defaultValue={cfg.webUrl}
            placeholder={PLANE_DEFAULTS.webUrl}
            onBlur={(e) => setCfg({ webUrl: e.target.value.trim() || PLANE_DEFAULTS.webUrl })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('settings.plane.slug')} hint={t('settings.plane.slugHint')}>
            <TextInput defaultValue={cfg.workspaceSlug} placeholder="acme" onBlur={(e) => setCfg({ workspaceSlug: e.target.value.trim() })} />
          </Field>
          <Field label={t('settings.plane.apiKey')} hint={t('settings.plane.apiKeyHint')}>
            <TextInput
              type="password"
              autoComplete="off"
              defaultValue={cfg.apiKey}
              placeholder="plane_api_..."
              onBlur={(e) => setCfg({ apiKey: e.target.value.trim() })}
            />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" loading={testing} onClick={test} icon={<RefreshCw size={14} />}>
          {testing ? t('settings.plane.testing') : t('settings.plane.test')}
        </Button>
        <AnimatePresence>
          {status && (
            <motion.span
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className={cn('flex items-center gap-1.5 text-[13.5px]', status.ok ? 'text-[var(--c-green-text)]' : 'text-[var(--c-red-text)]')}
            >
              {status.ok ? <Check size={15} /> : <CircleAlert size={15} />}
              {status.text}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2 text-[12.5px] text-fg-4">{t('settings.plane.proxyNote')}</div>

      <div className="mt-8">
        <Row label={t('settings.plane.autoStatus')} hint={t('settings.plane.autoStatusHint')}>
          <Switch checked={cfg.autoStatus} onChange={(v) => setCfg({ autoStatus: v })} />
        </Row>
      </div>

      <div className="mt-8">
        <div className="mb-1 text-[16px] font-semibold">{t('settings.plane.mapping')}</div>
        <div className="mb-3 text-[13px] text-fg-3">{t('settings.plane.mappingHint')}</div>
        <div className="overflow-hidden rounded-xl border border-line">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
              <PageIcon icon={p.icon} size={18} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.name}</span>
              <Popover
                align="end"
                trigger={
                  <button
                    onClick={() => !planeProjects && planeReady(cfg) && void test()}
                    className="flex h-8 max-w-[260px] items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[13px] text-fg-2 hover:bg-hover"
                  >
                    {p.plane ? (
                      <>
                        <span className="font-mono text-[12px] font-medium">{p.plane.identifier}</span>
                        <span className="truncate">{p.plane.name}</span>
                      </>
                    ) : (
                      <span className="text-fg-3">{t('settings.plane.notLinked')}</span>
                    )}
                  </button>
                }
              >
                {planeProjects ? (
                  <OptionList
                    options={[
                      { value: '', label: t('settings.plane.notLinked') },
                      ...planeProjects.map((pp) => ({ value: pp.id, label: pp.name, hint: pp.identifier })),
                    ]}
                    selected={p.plane?.projectId ?? ''}
                    onSelect={(v) => {
                      const pp = planeProjects.find((x) => x.id === v);
                      updateProject(p.id, { plane: pp ? { projectId: pp.id, identifier: pp.identifier, name: pp.name } : undefined });
                      setSnapshot(p.id, undefined);
                      if (pp) void syncPlaneProject(p.id).then((r) => toast({ message: r.message, tone: r.ok ? 'success' : 'error' }));
                    }}
                  />
                ) : (
                  <div className="w-[260px] p-3 text-[13px] text-fg-3">{planeReady(cfg) ? t('common.loading') : t('plane.notConfigured')}</div>
                )}
              </Popover>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ----------------------------------- Data ---------------------------------- */

function DataTab() {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const replaceAll = useData((s) => s.replaceAll);
  const me = useData((s) => s.people[s.meId]);
  const workspace = useData((s) => s.workspace);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<null | 'reset' | 'sample'>(null);

  const exportJson = () => {
    const data = dataSnapshot();
    // Secrets stay in this browser.
    const safe = { ...data, plane: { ...data.plane, config: { ...data.plane.config, apiKey: '' } } };
    downloadBlob(new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' }), `done-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as unknown;
      if (!isDataState(data)) throw new Error('invalid');
      replaceAll({ ...data, onboarded: true });
      toast({ message: t('settings.data.imported'), tone: 'success' });
      navigate('/');
    } catch {
      toast({ message: t('settings.data.importFailed'), tone: 'error' });
    }
  };

  const apply = () => {
    if (confirm === 'sample') {
      const { data, blobs } = createSampleData({ lang, name: me?.name ?? '', role: me?.role ?? '', workspaceName: workspace.name });
      data.prefs.theme = useData.getState().prefs.theme;
      replaceAll(data);
      void Promise.all(blobs.map(([id, blob]) => putFileBlob(id, blob)));
    } else if (confirm === 'reset') {
      const fresh = createEmptyData(lang);
      replaceAll(fresh);
    }
    setConfirm(null);
    navigate('/');
  };

  return (
    <>
      <H sub={t('settings.data.storage')}>{t('settings.data')}</H>
      <Row label={t('settings.data.export')} hint={t('settings.data.exportHint')}>
        <Button icon={<Download size={14} />} onClick={exportJson}>
          {t('settings.data.export')}
        </Button>
      </Row>
      <Row label={t('settings.data.import')} hint={t('settings.data.importHint')}>
        <Button icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
          {t('settings.data.import')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
      </Row>
      <Row label={t('settings.data.sample')} hint={t('settings.data.sampleHint')}>
        <Button onClick={() => setConfirm('sample')}>{t('settings.data.sample')}</Button>
      </Row>
      <Row label={t('settings.data.reset')} hint={t('settings.data.resetHint')}>
        <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirm('reset')}>
          {t('settings.data.reset')}
        </Button>
      </Row>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} className="max-w-[420px]" title={t('settings.data')}>
        <div className="p-5">
          <div className="text-[15px] font-semibold">{confirm === 'reset' ? t('settings.data.reset') : t('settings.data.sample')}</div>
          <p className="mt-2 text-[14px] text-fg-2">{confirm === 'reset' ? t('settings.data.resetConfirm') : t('settings.data.sampleHint')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant={confirm === 'reset' ? 'danger' : 'primary'} onClick={apply}>
              {t('common.apply')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
