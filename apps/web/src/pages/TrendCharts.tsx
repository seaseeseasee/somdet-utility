import type { ChartConfiguration } from 'chart.js';
import { useMemo } from 'react';
import type { ScoreDetail } from '../lib/api';
import { ChartView, COLORS, grid, millions } from '../lib/chart';
import { FACTORS } from '../lib/score';

/** กราฟแนวโน้มย้อนหลัง 5 ปีของครุภัณฑ์ 1 รายการ (ใช้เฉพาะปีที่ยืนยันแล้ว) */
export function TrendCharts({ s }: { s: ScoreDetail }) {
  const c = useMemo(() => {
    const years = Array.from({ length: s.window.to - s.window.from + 1 }, (_, i) => s.window.from + i);
    const at = (fy: number) => s.annual.find((a) => a.fiscalYear === fy && a.confirmed);
    const labels = years.map(String);
    const yPct = { ...grid, beginAtZero: true, ticks: { callback: (v: number | string) => `${v}%` } };
    return {
      use: {
        type: 'line',
        data: { labels, datasets: [
          { label: 'Utilization', data: years.map((y) => at(y)?.metrics?.utilizationPctHours ?? null), borderColor: COLORS.navy, backgroundColor: COLORS.navy, tension: 0.3 },
          { label: 'Downtime', data: years.map((y) => at(y)?.metrics?.downtimePct ?? null), borderColor: COLORS.bad, backgroundColor: COLORS.bad, tension: 0.3 },
        ] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { y: yPct, x: { grid: { display: false } } } },
      } as ChartConfiguration,
      money: {
        type: 'bar',
        data: { labels, datasets: [
          { label: 'รายได้', data: years.map((y) => at(y)?.revenue ?? null), backgroundColor: COLORS.good, borderRadius: 4 },
          { label: 'ค่าบำรุงรักษา', data: years.map((y) => at(y)?.metrics?.maintenanceCost ?? null), backgroundColor: COLORS.warn, borderRadius: 4 },
        ] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { ...grid, beginAtZero: true, ticks: { callback: millions } }, x: { grid: { display: false } } } },
      } as ChartConfiguration,
      score: {
        type: 'line',
        data: { labels, datasets: [{ label: 'Score รายปี', data: years.map((y) => at(y)?.annualScore ?? null), borderColor: COLORS.mid, backgroundColor: COLORS.mid, tension: 0.3 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { ...grid, min: 0, max: 100 }, x: { grid: { display: false } } } },
      } as ChartConfiguration,
      radar:
        s.outcome.status === 'scored'
          ? ({
              type: 'radar',
              data: { labels: FACTORS.map((f) => f[1]), datasets: [{ label: 'คะแนน', data: FACTORS.map(([k]) => (s.outcome.status === 'scored' ? s.outcome.breakdown.scores[k] : 0)), borderColor: COLORS.navy, backgroundColor: '#1559b522', pointRadius: 3 }] },
              options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, backdropColor: 'transparent' }, grid: { color: COLORS.grid }, angleLines: { color: COLORS.grid } } } },
            } as ChartConfiguration)
          : null,
    };
  }, [s]);
  return (
    <div className="dash-row r2">
      <div className="card"><h3>Utilization และ Downtime</h3><div className="sub">ปีงบ {s.window.from}–{s.window.to} · เฉพาะปีที่ยืนยันแล้ว</div><ChartView config={c.use} height={200} label="กราฟ Utilization และ Downtime รายปี" /></div>
      <div className="card"><h3>รายได้เทียบค่าบำรุงรักษา</h3><div className="sub">บาท/ปี</div><ChartView config={c.money} height={200} label="กราฟรายได้เทียบค่าบำรุงรักษารายปี" /></div>
      <div className="card"><h3>Score รายปี</h3><div className="sub">ใช้ข้อมูลปีเดียว เพื่อดูแนวโน้ม (D-02)</div><ChartView config={c.score} height={200} label="กราฟ Score รายปี" /></div>
      {c.radar && <div className="card"><h3>คะแนน 6 ปัจจัย</h3><div className="sub">ณ ปีงบ {s.year}</div><ChartView config={c.radar} height={200} label="กราฟเรดาร์คะแนน 6 ปัจจัย" /></div>}
    </div>
  );
}
