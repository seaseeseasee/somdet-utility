import type { ChartConfiguration } from 'chart.js';
import type { HospitalDashboard } from '../lib/api';
import { BAND_COLOR, COLORS, grid, millions, SERIES } from '../lib/chart';
import { FACTORS } from '../lib/score';

type Eq = HospitalDashboard['equipment'][number];

/** ตั้งค่ากราฟทั้งหมดของแดชบอร์ด: scored = รายการที่มีคะแนน, picked = รายการที่เลือกเปรียบเทียบ (สูงสุด 3) */
export function buildDashboardCharts(d: HospitalDashboard, scored: Eq[], picked: Eq[]) {
  const years = d.totals.map((t) => String(t.fiscalYear));
  const lineFor = (key: 'utilizationPct' | 'downtimePct', label: string): ChartConfiguration => ({
    type: 'line',
    data: {
      labels: years,
      datasets: [
        { label: `${label} รวมทุกรายการ`, data: d.totals.map((t) => t[key]), borderColor: COLORS.navy, backgroundColor: COLORS.navy, borderWidth: 3, tension: 0.3, spanGaps: false },
        ...picked.map((e, i) => ({ label: e.code, data: e.series.map((s) => s[key]), borderColor: SERIES[(i + 1) % SERIES.length], backgroundColor: SERIES[(i + 1) % SERIES.length], borderDash: [5, 4], tension: 0.3 })),
      ],
    },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { ...grid, beginAtZero: true, ticks: { callback: (v) => `${v}%` } }, x: { grid: { display: false } } } },
  });
  return {
    score: {
      type: 'bar',
      data: { labels: scored.map((e) => e.name), datasets: [{ data: scored.map((e) => e.utilityScore), backgroundColor: scored.map((e) => BAND_COLOR[e.recommendation!]), borderRadius: 5, barThickness: 18 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ...grid, min: 0, max: 100 }, y: { grid: { display: false } } } },
    } as ChartConfiguration,
    radar: {
      type: 'radar',
      data: {
        labels: FACTORS.map((f) => f[1]),
        datasets: picked.map((e, i) => ({ label: `${e.code} ${e.name}`, data: FACTORS.map(([k]) => e.scores![k]), borderColor: SERIES[i % SERIES.length], backgroundColor: `${SERIES[i % SERIES.length]}22`, pointRadius: 3 })),
      },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, backdropColor: 'transparent' }, grid: { color: COLORS.grid }, angleLines: { color: COLORS.grid } } } },
    } as ChartConfiguration,
    util: lineFor('utilizationPct', 'Utilization'),
    down: lineFor('downtimePct', 'Downtime'),
    maint: {
      type: 'bar',
      data: { labels: years, datasets: [{ label: 'ค่าบำรุงรักษารวม', data: d.totals.map((t) => t.maintenanceCost), backgroundColor: COLORS.warn, borderRadius: 4 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ...grid, beginAtZero: true, ticks: { callback: millions } }, x: { grid: { display: false } } } },
    } as ChartConfiguration,
    rev: {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          { label: 'รายได้', data: d.totals.map((t) => t.revenue), backgroundColor: COLORS.good, borderRadius: 4 },
          { label: 'ค่าบำรุงรักษา', data: d.totals.map((t) => t.maintenanceCost), backgroundColor: COLORS.warn, borderRadius: 4 },
        ],
      },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { ...grid, beginAtZero: true, ticks: { callback: millions } }, x: { grid: { display: false } } } },
    } as ChartConfiguration,
  };
}
