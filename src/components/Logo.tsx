import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/** A bold D paper block, sized for navigation and account screens. */
export function Logo({ size = 28, animate = false, className }: { size?: number; animate?: boolean; className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.img
      src="/brand/done-mark.png?v=2"
      alt="Done"
      width={size}
      height={size}
      draggable={false}
      className={cn('shrink-0 object-contain dark:invert', className)}
      initial={animate && !reducedMotion ? { opacity: 0, y: 3 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    />
  );
}

export function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <Logo size={40} animate />
    </div>
  );
}
