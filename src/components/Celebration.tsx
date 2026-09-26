import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { useUI } from '@/lib/ui';

const COLORS = ['#4dab7a', '#3e8fd6', '#e2b340', '#d45d9c', '#9a6dd7', '#e9883c'];

/** A small burst of confetti where an item was completed. The signature "Done" moment. */
export function Celebration() {
  const reducedMotion = useReducedMotion();
  const celebrate = useUI((s) => s.celebrate);
  const [active, setActive] = useState<typeof celebrate>();
  useEffect(() => {
    if (!celebrate) return;
    setActive(celebrate);
    const id = setTimeout(() => setActive(undefined), 900);
    return () => clearTimeout(id);
  }, [celebrate]);

  const particles = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 38 + Math.random() * 34;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 10,
          color: COLORS[i % COLORS.length],
          size: 4 + Math.random() * 4,
          rotate: Math.random() * 360,
          round: i % 3 === 0,
        };
      }),
    [active?.key],
  );

  if (reducedMotion) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[80]">
      <AnimatePresence>
        {active && (
          <motion.div key={active.key} className="absolute" style={{ left: active.x, top: active.y }} exit={{ opacity: 0 }}>
            <motion.div
              className="absolute -left-4 -top-4 h-8 w-8 rounded-full border-2 border-[#4dab7a]"
              initial={{ scale: 0.3, opacity: 0.9 }}
              animate={{ scale: 1.8, opacity: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            />
            {particles.map((p, i) => (
              <motion.span
                key={i}
                className="absolute block"
                style={{
                  width: p.size,
                  height: p.round ? p.size : p.size * 0.5,
                  background: p.color,
                  borderRadius: p.round ? 999 : 1,
                  left: -p.size / 2,
                  top: -p.size / 2,
                }}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
                animate={{ x: p.x, y: p.y + 18, opacity: 0, rotate: p.rotate, scale: 1 }}
                transition={{ duration: 0.75, ease: [0.2, 0.7, 0.3, 1] }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
