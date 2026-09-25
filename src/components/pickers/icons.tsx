import { motion } from 'motion/react';
import { TYPE_META, STATUS_META, PRIORITY_COLOR } from '@/lib/constants';
import { getIcon } from '@/lib/icons';
import type { ItemStatus, ItemType, Priority } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Linear-style status glyph: fill grows with progress. */
export function StatusIcon({ status, size = 14 }: { status: ItemStatus; size?: number }) {
  const color = STATUS_META[status].color;
  const r = 5.2;
  const c = 2 * Math.PI * r;
  const fill: Record<ItemStatus, number> = {
    idea: 0,
    backlog: 0,
    planned: 0,
    in_progress: 0.5,
    in_review: 0.75,
    done: 1,
    canceled: 1,
  };
  const dashed = status === 'backlog' || status === 'idea';
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" data-color={color} className="shrink-0">
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="var(--tint-solid)"
        strokeWidth="1.5"
        strokeDasharray={dashed ? (status === 'idea' ? '1 2.2' : '2.2 1.8') : undefined}
      />
      {status === 'done' || status === 'canceled' ? (
        <>
          <circle cx="7" cy="7" r="6" fill="var(--tint-solid)" />
          {status === 'done' ? (
            <path d="M4.3 7.2l1.8 1.8 3.6-3.9" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M5 5l4 4M9 5l-4 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
          )}
        </>
      ) : fill[status] > 0 ? (
        <motion.circle
          cx="7"
          cy="7"
          r={r / 2}
          fill="none"
          stroke="var(--tint-solid)"
          strokeWidth={r}
          strokeDasharray={`${(c / 2) * fill[status]} ${c}`}
          transform="rotate(-90 7 7)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
      ) : null}
    </svg>
  );
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const color = PRIORITY_COLOR[priority];
  if (priority === 'urgent') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" data-color={color} className="shrink-0">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--tint-solid)" />
        <path d="M7 3.8v4" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="7" cy="10.2" r="1" fill="white" />
      </svg>
    );
  }
  if (priority === 'none') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0 text-fg-4">
        <path d="M2 7h2M6 7h2M10 7h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0 text-fg-2">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={3.5 + i * 3} rx="1" fill="currentColor" opacity={i < level ? 0.85 : 0.2} />
      ))}
    </svg>
  );
}

export function TypeIcon({ type, size = 16, boxed = false, className }: { type: ItemType; size?: number; boxed?: boolean; className?: string }) {
  const meta = TYPE_META[type];
  const Cmp = getIcon(meta.icon)!;
  if (!boxed) {
    return (
      <span data-color={meta.color} className={cn('tint-text inline-flex shrink-0', className)}>
        <Cmp size={size} strokeWidth={2} />
      </span>
    );
  }
  return (
    <span
      data-color={meta.color}
      className={cn('tint inline-flex shrink-0 items-center justify-center rounded-[5px]', className)}
      style={{ width: size + 6, height: size + 6 }}
    >
      <Cmp size={size - 2} strokeWidth={2.2} />
    </span>
  );
}
