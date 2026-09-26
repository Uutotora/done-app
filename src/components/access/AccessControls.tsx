import { Check, ChevronDown, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useT, type TKey } from '@/lib/i18n';
import { useProjectsList } from '@/lib/selectors';
import { EMAIL_RE, ROLE_ORDER, canAssignRole, type AccessInput } from '@/lib/members';
import type { AccessLevel, AccessRole, ProjectLevel } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageIcon, Switch } from '@/components/ui/bits';
import { Popover } from '@/components/ui/Overlay';

export const roleLabel = (role: AccessRole): TKey => `role.${role}` as TKey;
export const levelLabel = (level: AccessLevel | 'none'): TKey => `level.${level}` as TKey;

/** Role picker with a description under each role, like Notion's member role menu. */
export function RoleSelect({
  value,
  onChange,
  actor,
  disabled,
  className,
}: {
  value: AccessRole;
  onChange: (role: AccessRole) => void;
  actor: { role: AccessRole } | null;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (disabled) return <span className={cn('px-2 text-[13.5px] text-fg-2', className)}>{t(roleLabel(value))}</span>;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      trigger={
        <button
          aria-label={t('people.col.role')}
          className={cn(
            'flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-[13.5px] text-fg-2 transition-colors hover:bg-hover data-[state=open]:bg-hover',
            className,
          )}
        >
          <span className="truncate">{t(roleLabel(value))}</span>
          <ChevronDown size={13} className="shrink-0 text-fg-3" />
        </button>
      }
    >
      <div role="listbox" className="w-[300px] p-1">
        {ROLE_ORDER.map((role) => {
          const allowed = canAssignRole(actor, role);
          return (
            <button
              key={role}
              role="option"
              aria-selected={value === role}
              disabled={!allowed}
              onClick={() => {
                onChange(role);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left enabled:hover:bg-hover disabled:opacity-45"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{t(roleLabel(role))}</span>
                <span className="block text-[12.5px] leading-snug text-fg-3">{allowed ? t(`role.${role}.desc` as TKey) : t('role.onlyOwner')}</span>
              </span>
              {value === role && <Check size={15} className="mt-0.5 shrink-0 text-fg-2" />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

/** "Can edit / comment / view" for one project, with an optional way to remove access. */
export function LevelSelect({
  value,
  onChange,
  allowEdit = true,
  onRemove,
  disabled,
  defaultLabel,
}: {
  value: ProjectLevel | undefined;
  onChange: (level: ProjectLevel | undefined) => void;
  allowEdit?: boolean;
  onRemove?: () => void;
  disabled?: boolean;
  /** When set, `undefined` means "same as the role" and is offered as the first option. */
  defaultLabel?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = value ? t(levelLabel(value)) : (defaultLabel ?? t(levelLabel('editor')));
  if (disabled) return <span className="px-2 text-[13px] text-fg-3">{label}</span>;
  const options: (ProjectLevel | undefined)[] = [
    ...(defaultLabel ? [undefined] : []),
    ...(allowEdit ? (['editor'] as const) : []),
    'commenter',
    'viewer',
  ];
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <button className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] text-fg-2 transition-colors hover:bg-hover data-[state=open]:bg-hover">
          {label}
          <ChevronDown size={13} className="text-fg-3" />
        </button>
      }
    >
      <div className="w-[220px] p-1">
        {options.map((level) => (
          <button
            key={level ?? 'default'}
            onClick={() => {
              onChange(level);
              setOpen(false);
            }}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[14px] hover:bg-hover"
          >
            <span className="flex-1">{level ? t(levelLabel(level)) : defaultLabel}</span>
            {value === level && <Check size={15} className="text-fg-2" />}
          </button>
        ))}
        {onRemove && (
          <>
            <div className="mx-1 my-1 h-px bg-line" />
            <button
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
              className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[14px] text-[var(--c-red-text)] hover:bg-[var(--c-red-bg)]"
            >
              {t('share.remove')}
            </button>
          </>
        )}
      </div>
    </Popover>
  );
}

/** Role cards, project scope and per-project levels: shared by invitations and member access. */
export function AccessEditor({
  value,
  onChange,
  actor,
}: {
  value: AccessInput;
  onChange: (v: AccessInput) => void;
  actor: { role: AccessRole } | null;
}) {
  const t = useT();
  const projects = useProjectsList();
  const admin = value.role === 'owner' || value.role === 'admin';
  const baseLabel = value.role === 'viewer' ? t('level.viewer') : t('level.editor');
  const setLevel = (id: string, level: ProjectLevel | undefined) => {
    const projectRoles = { ...value.projectRoles };
    if (level) projectRoles[id] = level;
    else delete projectRoles[id];
    onChange({ ...value, projectRoles });
  };
  return (
    <div className="space-y-5">
      <Block label={t('invite.role')}>
        <div role="radiogroup" className="grid gap-1.5 sm:grid-cols-2">
          {ROLE_ORDER.map((role) => {
            const allowed = canAssignRole(actor, role);
            return (
              <button
                key={role}
                type="button"
                role="radio"
                aria-checked={value.role === role}
                disabled={!allowed}
                onClick={() => onChange({ ...value, role, canCreateProjects: role === 'viewer' ? false : value.canCreateProjects })}
                className={cn(
                  'flex flex-col items-start justify-start rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-45',
                  value.role === role ? 'border-accent bg-accent-soft' : 'border-line enabled:hover:bg-hover',
                )}
              >
                <span className="block text-[14px] font-medium">{t(roleLabel(role))}</span>
                <span className="block text-[12px] leading-snug text-fg-3">{allowed ? t(`role.${role}.desc` as TKey) : t('role.onlyOwner')}</span>
              </button>
            );
          })}
        </div>
      </Block>

      <Block label={t('invite.access')}>
        {admin ? (
          <p className="rounded-lg bg-subtle px-3 py-2.5 text-[13px] text-fg-3">{t('invite.adminAccess')}</p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {([true, false] as const).map((all) => (
                <button
                  key={String(all)}
                  type="button"
                  aria-pressed={(value.projectIds === null) === all}
                  onClick={() => onChange({ ...value, projectIds: all ? null : (value.projectIds ?? []) })}
                  className={cn(
                    'h-8 rounded-md border px-3 text-[13px] transition-colors',
                    (value.projectIds === null) === all ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:bg-hover',
                  )}
                >
                  {all ? t('invite.accessAll') : t('invite.accessSelected')}
                </button>
              ))}
            </div>
            <div className="max-h-[240px] overflow-y-auto rounded-lg border border-line">
              {projects.length === 0 && <div className="px-3 py-3 text-[13px] text-fg-3">{t('people.noProjects')}</div>}
              {projects.map((p) => {
                const selected = value.projectIds === null || value.projectIds.includes(p.id);
                return (
                  <div key={p.id} className="flex h-10 items-center gap-2.5 border-b border-line px-3 last:border-b-0">
                    {value.projectIds !== null && (
                      <input
                        type="checkbox"
                        aria-label={p.name}
                        checked={selected}
                        onChange={(e) => {
                          const ids = value.projectIds ?? [];
                          onChange({ ...value, projectIds: e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id) });
                        }}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    )}
                    <PageIcon icon={p.icon} size={16} />
                    <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', !selected && 'text-fg-3')}>{p.name || t('project.untitled')}</span>
                    {selected && (
                      <LevelSelect
                        value={value.projectRoles[p.id]}
                        onChange={(level) => setLevel(p.id, level)}
                        allowEdit={value.role !== 'viewer'}
                        defaultLabel={baseLabel}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Block>

      {value.role === 'editor' && (
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5">
          <span>
            <span className="block text-[14px] font-medium">{t('people.canCreate')}</span>
            <span className="block text-[12.5px] text-fg-3">{t('people.canCreateHint')}</span>
          </span>
          <Switch checked={value.canCreateProjects} onChange={(v) => onChange({ ...value, canCreateProjects: v })} label={t('people.canCreate')} />
        </label>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-medium text-fg-2">{label}</div>
      {children}
    </div>
  );
}

/** Email field that turns each address into a chip; pasting a list works too. */
export function EmailsInput({ emails, onChange, autoFocus }: { emails: string[]; onChange: (emails: string[]) => void; autoFocus?: boolean }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const commit = (text: string) => {
    const parts = text
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...emails, ...parts])]);
    setDraft('');
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong px-2 py-1.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
      {emails.map((email) => {
        const valid = EMAIL_RE.test(email);
        return (
          <span
            key={email}
            className={cn(
              'flex h-6 items-center gap-1 rounded-md pl-2 pr-1 text-[13px]',
              valid ? 'bg-hover text-fg' : 'bg-[var(--c-red-bg)] text-[var(--c-red-text)]',
            )}
          >
            {email}
            <button
              type="button"
              aria-label={`${t('common.remove')} ${email}`}
              onClick={() => onChange(emails.filter((e) => e !== email))}
              className="rounded p-0.5 hover:bg-active"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
      <input
        autoFocus={autoFocus}
        type="email"
        aria-label={t('invite.emails')}
        value={draft}
        placeholder={emails.length ? '' : t('invite.emailsPlaceholder')}
        onChange={(e) => {
          const v = e.target.value;
          if (/[\s,;]/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            commit(draft);
          }
          if (e.key === 'Backspace' && !draft && emails.length) onChange(emails.slice(0, -1));
        }}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          e.preventDefault();
          commit(draft + ' ' + e.clipboardData.getData('text'));
        }}
        className="h-7 min-w-[180px] flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-fg-4"
      />
    </div>
  );
}
