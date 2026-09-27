import { AlertCircle, Check, ChevronDown, Copy, Link2, Mail, MailCheck, MailWarning, RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLang, useT } from '@/lib/i18n';
import { useData } from '@/lib/store';
import { toast, useUI } from '@/lib/ui';
import { EMAIL_RE, inviteMailto, inviteMembers, updateJoinLink, useActor, useMembers, type AccessInput, type InviteResult } from '@/lib/members';
import { leaveDemo, type AccessRole } from '@/lib/auth';
import { cn, copyText } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';
import { StateIllustration } from '@/components/StatePanel';
import { AccessEditor, EmailsInput, RoleSelect } from './AccessControls';

const DEFAULT_ACCESS: AccessInput = { role: 'editor', projectIds: null, projectRoles: {}, canCreateProjects: true };
const LINK_ROLES: AccessRole[] = ['editor', 'viewer'];

const copy = async (text: string, message: string) => {
  // When even the fallback is refused, the link stays visible in the field to copy by hand.
  if (await copyText(text)) toast({ message });
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
          {remote ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
              <section aria-labelledby="invite-email-title">
                <h3 id="invite-email-title" className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
                  <Mail size={14} />
                  {t('invite.byEmail')}
                </h3>
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
                        {emails.length > 1 ? t('invite.submitN', { n: emails.length }) : t('invite.send')}
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
                {!mail.configured && (
                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 rounded-md bg-subtle px-2.5 py-2 text-[12.5px] text-fg-3">
                    <MailWarning size={13} className="shrink-0" />
                    {t('invite.mailOff')}
                    {mail.editable !== false && (
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
                    )}
                  </p>
                )}
                {error && (
                  <p role="alert" className="mt-3 text-[13px] text-[var(--c-red-text)]">
                    {error}
                  </p>
                )}
              </section>
              {(actor?.role === 'owner' || actor?.role === 'admin') && <JoinLinkSection />}
            </div>
          ) : (
            <DemoNotice onLeave={() => close(false)} />
          )}
        </div>
      )}
    </Dialog>
  );
}

/** The demo has no server: nobody can be invited, so say so and offer a real account. */
function DemoNotice({ onLeave }: { onLeave: () => void }) {
  const t = useT();
  return (
    <div className="px-5 pb-6 pt-2 text-center">
      <StateIllustration scene="team" className="mx-auto mb-3 !w-[190px]" />
      <div className="text-[15px] font-semibold">{t('invite.demoTitle')}</div>
      <p className="mx-auto mt-1.5 max-w-[380px] text-[13.5px] leading-relaxed text-fg-3">{t('invite.demoHint')}</p>
      <Button
        variant="primary"
        className="mt-4"
        onClick={() => {
          onLeave();
          void leaveDemo();
        }}
      >
        {t('invite.demoAction')}
      </Button>
    </div>
  );
}

/**
 * The team's shareable link, copy first: the first click creates the link and copies it.
 * The role it gives, reset and turning it off sit on one quiet line.
 */
function JoinLinkSection() {
  const t = useT();
  const actor = useActor();
  const { link } = useMembers();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset && !copied) return;
    const timer = setTimeout(() => {
      setConfirmReset(false);
      setCopied(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [confirmReset, copied]);
  const change = async (patch: Parameters<typeof updateJoinLink>[0], message?: string) => {
    setBusy(true);
    try {
      const next = await updateJoinLink(patch);
      if (message) toast({ message, tone: 'success' });
      return next;
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
      return null;
    } finally {
      setBusy(false);
    }
  };
  const copyLink = async () => {
    const current = link.enabled && link.url ? link : await change({ enabled: true });
    if (!current?.url) return;
    await copy(current.url, t('invite.linkCopied'));
    setCopied(true);
  };
  return (
    <section aria-labelledby="invite-link-title" className="mt-5 border-t border-line pt-4">
      <h3 id="invite-link-title" className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
        <Link2 size={14} />
        {t('invite.byLink')}
      </h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-[13px] text-fg-3">
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
        <Button
          variant="primary"
          size="md"
          loading={busy && !link.enabled}
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          className="h-9 shrink-0"
          onClick={() => void copyLink()}
        >
          {copied ? t('share.linkCopiedShort') : t('invite.linkCopy')}
        </Button>
      </div>
      {link.enabled && link.url && (
        <>
          <input
            readOnly
            aria-label={t('invite.link')}
            value={link.url}
            onFocus={(e) => e.target.select()}
            className="mt-3 h-8 w-full truncate rounded-md border border-line bg-subtle px-2.5 font-mono text-[11.5px] text-fg-2 outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
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
                'flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover',
                confirmReset ? 'text-[var(--c-red-text)]' : 'hover:text-fg-2',
              )}
            >
              <RotateCw size={11} />
              {confirmReset ? t('invite.linkResetConfirm') : t('invite.linkReset')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void change({ enabled: false })}
              className="rounded px-1 py-0.5 hover:bg-hover hover:text-fg-2"
            >
              {t('share.linkOff')}
            </button>
          </div>
        </>
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
