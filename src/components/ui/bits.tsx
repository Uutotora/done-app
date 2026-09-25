import { motion } from 'motion/react';
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn, initials } from '@/lib/utils';
import { getIcon } from '@/lib/icons';
import type { ColorName, IconValue, Person } from '@/lib/types';

/* ---------------------------------- Chip ---------------------------------- */

export function Chip({
  color = 'gray',
  children,
  className,
  dot,
  onClick,
  title,
}: {
  color?: ColorName;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      data-color={color}
      title={title}
      onClick={onClick}
      className={cn(
        'tint inline-flex h-[22px] max-w-full shrink-0 items-center gap-1.5 truncate whitespace-nowrap rounded-[4px] px-1.5 text-[12.5px] font-[450] leading-none',
        className,
      )}
    >
      {dot && <span className="tint-solid h-2 w-2 shrink-0 rounded-full" />}
      {children}
    </Tag>
  );
}

/* --------------------------------- Avatar --------------------------------- */

export function Avatar({ person, size = 20, className, ring }: { person?: Person; size?: number; className?: string; ring?: boolean }) {
  if (!person) {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      data-color={person.color}
      title={person.name}
      className={cn(
        'tint-solid inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        ring && 'ring-2 ring-[var(--bg)]',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42), letterSpacing: '-0.02em' }}
    >
      {initials(person.name)}
    </span>
  );
}

export function AvatarStack({ people, size = 20, max = 4 }: { people: Person[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((p, i) => (
        <Avatar key={p.id} person={p} size={size} ring className={i ? '-ml-1.5' : ''} />
      ))}
      {rest > 0 && (
        <span
          className="-ml-1.5 inline-flex items-center justify-center rounded-full bg-active text-[10px] font-semibold text-fg-2 ring-2 ring-[var(--bg)]"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/* ----------------------------------- Kbd ---------------------------------- */

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong px-1 font-sans text-[11px] font-medium text-fg-3',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* -------------------------------- Progress -------------------------------- */

export function Progress({
  value,
  color = 'green',
  className,
  height = 4,
}: {
  value: number;
  color?: ColorName;
  className?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-active', className)} style={{ height }}>
      <motion.div
        data-color={color}
        className="tint-solid h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 22 }}
      />
    </div>
  );
}

export function ProgressRing({ value, size = 16, color = 'green' }: { value: number; size?: number; color?: ColorName }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} data-color={color} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-active)" strokeWidth={2.2} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--tint-solid)"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }}
        transition={{ type: 'spring', stiffness: 90, damping: 20 }}
      />
    </svg>
  );
}

/* --------------------------------- Switch --------------------------------- */

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-200',
        checked ? 'bg-accent' : 'bg-line-strong',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 35 }}
        className={cn('h-[14px] w-[14px] rounded-full bg-white shadow-sm', checked ? 'ml-auto' : '')}
      />
    </button>
  );
}

/* ------------------------------- Segmented -------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  size?: 'sm' | 'md';
}) {
  const id = useId();
  return (
    <div className={cn('inline-flex items-center rounded-md bg-hover p-[2px]', size === 'sm' ? 'h-7' : 'h-8')}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-[5px] bg-elevated shadow-sm"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Empty state ------------------------------- */

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      {icon && <div className="mb-3 text-[40px] leading-none text-fg-4">{icon}</div>}
      {title && <div className="mb-1 text-[15px] font-semibold text-fg">{title}</div>}
      {children && <div className="max-w-[380px] text-[14px] text-fg-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}

/* -------------------------------- Page icon -------------------------------- */

export function PageIcon({ icon, size = 18, className }: { icon?: IconValue; size?: number; className?: string }) {
  if (!icon) return null;
  if (icon.startsWith('icon:')) {
    const [, name, color] = icon.split(':');
    const Cmp = getIcon(name);
    if (!Cmp) return null;
    return (
      <span data-color={color || 'gray'} className={cn('tint-text inline-flex shrink-0 items-center justify-center', className)}>
        <Cmp size={size * 0.9} strokeWidth={2} />
      </span>
    );
  }
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center leading-none', className)}
      style={{ fontSize: size * 0.88, width: size, height: size }}
    >
      {icon}
    </span>
  );
}

/* ------------------------------ Auto textarea ------------------------------ */

export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea(
  { className, value, onKeyDown, ...rest },
  outerRef,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof outerRef === 'function') outerRef(el);
        else if (outerRef) outerRef.current = el;
      }}
      rows={1}
      value={value}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        onKeyDown?.(e);
      }}
      className={cn('block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none', className)}
      {...rest}
    />
  );
});

/* --------------------------------- Inputs ---------------------------------- */

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(function TextInput(
  { className, icon, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-2 rounded-md border border-line-strong bg-input px-2.5 transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]',
        className,
      )}
    >
      {icon && <span className="text-fg-3">{icon}</span>}
      <input ref={ref} className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none" {...rest} />
    </div>
  );
});

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] font-medium text-fg-2">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[12px] text-fg-3">{hint}</div>}
    </label>
  );
}

/* ----------------------------- Done checkbox ------------------------------- */

export function DoneCheck({
  checked,
  onChange,
  size = 16,
  color = 'green',
}: {
  checked: boolean;
  onChange: (v: boolean, e: React.MouseEvent) => void;
  size?: number;
  color?: ColorName;
}) {
  return (
    <button
      data-color={color}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked, e);
      }}
      aria-pressed={checked}
      className={cn(
        'group/check relative inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-200',
        checked ? 'tint-solid tint-border' : 'border-fg-4 hover:border-[var(--tint-solid)]',
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 16 16" className="h-full w-full" fill="none">
        <motion.path
          d="M4.5 8.2l2.3 2.3 4.7-5"
          stroke={checked ? 'white' : 'var(--tint-solid)'}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      </svg>
    </button>
  );
}

/* ----------------------------- Section heading ----------------------------- */

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex h-7 items-center justify-between', className)}>
      <h3 className="text-[14px] font-semibold text-fg-2">{children}</h3>
      {action}
    </div>
  );
}

/* ------------------------------- Use outside ------------------------------- */

export function useOnEscape(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler, enabled]);
}
