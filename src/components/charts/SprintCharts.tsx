import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang, useT } from '@/lib/i18n';
import { formatAxisDate, formatRange, formatShortDate } from '@/lib/dates';
import type { BurndownPoint } from '@/lib/sprints';
import type { Sprint } from '@/lib/types';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** 0 / half / max ticks rounded to whole numbers, so the axis stays calm. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  if (max <= 4) return Array.from({ length: max + 1 }, (_, i) => i);
  const step = Math.ceil(max / 4);
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  if (out.at(-1)! < max) out.push(out.at(-1)! + step);
  return out;
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString();

/**
 * Sprint burndown: remaining work per day against the ideal pace.
 * Hover snaps a crosshair to the nearest day; a hidden table carries the same numbers.
 */
export function BurndownChart({ points, unit, scope, startDate }: { points: BurndownPoint[]; unit: 'points' | 'items'; scope: number; startDate: string }) {
  const t = useT();
  const lang = useLang();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const pad = { top: 12, right: 16, bottom: 26, left: 34 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = H - pad.top - pad.bottom;
  const days = points.length;
  const yTicks = ticks(Math.ceil(scope));
  const yMax = Math.max(1, yTicks.at(-1)!);
  const x = (i: number) => pad.left + (days ? (i / days) * w : 0);
  const y = (v: number) => pad.top + h - (v / yMax) * h;
  const unitLabel = t(unit === 'points' ? 'sprint.unit.points' : 'sprint.unit.items');

  // Index 0 is the sprint start (full scope); index d+1 is the end of day d.
  const series = useMemo(() => {
    const actual: [number, number][] = [[0, scope]];
    points.forEach((p, i) => p.actual !== undefined && actual.push([i + 1, p.actual]));
    return actual;
  }, [points, scope]);
  const last = series.at(-1)!;
  const line = series.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = series.length > 1 ? `${line} L${x(last[0]).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z` : '';
  const labelDays = days <= 1 ? [0] : [0, Math.floor(days / 2), days - 1];
  const hoverDate = hover === null ? undefined : hover === 0 ? startDate : points[hover - 1]?.date;
  const hoverIdeal = hover === null ? 0 : hover === 0 ? scope : points[hover - 1].ideal;
  const hoverActual = hover === null ? undefined : hover === 0 ? scope : points[hover - 1]?.actual;

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-2">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="6" aria-hidden>
            <line x1="1" y1="3" x2="15" y2="3" stroke="var(--chart-series)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t('sprint.remaining')}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="6" aria-hidden>
            <line x1="1" y1="3" x2="15" y2="3" stroke="var(--chart-reference)" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          {t('sprint.ideal')}
        </span>
        <span className="ml-auto text-fg-3">{unitLabel}</span>
      </div>
      <div ref={ref} className="relative" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={t('sprint.burndown')}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - rect.left - pad.left;
              setHover(Math.max(0, Math.min(days, Math.round((px / Math.max(1, w)) * days))));
            }}
            onPointerLeave={() => setHover(null)}
            className="block touch-none"
          >
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={pad.left} x2={pad.left + w} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth="1" />
                <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[11px] tabular-nums">
                  {v}
                </text>
              </g>
            ))}
            {labelDays.map((d) => (
              <text
                key={d}
                x={x(d + 1)}
                y={H - 6}
                textAnchor={d === 0 ? 'start' : d === days - 1 ? 'end' : 'middle'}
                className="fill-fg-3 text-[11px]"
              >
                {formatAxisDate(points[d]?.date, lang)}
              </text>
            ))}
            <line x1={x(0)} y1={y(scope)} x2={x(days)} y2={y(0)} stroke="var(--chart-reference)" strokeWidth="1.5" strokeDasharray="4 4" />
            {area && <path d={area} fill="var(--chart-series)" opacity="0.1" />}
            {series.length > 1 && (
              <path d={line} fill="none" stroke="var(--chart-series)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            )}
            <circle cx={x(last[0])} cy={y(last[1])} r="4" fill="var(--chart-series)" stroke="var(--bg)" strokeWidth="2" />
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} stroke="var(--text-4)" strokeWidth="1" />
                {hoverActual !== undefined && (
                  <circle cx={x(hover)} cy={y(hoverActual)} r="4" fill="var(--chart-series)" stroke="var(--bg)" strokeWidth="2" />
                )}
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-[140px] rounded-lg bg-elevated px-3 py-2 text-[12px] shadow-md"
            style={{ left: Math.min(Math.max(0, x(hover) + 10), width - 160) }}
          >
            <div className="mb-1 text-fg-3">{formatShortDate(hoverDate, lang)}</div>
            {hoverActual !== undefined && (
              <div className="flex items-center gap-2">
                <span className="h-[2px] w-3 rounded bg-[var(--chart-series)]" />
                <span className="font-semibold tabular-nums text-fg">{fmt(hoverActual)}</span>
                <span className="text-fg-3">{t('sprint.remaining')}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="h-0 w-3 border-t-[1.5px] border-dashed border-[var(--chart-reference)]" />
              <span className="font-semibold tabular-nums text-fg">{fmt(hoverIdeal)}</span>
              <span className="text-fg-3">{t('sprint.ideal')}</span>
            </div>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{t('sprint.burndown')}</caption>
        <thead>
          <tr>
            <th>{t('sprint.dates')}</th>
            <th>{t('sprint.remaining')}</th>
            <th>{t('sprint.ideal')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{p.actual ?? ''}</td>
              <td>{fmt(p.ideal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Items finished per completed sprint: one series, value on each cap, tooltip on hover. */
export function VelocityChart({ data }: { data: { sprint: Sprint; done: number }[] }) {
  const t = useT();
  const lang = useLang();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const pad = { top: 18, right: 8, bottom: 26, left: 8 };
  const w = Math.max(0, width - pad.left - pad.right);
  const h = H - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.done));
  const band = data.length ? w / data.length : 0;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => pad.top + h - (v / max) * h;
  const avg = data.length ? data.reduce((s, d) => s + d.done, 0) / data.length : 0;

  return (
    <figure className="m-0">
      <div ref={ref} className="relative" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={t('sprint.velocity')} className="block">
            <line x1={pad.left} x2={pad.left + w} y1={y(0)} y2={y(0)} stroke="var(--chart-grid)" strokeWidth="1" />
            {data.length > 1 && (
              <g>
                <line x1={pad.left} x2={pad.left + w} y1={y(avg)} y2={y(avg)} stroke="var(--chart-reference)" strokeWidth="1" strokeDasharray="4 4" />
                <text x={pad.left + w} y={y(avg) - 5} textAnchor="end" className="fill-fg-3 text-[11px]" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">
                  {t('sprint.avg', { n: Math.round(avg * 10) / 10 })}
                </text>
              </g>
            )}
            {data.map((d, i) => {
              const cx = pad.left + band * i + band / 2;
              const top = y(d.done);
              const bh = y(0) - top;
              const r = Math.min(4, bh);
              const path =
                bh > 0
                  ? `M${cx - barW / 2},${y(0)} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${y(0)} Z`
                  : '';
              return (
                <g key={d.sprint.id} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                  <rect x={cx - band / 2} y={pad.top} width={band} height={h + pad.bottom} fill="transparent" />
                  {path && <path d={path} fill="var(--chart-series)" opacity={hover === null || hover === i ? 1 : 0.55} className="transition-opacity" />}
                  <text x={cx} y={top - 6} textAnchor="middle" className="fill-fg-2 text-[11px] font-medium" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">
                    {d.done}
                  </text>
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-fg-3 text-[11px]">
                    {d.sprint.name.length > 12 ? `${d.sprint.name.slice(0, 11)}…` : d.sprint.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg bg-elevated px-3 py-2 text-[12px] shadow-md"
            style={{ left: Math.min(Math.max(0, pad.left + band * hover + band / 2 + 14), Math.max(0, width - 170)) }}
          >
            <div className="font-medium text-fg">{data[hover].sprint.name}</div>
            <div className="text-fg-3">
              {formatRange(data[hover].sprint.startDate, data[hover].sprint.endDate, lang)}
            </div>
            <div className="mt-1">
              <span className="font-semibold tabular-nums text-fg">{data[hover].done}</span>{' '}
              <span className="text-fg-3">{t('sprint.unit.items')}</span>
            </div>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{t('sprint.velocity')}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.sprint.id}>
              <td>{d.sprint.name}</td>
              <td>{d.done}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
