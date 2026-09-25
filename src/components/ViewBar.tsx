import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ViewTab<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/**
 * Database-style header, like the row above a Notion database:
 * view tabs on the left, filters and the blue "New" button on the right.
 */
export function ViewBar<T extends string>({
  tabs,
  value,
  onChange,
  children,
  className,
}: {
  tabs?: ViewTab<T>[];
  value?: T;
  onChange?: (v: T) => void;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('full-width flex h-11 shrink-0 items-center gap-1 border-b border-line', className)}>
      {tabs && (
        <div className="no-scrollbar -mb-px flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.value === value;
            return (
              <button
                key={tab.value}
                onClick={() => onChange?.(tab.value)}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 px-2 text-[14px] transition-colors',
                  active ? 'font-medium text-fg' : 'text-fg-3 hover:text-fg-2',
                )}
              >
                <span className="flex items-center gap-1.5 rounded-md px-1 py-1 transition-colors hover:bg-hover">
                  {tab.icon}
                  {tab.label}
                </span>
                {active && (
                  <motion.span
                    layoutId={`viewbar-${id}`}
                    className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-fg"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">{children}</div>
    </div>
  );
}

/** Small ghost button used in the right side of the ViewBar (Filter, Sort, ...). */
export function BarButton({
  children,
  icon,
  active,
  className,
  ...rest
}: { children?: ReactNode; icon?: ReactNode; active?: boolean } & React.ComponentProps<'button'>) {
  return (
    <button
      {...rest}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[14px] transition-colors',
        active ? 'text-accent hover:bg-accent-soft' : 'text-fg-3 hover:bg-hover hover:text-fg-2',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** The blue "New" button from Notion databases. */
export function NewButton({ children, ...rest }: { children: ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button
      {...rest}
      className="ml-1 flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-[14px] font-medium text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] transition-[background,transform] hover:bg-accent-hover active:scale-[0.98]"
    >
      {children}
    </button>
  );
}
