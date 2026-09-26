import { cn } from '@/lib/utils';

/**
 * One sidebar row, measured from Notion: 30px tall, 1px apart, 6px radius,
 * 14px medium text. Hover and selection only change the background (see
 * `.sidebar-row` in index.css), instantly like Notion.
 */
export const sidebarRow = (active: boolean) =>
  cn(
    'sidebar-row group/row relative mb-px flex h-[30px] w-full min-w-0 select-none items-center gap-1.5 rounded-md pr-1 text-left text-[14px] font-medium outline-offset-[-2px]',
    active && 'is-active',
  );

/** Square icon button in the sidebar chrome (toggle, inbox, new page, help). */
export const SIDEBAR_ICON_BUTTON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--sb-icon)] transition-colors duration-[20ms] ease-in hover:bg-[var(--sb-hover)] hover:text-[var(--sb-text)]';
