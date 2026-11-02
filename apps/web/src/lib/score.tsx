import type { FactorScores } from './api';

export const BAND: Record<string, string> = { high: 'g', good: 'b', medium: 'w', low: 'r' };
export const bandOf = (v: number) => (v >= 80 ? 'high' : v >= 60 ? 'good' : v >= 40 ? 'medium' : 'low');
export const FACTORS: [keyof FactorScores, string, number][] = [
  ['utilization', 'Utilization', 0.25], ['clinical', 'Clinical', 0.2], ['financial', 'Financial', 0.2],
  ['reliability', 'Reliability', 0.15], ['satisfaction', 'Satisfaction', 0.1], ['strategic', 'Strategic', 0.1],
];
export const f1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const f2 = (v: number | null | undefined) => (v === null || v === undefined ? 'N/A' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function ScoreBadge({ v }: { v: number }) {
  return <span className={`score ${BAND[bandOf(v)]} num`}>{f1(v)}</span>;
}
export function RecChip({ level, text }: { level?: string; text?: string }) {
  return level ? <span className={`chip ${BAND[level]}`}>{text}</span> : null;
}
