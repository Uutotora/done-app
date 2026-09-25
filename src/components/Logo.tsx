import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

/** The Done mark: a rounded square with a check that draws itself. */
export function Logo({ size = 28, animate = false, className }: { size?: number; animate?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn('shrink-0', className)}>
      <motion.rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="8"
        className="fill-[#191919] dark:fill-white"
        initial={animate ? { scale: 0.6, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        style={{ transformOrigin: 'center' }}
      />
      <motion.path
        d="M9.5 16.5l4.5 4.5 8.5-9.5"
        fill="none"
        className="stroke-white dark:stroke-[#191919]"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ delay: animate ? 0.25 : 0, duration: 0.45, ease: [0.65, 0, 0.35, 1] }}
      />
    </svg>
  );
}

export function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <Logo size={40} animate />
    </div>
  );
}
