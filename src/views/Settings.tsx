import { AnimatePresence, motion } from 'motion/react';
import {
  Building2,
  Check,
  CircleAlert,
  Database,
  Download,
  History,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  User,
  Users,
} from 'lucide-react';
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { Navigate, NavLink, useNavigate, useParams } from 'react-router';
import { useData, dataSnapshot, isDataState, createEmptyData } from '@/lib/store';
import { toast } from '@/lib/ui';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { PLANE_DEFAULTS } from '@/lib/constants';
import { listPlaneProjects, planeReady, syncPlaneProject, type PlaneProjectInfo } from '@/lib/plane';
import { createSampleData } from '@/lib/seed';
import { putFileBlob } from '@/lib/storage';
import { useProjectsList } from '@/lib/selectors';
import { useActor } from '@/lib/members';
import type { Lang, ThemePref } from '@/lib/types';
import { cn, downloadBlob } from '@/lib/utils';
import { Topbar } from '@/components/Topbar';
import { Button } from '@/components/ui/Button';
import { Avatar, Field, PageIcon, Segmented, Switch, TextInput } from '@/components/ui/bits';
import { Dialog, Popover } from '@/components/ui/Overlay';
import { IconPicker } from '@/components/pickers/IconPicker';
import { OptionList } from '@/components/pickers/OptionList';
import { PasswordSettings } from '@/components/AccountStatus';
import { roleLabel } from '@/components/access/AccessControls';
import { useAuth } from '@/lib/auth';
import { PlaneLogo } from '@/components/PlanePanel';
import { ColorDots, H, Note, Row } from './settings/common';
import { PeoplePage } from './settings/People';
import { AuditPage, RolesPage } from './settings/Roles';

type Page = 'account' | 'preferences' | 'general' | 'people' | 'roles' | 'audit' | 'data' | 'plane';
interface NavEntry {
  key: Page;
  label: TKey;
  icon: ReactNode;
}
/** Old addresses keep working. */
const ALIASES: Record<string, Page> = { appearance: 'preferences', workspace: 'general', members: 'people', admin: 'people' };

export default function Settings() {
  const t = useT();
  const { tab } = useParams();
  const mode = useAuth((s) => s.mode);
  const email = useAuth((s) => s.user?.email);
  const me = useData((s) => s.people[s.meId]);
  const actor = useActor();
  const remote = mode === 'signedIn';
  const manager = actor?.role === 'owner' || actor?.role === 'admin';
  const sections: { label: TKey; items: NavEntry[] }[] = [
    {
      label: 'set.section.account',
      items: [
        { key: 'account', label: 'set.nav.account', icon: <User size={16} /> },
        { key: 'preferences', label: 'set.nav.preferences', icon: <SlidersHorizontal size={16} /> },
      ],
    },
    {
      label: 'set.section.workspace',
      items: [
        { key: 'general', label: 'set.nav.general', icon: <Building2 size={16} /> },
        { key: 'people', label: 'set.nav.people', icon: <Users size={16} /> },
        { key: 'roles', label: 'set.nav.roles', icon: <ShieldCheck size={16} /> },
        ...(remote && manager ? [{ key: 'audit' as const, label: 'set.nav.audit' as const, icon: <History size={16} /> }] : []),
        ...(manager ? [{ key: 'data' as const, label: 'set.nav.data' as const, icon: <Database size={16} /> }] : []),
      ],
    },
    ...(manager
      ? [
          {
            label: 'set.section.integrations' as const,
            items: [{ key: 'plane' as const, label: 'settings.plane' as const, icon: <PlaneLogo size={16} /> }],
          },
        ]
      : []),
  ];
  const pages = sections.flatMap((x) => x.items);
  if (tab && ALIASES[tab]) return <Navigate to={`/settings/${ALIASES[tab]}`} replace />;
  const active: Page = pages.some((x) => x.key === tab) ? (tab as Page) : 'account';
  const current = pages.find((x) => x.key === active)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar crumbs={[{ label: t('settings.title'), icon: '⚙️', to: '/settings' }, { label: t(current.label) }]} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label={t('settings.title')}
          className="no-scrollbar flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-3 py-2 md:w-[240px] md:flex-col md:gap-0 md:overflow-y-auto md:border-b-0 md:border-r md:px-2 md:py-3"
        >
          {me && (
            <div className="mb-1 hidden min-w-0 items-center gap-2.5 px-2 py-1.5 md:flex">
              <Avatar person={me} size={24} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-medium">{me.name}</div>
                {(email ?? me.email) && <div className="truncate text-[12px] text-fg-3">{email ?? me.email}</div>}
              </div>
            </div>
          )}
          {sections.map((section) => (
            <Fragment key={section.label}>
              <div className="hidden px-2 pb-1 pt-4 text-[12px] font-medium text-fg-3 md:block">{t(section.label)}</div>
              {section.items.map((x) => (
                <NavLink
                  key={x.key}
                  to={`/settings/${x.key}`}
                  className={cn(
                    'sidebar-row mb-px flex h-[30px] min-w-0 shrink-0 items-center gap-2 rounded-md px-2 text-[14px] md:w-full',
                    active === x.key && 'is-active font-medium',
                  )}
                >
                  <span className="flex w-5 shrink-0 justify-center text-[var(--sb-icon)]">{x.icon}</span>
                  <span className="truncate">{t(x.label)}</span>
                </NavLink>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn('mx-auto px-5 pb-24 pt-10 sm:px-10', active === 'people' || active === 'audit' ? 'max-w-[980px]' : 'max-w-[720px]')}>
            {active === 'account' && <Account />}
            {active === 'preferences' && <Preferences />}
            {active === 'general' && <General editable={manager || !remote} />}
            {active === 'people' && <PeoplePage />}
            {active === 'roles' && <RolesPage />}
            {active === 'audit' && <AuditPage />}
            {active === 'plane' && <PlaneTab />}
            {active === 'data' && <DataTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Account --------------------------------- */

function Account() {
  const t = useT();
  const meId = useData((s) => s.meId);
  const me = useData((s) => s.people[s.meId]);
  const updatePerson = useData((s) => s.updatePerson);
  const email = useAuth((s) => s.user?.email);
  const actor = useActor();
  if (!me) return null;
  return (
    <>
      <H>{t('account.title')}</H>
      <div className="flex items-center gap-5">
        <Avatar person={me} size={64} />
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <Field label={t('settings.name')}>
            <TextInput defaultValue={me.name} onBlur={(e) => e.target.value.trim() && updatePerson(meId, { name: e.target.value.trim() })} />
          </Field>
          <Field label={t('account.jobTitle')}>
            <TextInput
              defaultValue={me.role}
              onBlur={(e) => updatePerson(meId, { role: e.target.value.trim() || undefined })}
              placeholder={t('people.rolePlaceholder')}
            />
          </Field>
        </div>
      </div>
      <div className="mt-6">
        {(email ?? me.email) && (
          <Row label={t('account.email')}>
            <span className="text-[14px] text-fg-2">{email ?? me.email}</span>
          </Row>
        )}
        <Row label={t('account.yourRole')} hint={actor ? t(`role.${actor.role}.desc` as TKey) : undefined}>
          <span className="rounded-md bg-hover px-2 py-1 text-[13px] font-medium">{actor ? t(roleLabel(actor.role)) : '—'}</span>
        </Row>
        <Row label={t('account.color')}>
          <ColorDots value={me.color} onChange={(c) => updatePerson(meId, { color: c })} />
        </Row>
      </div>
      <PasswordSettings />
    </>
  );
}

/* ------------------------------- Preferences ------------------------------- */

function Preferences() {
  const t = useT();
  const lang = useLang();
  const theme = useData((s) => s.prefs.theme);
  const setPrefs = useData((s) => s.setPrefs);
  const options: { value: ThemePref; label: string; icon: ReactNode }[] = [
    { value: 'light', label: t('settings.theme.light'), icon: <Sun size={16} /> },
    { value: 'dark', label: t('settings.theme.dark'), icon: <Moon size={16} /> },
    { value: 'system', label: t('settings.theme.system'), icon: <Monitor size={16} /> },
  ];
  return (
    <>
      <H>{t('set.nav.preferences')}</H>
      <div className="mb-2 text-[14px] font-medium">{t('settings.theme')}</div>
      <div className="grid grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            aria-pressed={theme === o.value}
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
            <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-[13.5px] font-medium">
              <span className="shrink-0">{o.icon}</span>
              <span className="truncate">{o.label}</span>
              {theme === o.value && <Check size={14} className="ml-auto shrink-0 text-accent" />}
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

/* --------------------------------- General --------------------------------- */

function General({ editable }: { editable: boolean }) {
  const t = useT();
  const ws = useData((s) => s.workspace);
  const update = useData((s) => s.updateWorkspace);
  return (
    <>
      <H>{t('set.nav.general')}</H>
      {!editable && <Note className="mb-5">{t('general.readOnly')}</Note>}
      <div className="flex items-end gap-4">
        {editable ? (
          <IconPicker value={ws.icon} onChange={(v) => update({ icon: v ?? '🚀' })} allowRemove={false}>
            <button
              aria-label={t('settings.workspaceIcon')}
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-line-strong hover:bg-hover"
            >
              <PageIcon icon={ws.icon} size={36} />
            </button>
          </IconPicker>
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-line">
            <PageIcon icon={ws.icon} size={36} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <Field label={t('settings.workspaceName')}>
            <TextInput
              key={ws.name}
              disabled={!editable}
              defaultValue={ws.name}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== ws.name && update({ name: e.target.value.trim() })}
            />
          </Field>
        </div>
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
  const remote = useAuth((s) => s.mode === 'signedIn');

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
      <H sub={remote ? t('settings.data.storageServer') : t('settings.data.storage')}>{t('set.nav.data')}</H>
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
