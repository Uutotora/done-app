import { motion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';

interface GlideState {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  /** Jump without sliding, e.g. when the pointer enters the list from outside. */
  instant: boolean;
}

/**
 * One soft highlight that follows the pointer between rows marked with
 * `data-glide`, instead of every row flashing its own background.
 */
export function useHoverGlide<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const current = useRef<Element | null>(null);
  const [state, setState] = useState<GlideState>({ x: 0, y: 0, width: 0, height: 0, visible: false, instant: true });

  const track = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const container = ref.current;
    const row = (e.target as Element).closest?.('[data-glide]');
    if (!container || !row || !container.contains(row) || row.closest('[data-glide-off]')) return;
    const c = container.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const next = { x: r.left - c.left + container.scrollLeft, y: r.top - c.top + container.scrollTop, width: r.width, height: r.height };
    const moved = row !== current.current;
    current.current = row;
    setState((prev) => {
      // Rows can shift under a still pointer (sections expanding); only update when something changed.
      if (!moved && prev.visible && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.height - next.height) < 0.5 && Math.abs(prev.width - next.width) < 0.5)
        return prev;
      return { ...next, visible: true, instant: !prev.visible };
    });
  }, []);

  const onPointerLeave = useCallback(() => {
    current.current = null;
    setState((prev) => ({ ...prev, visible: false, instant: true }));
  }, []);

  return { ref, state, bind: { onPointerOver: track, onPointerMove: track, onPointerLeave } };
}

export function GlideHighlight({ state }: { state: GlideState }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 rounded-md bg-hover"
      initial={false}
      animate={{ x: state.x, y: state.y, width: state.width, height: state.height, opacity: state.visible ? 1 : 0 }}
      transition={
        state.instant
          ? { duration: 0, opacity: { duration: 0.12, ease: 'easeOut' } }
          : { type: 'spring', stiffness: 560, damping: 44, mass: 0.6, opacity: { duration: 0.12 } }
      }
    />
  );
}
