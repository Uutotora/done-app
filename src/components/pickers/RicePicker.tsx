import { useState, type ReactElement } from 'react';
import { Popover } from '@/components/ui/Overlay';
import { CONFIDENCE_VALUES, IMPACT_VALUES, formatScore, riceScore } from '@/lib/rice';
import { useT, type TKey } from '@/lib/i18n';
import type { Rice } from '@/lib/types';
import { cn } from '@/lib/utils';

const EMPTY: Rice = { reach: 0, impact: 1, confidence: 80, effort: 1 };

export function RicePicker({ value, onChange, children }: { value?: Rice; onChange: (r: Rice | undefined) => void; children: ReactElement }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const r = value ?? EMPTY;
  const score = riceScore(value);
  const set = (patch: Partial<Rice>) => onChange({ ...r, ...patch });
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={children}>
      <div className="w-[300px] p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-semibold">{t('rice.title')}</div>
          <div className="text-[12px] text-fg-3">R × I × C / E</div>
        </div>
        <div className="space-y-3">
          <NumberRow label={t('rice.reach')} hint={t('rice.reachHint')} value={r.reach} onChange={(v) => set({ reach: v })} step={100} />
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-fg-2">{t('rice.impact')}</div>
            <div className="grid grid-cols-5 gap-1">
              {IMPACT_VALUES.map((v) => (
                <button
                  key={v}
                  onClick={() => set({ impact: v })}
                  title={t(`rice.impact.${v}` as TKey)}
                  className={cn(
                    'h-7 rounded-[5px] text-[12px] font-medium transition-colors',
                    r.impact === v ? 'bg-accent text-white' : 'bg-hover text-fg-2 hover:bg-active',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[11.5px] text-fg-3">{t(`rice.impact.${r.impact}` as TKey)}</div>
          </div>
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-fg-2">{t('rice.confidence')}</div>
            <div className="grid grid-cols-4 gap-1">
              {CONFIDENCE_VALUES.map((v) => (
                <button
                  key={v}
                  onClick={() => set({ confidence: v })}
                  className={cn(
                    'h-7 rounded-[5px] text-[12px] font-medium transition-colors',
                    r.confidence === v ? 'bg-accent text-white' : 'bg-hover text-fg-2 hover:bg-active',
                  )}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>
          <NumberRow label={t('rice.effort')} hint={t('rice.effortHint')} value={r.effort} onChange={(v) => set({ effort: v })} step={0.5} />
        </div>
        <div className="mt-3 flex items-center justify-between rounded-md bg-hover px-3 py-2">
          <span className="text-[13px] text-fg-2">{t('rice.score')}</span>
          <span className="text-[18px] font-semibold tabular-nums">{score != null ? formatScore(score) : '—'}</span>
        </div>
        {value && (
          <button
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="mt-2 h-7 w-full rounded-[5px] text-[13px] text-fg-3 hover:bg-hover"
          >
            {t('common.clear')}
          </button>
        )}
      </div>
    </Popover>
  );
}

function NumberRow({
  label,
  hint,
  value,
  onChange,
  step,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[12.5px] font-medium text-fg-2">{label}</div>
        <div className="text-[11.5px] text-fg-3">{hint}</div>
      </div>
      <input
        type="number"
        min={0}
        step={step}
        value={value || ''}
        placeholder="0"
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="h-7 w-[96px] rounded-[5px] border border-line-strong bg-input px-2 text-right text-[13px] tabular-nums outline-none focus:border-accent"
      />
    </div>
  );
}
