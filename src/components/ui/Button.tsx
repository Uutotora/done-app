import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] disabled:opacity-50',
  secondary: 'border border-line-strong text-fg hover:bg-hover disabled:opacity-50',
  ghost: 'text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-40',
  subtle: 'bg-hover text-fg hover:bg-active disabled:opacity-50',
  danger:
    'text-[var(--c-red-text)] border border-[color-mix(in_srgb,var(--c-red-text)_35%,transparent)] hover:bg-[var(--c-red-bg)] disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  xs: 'h-6 px-1.5 text-[12px] gap-1 rounded-[5px]',
  sm: 'h-7 px-2 text-[13px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[14px] gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-[15px] gap-2 rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,box-shadow,transform] duration-150 active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'xs' | 'sm' | 'md'; active?: boolean; label?: string }
>(function IconButton({ size = 'sm', className, active, label, children, ...rest }, ref) {
  const s = size === 'xs' ? 'h-5 w-5 rounded' : size === 'sm' ? 'h-6 w-6 rounded-[5px]' : 'h-7 w-7 rounded-md';
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-fg-3 transition-colors duration-100 hover:bg-hover hover:text-fg-2 disabled:opacity-40',
        active && 'bg-hover text-fg',
        s,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5 animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
