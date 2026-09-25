import { cn } from '@/lib/utils';

/** Neutral recorder glyph for Plaud recordings (not the Plaud logo). */
export function PlaudMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-[#2b2b2b] to-[#0f0f0f] dark:from-[#4a4a4a] dark:to-[#262626]',
        size >= 32 && 'shadow-md',
      )}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <rect x="6.5" y="2.5" width="11" height="19" rx="3" stroke="white" strokeOpacity="0.9" strokeWidth={size < 24 ? 2.2 : 1.6} />
        <circle cx="12" cy="8" r="1.6" fill="#ff5a5a" />
        {size >= 24 &&
          [0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              x={8.6 + i * 1.5}
              y={16 - [1, 2.5, 3.5, 2, 1.2][i]}
              width="0.9"
              height={[2, 5, 7, 4, 2.4][i]}
              rx="0.45"
              fill="white"
              fillOpacity="0.85"
            />
          ))}
      </svg>
    </span>
  );
}
