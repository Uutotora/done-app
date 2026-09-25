import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Sparkles, SquareDashed } from 'lucide-react';
import { useState } from 'react';
import { useData } from '@/lib/store';
import { useLang, useT, type TKey } from '@/lib/i18n';
import { createBlankData, createSampleData } from '@/lib/seed';
import { putFileBlob } from '@/lib/storage';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { Lang } from '@/lib/types';

const ROLES: TKey[] = ['onb.role.product', 'onb.role.project', 'onb.role.lead', 'onb.role.other'];

export function Onboarding() {
  const t = useT();
  const lang = useLang();
  const setPrefs = useData((s) => s.setPrefs);
  const replaceAll = useData((s) => s.replaceAll);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [role, setRole] = useState<TKey>('onb.role.product');
  const [ws, setWs] = useState('');
  const [mode, setMode] = useState<'sample' | 'blank'>('sample');

  const finish = () => {
    const input = { lang, name: name.trim(), role: t(role), workspaceName: ws.trim() };
    const { data, blobs } = mode === 'sample' ? createSampleData(input) : { data: createBlankData(input), blobs: [] };
    data.prefs.theme = useData.getState().prefs.theme;
    replaceAll(data);
    void Promise.all(blobs.map(([id, blob]) => putFileBlob(id, blob)));
  };

  const next = () => setStep((s) => s + 1);
  const canNext = step === 1 ? name.trim().length > 0 : true;

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-bg px-6">
      {/* Soft animated background */}
      <motion.div
        className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #a1c4fd 0%, transparent 70%)' }}
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-48 -right-32 h-[560px] w-[560px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #fbc2eb 0%, transparent 70%)' }}
        animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="absolute right-5 top-4 flex gap-1">
        {(['ru', 'en'] as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => setPrefs({ lang: l })}
            className={cn('rounded-md px-2 py-1 text-[13px] font-medium uppercase', lang === l ? 'bg-active text-fg' : 'text-fg-3 hover:bg-hover')}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="relative w-full max-w-[460px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canNext) (step === 4 ? finish : next)();
            }}
          >
            {step === 0 && (
              <div className="text-center">
                <div className="mb-8 flex justify-center">
                  <Logo size={64} animate />
                </div>
                <h1 className="mb-3 text-[40px] font-bold leading-tight tracking-[-0.02em]">{t('onb.welcome')}</h1>
                <p className="mx-auto mb-10 max-w-[400px] text-[16px] leading-relaxed text-fg-2">{t('onb.welcomeSub')}</p>
                <Button variant="primary" size="lg" onClick={next} iconRight={<ArrowRight size={16} />} autoFocus>
                  {t('onb.start')}
                </Button>
              </div>
            )}
            {step === 1 && (
              <Step title={t('onb.nameTitle')}>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('onb.namePlaceholder')}
                  className="h-12 w-full rounded-lg border border-line-strong bg-input px-4 text-[18px] outline-none transition-shadow focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                />
                <Next onClick={next} disabled={!canNext} label={t('common.continue')} />
              </Step>
            )}
            {step === 2 && (
              <Step title={t('onb.roleTitle')}>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map((r, i) => (
                    <motion.button
                      key={r}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => setRole(r)}
                      className={cn(
                        'flex h-14 items-center justify-between rounded-lg border px-4 text-left text-[15px] font-medium transition-all',
                        role === r ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover',
                      )}
                    >
                      {t(r)}
                      {role === r && <Check size={16} className="text-accent" />}
                    </motion.button>
                  ))}
                </div>
                <Next onClick={next} label={t('common.continue')} />
              </Step>
            )}
            {step === 3 && (
              <Step title={t('onb.wsTitle')}>
                <input
                  autoFocus
                  value={ws}
                  onChange={(e) => setWs(e.target.value)}
                  placeholder={t('onb.wsPlaceholder')}
                  className="h-12 w-full rounded-lg border border-line-strong bg-input px-4 text-[18px] outline-none transition-shadow focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                />
                <Next onClick={next} label={t('common.continue')} />
              </Step>
            )}
            {step === 4 && (
              <Step title={t('onb.startTitle')}>
                <div className="space-y-2">
                  <Choice
                    active={mode === 'sample'}
                    onClick={() => setMode('sample')}
                    icon={<Sparkles size={20} />}
                    title={t('onb.sample')}
                    badge={t('onb.recommended')}
                    desc={t('onb.sampleDesc')}
                  />
                  <Choice
                    active={mode === 'blank'}
                    onClick={() => setMode('blank')}
                    icon={<SquareDashed size={20} />}
                    title={t('onb.blank')}
                    desc={t('onb.blankDesc')}
                  />
                </div>
                <Next onClick={finish} label={t('onb.go')} />
              </Step>
            )}
          </motion.div>
        </AnimatePresence>

        {step > 0 && (
          <div className="mt-10 flex justify-center gap-1.5">
            {[1, 2, 3, 4].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 rounded-full bg-fg-4"
                animate={{ width: i === step ? 22 : 6, opacity: i <= step ? 1 : 0.4 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-6 text-[28px] font-bold tracking-[-0.01em]">{title}</h2>
      {children}
    </div>
  );
}

function Next({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <div className="mt-6 flex justify-end">
      <Button variant="primary" size="lg" onClick={onClick} disabled={disabled} iconRight={<ArrowRight size={16} />}>
        {label}
      </Button>
    </div>
  );
}

function Choice({
  active,
  onClick,
  icon,
  title,
  desc,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-all',
        active ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover',
      )}
    >
      <span className={cn('mt-0.5', active ? 'text-accent' : 'text-fg-3')}>{icon}</span>
      <span className="flex-1">
        <span className="flex items-center gap-2 text-[16px] font-semibold">
          {title}
          {badge && <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">{badge}</span>}
        </span>
        <span className="mt-1 block text-[14px] text-fg-2">{desc}</span>
      </span>
    </button>
  );
}
