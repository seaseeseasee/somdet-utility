import { Chart, registerables, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'react';

Chart.register(...registerables);
Chart.defaults.font.family = "'IBM Plex Sans Thai', 'Sarabun', sans-serif";
Chart.defaults.font.size = 12.5;
Chart.defaults.color = '#4a5a72';
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.labels.boxWidth = 12;

export const COLORS = { good: '#1b8a55', mid: '#2f7bd8', warn: '#e0a100', bad: '#c2302b', navy: '#0a2e5c', sky: '#5ba8e8', grid: '#e8eef5' };
export const SERIES = ['#1559b5', '#e0a100', '#1b8a55', '#c2302b', '#7a5ab8', '#5ba8e8'];
export const BAND_COLOR: Record<string, string> = { high: COLORS.good, good: COLORS.mid, medium: COLORS.warn, low: COLORS.bad };
export const grid = { grid: { color: COLORS.grid }, border: { display: false } };
export const millions = (v: number | string) => {
  const n = Number(v);
  return Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString('th-TH', { maximumFractionDigits: 1 })}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
};

/** แสดงกราฟ Chart.js — สร้างใหม่เมื่อข้อมูลเปลี่ยน และทำลายเมื่อออกจากหน้า */
export function ChartView({ config, height = 240, label }: { config: ChartConfiguration; height?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = new Chart(ref.current, config);
    return () => c.destroy();
  }, [config]);
  return (
    <div style={{ position: 'relative', height }}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}
