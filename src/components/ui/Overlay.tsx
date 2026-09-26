import * as RPopover from '@radix-ui/react-popover';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RDialog from '@radix-ui/react-dialog';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RContext from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Kbd } from './bits';

/* --------------------------------- Popover -------------------------------- */

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  sideOffset = 6,
  className,
  modal,
  asChild = true,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  className?: string;
  modal?: boolean;
  asChild?: boolean;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RPopover.Trigger asChild={asChild}>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            // Let inputs inside grab focus but keep scroll position stable.
            const el = (e.target as HTMLElement | null)?.querySelector?.('input,textarea') as HTMLElement | null;
            if (el) {
              e.preventDefault();
              el.focus({ preventScroll: true });
            }
          }}
          className={cn('anim-pop z-50 rounded-lg bg-elevated shadow-md outline-none', className)}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export const PopoverClose = RPopover.Close;

/* ---------------------------------- Menu ---------------------------------- */

export function Menu({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  return (
    <RMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className={cn('anim-pop z-50 min-w-[220px] rounded-lg bg-elevated p-1 shadow-md outline-none', className)}
        >
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

const itemCls =
  'relative flex h-7 cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 text-[14px] text-fg outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-40';

export function MenuItem({
  icon,
  children,
  shortcut,
  danger,
  onSelect,
  disabled,
  checked,
}: {
  icon?: ReactNode;
  children: ReactNode;
  shortcut?: string;
  danger?: boolean;
  onSelect?: (e: Event) => void;
  disabled?: boolean;
  checked?: boolean;
}) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(itemCls, danger && 'text-[var(--c-red-text)] data-[highlighted]:bg-[var(--c-red-bg)]')}
    >
      {icon && <span className={cn('flex h-4 w-4 items-center justify-center text-fg-2', danger && 'text-inherit')}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {checked && <Check size={14} className="text-fg-2" />}
      {shortcut && <Kbd className="ml-4">{shortcut}</Kbd>}
    </RMenu.Item>
  );
}

export function MenuSeparator() {
  return <RMenu.Separator className="mx-1 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-fg-3">{children}</RMenu.Label>;
}

export function SubMenu({ label, icon, children }: { label: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <RMenu.Sub>
      <RMenu.SubTrigger className={cn(itemCls, 'data-[state=open]:bg-hover')}>
        {icon && <span className="flex h-4 w-4 items-center justify-center text-fg-2">{icon}</span>}
        <span className="flex-1 truncate">{label}</span>
        <ChevronRight size={14} className="text-fg-3" />
      </RMenu.SubTrigger>
      <RMenu.Portal>
        <RMenu.SubContent
          sideOffset={4}
          collisionPadding={12}
          className="anim-pop z-50 max-h-[360px] min-w-[200px] overflow-y-auto rounded-lg bg-elevated p-1 shadow-md outline-none"
        >
          {children}
        </RMenu.SubContent>
      </RMenu.Portal>
    </RMenu.Sub>
  );
}

/* ------------------------- Data-driven menus (Notion ...) ------------------------ */

export type MenuEntry =
  | {
      key: string;
      label: ReactNode;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
    }
  | { key: string; separator: true }
  | { key: string; heading: ReactNode }
  | { key: string; label: ReactNode; icon?: ReactNode; children: MenuEntry[] };

function renderEntries(entries: MenuEntry[], kind: 'dropdown' | 'context'): ReactNode {
  const P = kind === 'dropdown' ? RMenu : RContext;
  return entries.map((e) => {
    if ('separator' in e) return <P.Separator key={e.key} className="mx-1 my-1 h-px bg-line" />;
    if ('heading' in e)
      return (
        <P.Label key={e.key} className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-fg-3">
          {e.heading}
        </P.Label>
      );
    if ('children' in e)
      return (
        <P.Sub key={e.key}>
          <P.SubTrigger className={cn(itemCls, 'data-[state=open]:bg-hover')}>
            {e.icon && <span className="flex h-4 w-4 items-center justify-center text-fg-2">{e.icon}</span>}
            <span className="flex-1 truncate">{e.label}</span>
            <ChevronRight size={14} className="text-fg-3" />
          </P.SubTrigger>
          <P.Portal>
            <P.SubContent
              sideOffset={4}
              collisionPadding={12}
              className="anim-pop z-50 max-h-[360px] min-w-[200px] overflow-y-auto rounded-lg bg-elevated p-1 shadow-md outline-none"
            >
              {renderEntries(e.children, kind)}
            </P.SubContent>
          </P.Portal>
        </P.Sub>
      );
    return (
      <P.Item
        key={e.key}
        disabled={e.disabled}
        onSelect={e.onSelect}
        className={cn(itemCls, e.danger && 'text-[var(--c-red-text)] data-[highlighted]:bg-[var(--c-red-bg)]')}
      >
        {e.icon && <span className={cn('flex h-4 w-4 items-center justify-center text-fg-2', e.danger && 'text-inherit')}>{e.icon}</span>}
        <span className="flex-1 truncate">{e.label}</span>
        {e.checked && <Check size={14} className="text-fg-2" />}
        {e.shortcut && <Kbd className="ml-4">{e.shortcut}</Kbd>}
      </P.Item>
    );
  });
}

export function EntriesMenu({
  trigger,
  entries,
  align = 'start',
  side = 'bottom',
  header,
}: {
  trigger: ReactNode;
  entries: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  header?: ReactNode;
}) {
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          onClick={(e) => e.stopPropagation()}
          className="anim-pop z-50 min-w-[240px] rounded-lg bg-elevated p-1 shadow-md outline-none"
        >
          {header}
          {renderEntries(entries, 'dropdown')}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

/** Right-click menu with the same entries as the row's "..." menu, like Notion. */
export function ContextMenu({ children, entries, disabled }: { children: ReactNode; entries: MenuEntry[]; disabled?: boolean }) {
  if (disabled || !entries.length) return <>{children}</>;
  return (
    <RContext.Root modal={false}>
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal>
        <RContext.Content
          collisionPadding={12}
          className="anim-pop z-50 min-w-[240px] rounded-lg bg-elevated p-1 shadow-md outline-none"
          style={{ transformOrigin: 'var(--radix-context-menu-content-transform-origin)' }}
        >
          {renderEntries(entries, 'context')}
        </RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  );
}

/* --------------------------------- Dialog --------------------------------- */

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  title,
  description,
  position = 'center',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  position?: 'center' | 'top';
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="anim-overlay fixed inset-0 z-40 bg-[var(--overlay)]" />
        <div
          className={cn(
            'pointer-events-none fixed inset-0 z-50 flex justify-center p-4',
            position === 'center' ? 'items-center' : 'items-start pt-[12vh]',
          )}
        >
          <RDialog.Content
            aria-describedby={description ? undefined : undefined}
            className={cn(
              'anim-dialog pointer-events-auto relative max-h-[86vh] w-full overflow-hidden rounded-xl bg-elevated shadow-lg outline-none',
              className,
            )}
          >
            <RDialog.Title className="sr-only">{title ?? 'Dialog'}</RDialog.Title>
            <RDialog.Description className="sr-only">{description ?? title ?? ''}</RDialog.Description>
            {children}
          </RDialog.Content>
        </div>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const DialogClose = RDialog.Close;

/* --------------------------------- Tooltip -------------------------------- */

export const TooltipProvider = (props: ComponentProps<typeof RTooltip.Provider>) => (
  <RTooltip.Provider delayDuration={450} skipDelayDuration={200} {...props} />
);

export function Tooltip({
  content,
  shortcut,
  children,
  side = 'bottom',
}: {
  content: ReactNode;
  shortcut?: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="anim-pop z-[60] flex items-center gap-2 rounded-md bg-[#0f0f0f] px-2 py-1 text-[12px] font-medium leading-tight text-white/90 shadow-md dark:bg-[#3a3a3a]"
        >
          {content}
          {shortcut && <span className="text-white/50">{shortcut}</span>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
