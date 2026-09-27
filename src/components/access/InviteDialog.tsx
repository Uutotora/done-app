import { AlertCircle, Check, ChevronDown, Copy, Link2, Mail, MailCheck, MailWarning, RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLang, useT } from '@/lib/i18n';
import { useData } from '@/lib/store';
import { toast, useUI } from '@/lib/ui';
import { EMAIL_RE, inviteMailto, inviteMembers, updateJoinLink, useActor, useMembers, type AccessInput, type InviteResult } from '@/lib/members';
import type { AccessRole } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/bits';
import { Dialog } from '@/components/ui/Overlay';
import { StateIllustration } from '@/components/StatePanel';
import { AccessEditor, EmailsInput, RoleSelect } from './AccessControls';

const DEFAULT_ACCESS: AccessInput = { role: 'editor', projectIds: null, projectRoles: {}, canCreateProjects: true };
const LINK_ROLES: AccessRole[] = ['editor', 'viewer'];

const copy = (text: string, message: string) => {
  void navigator.clipboard?.writeText(text);
  toast({ message });
};

/**
 * "Invite to your team", the way Notion does it: addresses, role and the button on one line,
 * project access tucked behind one row, and the team's shareable link underneath.
 * Rendered once in the app shell and opened with useUI().setInvite(true).
 */
export function InviteDialog() {
  const open = useUI((s) => s.inviteOpen);
  const setOpen = useUI((s) => s.setInvite);
  return <InviteDialogContent open={open} onOpenChange={setOpen} />;
}

function InviteDialogContent({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const actor = useActor();
  const { remote, mail } = useMembers();
  const navigate = useNavigate();
  const [emails, setEmails] = useState<string[]>([]);
  const [access, setAccess] = useState<AccessInput>(DEFAULT_ACCESS);
  const [showAccess, setShowAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<InviteResult | null>(null);
  const projects = useData((s) => s.projects);
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  const admin = access.role === 'owner' || access.role === 'admin';
  const count = access.projectIds?.filter((id) => projects[id]).length ?? 0;
  const scope = admin || access.projectIds === null ? t('invite.accessAll2') : count ? t('invite.accessN', { n: count }) : t('invite.accessNone');

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setEmails([]);
      setAccess(DEFAULT_ACCESS);
      setShowAccess(false);
      setResult(null);
      setError('');
    }
  };
  const submit = async () => {
    if (!emails.length) return;
    if (invalid.length) return setError(t('invite.invalid', { emails: invalid.join(', ') }));
    setBusy(true);
    setError('');
    try {
      const r = await inviteMembers(emails, access);
      if (r.skipped.length) toast({ message: t('invite.skipped', { emails: r.skipped.map((s) => s.email).join(', ') }) });
      // Every letter went out: nothing left to do here, like Notion.
      if (r.mailed && r.links.every((l) => r.emailed?.includes(l.email))) {
        toast({
          message: r.links.length === 1 ? t('invite.sentOne', { email: r.links[0].email }) : t('invite.sentMany', { n: r.links.length }),
          tone: 'success',
        });
        close(false);
      } else if (r.links.length) setResult(r);
      else {
        const added = emails.length - r.skipped.length;
        if (added) toast({ message: t('invite.addedLocal', { n: added }), tone: 'success' });
        close(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close} position="top" className="max-w-[560px]" title={t('invite.title')}>
      {result ? (
        <InviteResults result={result} onDone={() => close(false)} />
      ) : (
        <div className="flex max-h-[86vh] flex-col">
          <div className="flex items-center gap-2 px-5 pb-1 pt-4">
            <h2 className="min-w-0 flex-1 text-[15px] font-semibold">{t('invite.title')}</h2>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => close(false)}
              className="-mr-1.5 flex h-7 w-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg-2"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <EmailsInput
                    autoFocus
                    emails={emails}
                    onChange={(next) => {
                      setEmails(next);
                      setError('');
                    }}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:h-10">
                  <RoleSelect
                    value={access.role}
                    actor={actor}
                    onChange={(role) => setAccess({ ...access, role, canCreateProjects: role === 'viewer' ? false : access.canCreateProjects })}
                    className="h-9 border border-line px-2.5"
                  />
                  <Button type="submit" variant="primary" size="md" loading={busy} disabled={!emails.length} className="h-9">
                    {emails.length > 1 ? t('invite.submitN', { n: emails.length }) : t('invite.submit')}
                  </Button>
                </div>
              </div>
            </form>
            <button
              type="button"
              disabled={admin}
              aria-expanded={showAccess}
              onClick={() => setShowAccess((v) => !v)}
              className="mt-2 flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-fg-3 transition-colors enabled:hover:bg-hover enabled:hover:text-fg-2"
            >
              {t('invite.accessEdit')}: <span className="text-fg-2">{scope}</span>
              {!admin && <ChevronDown size={13} className={cn('transition-transform', showAccess && 'rotate-180')} />}
            </button>
            {showAccess && !admin && (
              <div className="mt-2">
                <AccessEditor value={access} onChange={setAccess} actor={actor} showRole={false} />
              </div>
            )}
            {remote && !mail.configured && (
              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 rounded-md bg-subtle px-2.5 py-2 text-[12.5px] text-fg-3">
                <MailWarning size={13} className="shrink-0" />
                {t('invite.mailOff')}
                <button
                  type="button"
                  onClick={() => {
                    close(false);
                    navigate('/settings/mail');
                  }}
                  className="font-medium text-fg-2 underline underline-offset-2 hover:text-fg"
                >
                  {t('invite.mailConnect')}
                </button>
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 text-[13px] text-[var(--c-red-text)]">
                {error}
              </p>
            )}
            {remote && (actor?.role === 'owner' || actor?.role === 'admin') && <JoinLinkSection />}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** The team's shareable link: on or off, the role it gives, copy and reset. */
function JoinLinkSection() {
  const t = useT();
  const actor = useActor();
  const { link } = useMembers();
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmReset]);
  const change = async (patch: Parameters<typeof updateJoinLink>[0], message?: string) => {
    setBusy(true);
    try {
      await updateJoinLink(patch);
      if (message) toast({ message, tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="invite-link-title" className="mt-5 border-t border-line pt-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-fg-2">
          <Link2 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="invite-link-title" className="text-[14px] font-medium">
            {t('invite.link')}
          </h3>
          {link.enabled ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[13px] text-fg-3">
              {t('invite.linkHint')}
              <RoleSelect
                value={link.level as AccessRole}
                actor={actor}
                roles={LINK_ROLES}
                label={t('invite.linkRole')}
                onChange={(role) => role !== link.level && void change({ level: role as 'editor' | 'viewer' })}
                className="-ml-1 h-6 px-1.5 text-[13px]"
              />
            </div>
          ) : (
            <p className="mt-0.5 text-[13px] leading-snug text-fg-3">{t('invite.linkOff')}</p>
          )}
        </div>
        <span className={cn('mt-1.5', busy && 'pointer-events-none opacity-60')}>
          <Switch checked={link.enabled} onChange={(enabled) => void change({ enabled })} label={t('invite.link')} />
        </span>
      </div>
      {link.enabled && link.url && (
        <div className="mt-3 pl-11">
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label={t('invite.link')}
              value={link.url}
              onFocus={(e) => e.target.select()}
              className="h-9 min-w-0 flex-1 truncate rounded-md border border-line bg-subtle px-2.5 font-mono text-[12px] text-fg-2 outline-none focus:border-accent"
            />
            <Button size="md" icon={<Copy size={14} />} className="h-9 shrink-0" onClick={() => copy(link.url!, t('invite.linkCopied'))}>
              {t('invite.linkCopy')}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
            {link.joined > 0 && <span>{t('invite.linkJoined', { n: link.joined })}</span>}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                setConfirmReset(false);
                void change({ reset: true }, t('invite.linkResetDone'));
              }}
              className={cn(
                'flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-hover',
                confirmReset ? 'text-[var(--c-red-text)]' : 'hover:text-fg-2',
                link.joined > 0 ? '' : '-ml-1',
              )}
            >
              <RotateCw size={12} />
              {confirmReset ? t('invite.linkResetConfirm') : t('invite.linkReset')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Links to share by hand: email is off on the server, or some letters did not go out. */
function InviteResults({ result, onDone }: { result: InviteResult; onDone: () => void }) {
  const t = useT();
  const lang = useLang();
  const workspace = useData((s) => s.workspace.name);
  const mailed = !!result.mailed;
  const emailed = new Set(result.emailed ?? []);
  const failedAll = mailed && emailed.size === 0;
  return (
    <div className="flex max-h-[86vh] flex-col">
      <div className="px-5 pb-3 pt-5 text-center">
        <StateIllustration scene="letter" className="mx-auto mb-3 !w-[150px]" />
        <div className="flex items-center justify-center gap-2 text-[16px] font-semibold">
          {failedAll ? (
            <AlertCircle size={18} className="shrink-0 text-[var(--c-red-text)]" />
          ) : (
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--c-green-solid)] text-white">
              <Check size={12} strokeWidth={3} />
            </span>
          )}
          {mailed ? (failedAll ? t('invite.sendFailedTitle') : t('invite.partialTitle')) : t('invite.doneTitle')}
        </div>
        <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] leading-relaxed text-fg-3">
          {mailed ? t('invite.sendFailedHint') : t('invite.doneHint')}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-3 py-2">
        {result.links.map((link) => (
          <div key={link.email} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-subtle)]">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[14px]">{link.email}</span>
                {mailed &&
                  (emailed.has(link.email) ? (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] text-fg-3">
                      <MailCheck size={12} />
                      {t('invite.sent')}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--c-red-text)]">
                      <AlertCircle size={12} />
                      {t('invite.notSent')}
                    </span>
                  ))}
              </div>
              <input
                readOnly
                aria-label={t('invite.linkFor', { email: link.email })}
                value={link.url}
                onFocus={(e) => e.target.select()}
                className="w-full truncate bg-transparent font-mono text-[11.5px] text-fg-3 outline-none"
              />
            </div>
            {!emailed.has(link.email) && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Mail size={14} />}
                onClick={() => window.open(inviteMailto(link.email, link.url, workspace, lang), '_self')}
              >
                {t('invite.mail')}
              </Button>
            )}
            <Button size="sm" icon={<Copy size={14} />} onClick={() => copy(link.url, t('common.copied'))}>
              {t('invite.copy')}
            </Button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        {result.links.length > 1 && (
          <Button icon={<Copy size={14} />} onClick={() => copy(result.links.map((l) => `${l.email}: ${l.url}`).join('\n'), t('common.copied'))}>
            {t('invite.copyAll')}
          </Button>
        )}
        <Button variant="primary" onClick={onDone}>
          {t('common.done')}
        </Button>
      </div>
    </div>
  );
}
