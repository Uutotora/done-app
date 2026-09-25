import type { Rice } from './types';

export const IMPACT_VALUES = [0.25, 0.5, 1, 2, 3] as const;
export const CONFIDENCE_VALUES = [20, 50, 80, 100] as const;

/** RICE = Reach × Impact × Confidence / Effort. Returns undefined when not scorable. */
export function riceScore(r?: Rice): number | undefined {
  if (!r) return undefined;
  const { reach, impact, confidence, effort } = r;
  if (!(reach > 0) || !(impact > 0) || !(confidence > 0) || !(effort > 0)) return undefined;
  return Math.round((reach * impact * (confidence / 100)) / effort);
}

export function formatScore(n?: number): string {
  if (n == null) return '';
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
