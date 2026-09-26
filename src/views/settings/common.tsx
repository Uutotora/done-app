import type { ReactNode } from 'react';
import { COLORS } from '@/lib/constants';
import type { ColorName } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Page title of a settings section, with an optional line of explanation. */
export function H({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{children}</h1>
        {sub && <p className="mt-1.5 max-w-[560px] text-[14px] leading-relaxed text-fg-3">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Smaller heading inside a page. */
export function H2({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('mb-1 mt-8 border-b border-line pb-2 text-[15px] font-semibold', className)}>{children}</h2>;
}

/** Label on the left, control on the right, like Notion's settings rows. */
export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
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

export function ColorDots({ value, onChange, disabled }: { value: ColorName; onChange: (c: ColorName) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          data-color={c}
          disabled={disabled}
          onClick={() => onChange(c)}
          aria-label={c}
          aria-pressed={value === c}
          className={cn(
            'tint-solid h-5 w-5 rounded-full transition-transform enabled:hover:scale-110 disabled:opacity-60',
            value === c && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--bg)]',
          )}
        />
      ))}
    </div>
  );
}

/** Quiet note under a heading: read-only explanations and demo hints. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('rounded-lg bg-subtle px-3 py-2.5 text-[13px] leading-relaxed text-fg-3', className)}>{children}</p>;
}
