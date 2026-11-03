import type { ChartConfiguration } from 'chart.js';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type HospitalDashboard, type Option } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BAND_COLOR, ChartView, COLORS, grid, millions, SERIES } from '../lib/chart';
import { baht, CURRENT_BE_YEAR } from '../lib/format';
import { f1, FACTORS, RecChip, ScoreBadge, UtilChip } from '../lib/score';

const PRICE: [string, string, string?][] = [['', 'ทุกช่วงราคา'], ['1000000', '≥ 1 ล้านบาท'], ['1000000-5000000', '1–5 ล้านบาท'], ['5000000-20000000', '5–20 ล้านบาท'], ['20000000', '> 20 ล้านบาท']];
const LEVEL: [string, string][] = [['', 'ทุกระดับ'], ['high', '80–100'], ['good', '60–79'], ['medium', '40–59'], ['low', '< 40'], ['none', 'ยังไม่มีคะแนน']];
const latestYear = () => CURRENT_BE_YEAR - (new Date().getMonth() >= 9 ? 0 : 1);
const mb = (v: number) => (v / 1e6).toLocaleString('th-TH', { maximumFractionDigits: 1 });

export function Dashboard() {
  const { me } = useAuth();
  const central = me?.scope === 'all';
  const [params] = useSearchParams();
  const [year, setYear] = useState(latestYear());
  const [hospital, setHospital] = useState(params.get('hospitalId') ?? '');
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [price, setPrice] = useState('');
  const [level, setLevel] = useState('');
  const [hospitals, setHospitals] = useState<Option[]>([]);
  const [depts, setDepts] = useState<Option[]>([]);
  const [types, setTypes] = useState<Option[]>([]);
  const [d, setD] = useState<HospitalDashboard | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    api.get<Option[]>('/api/equipment-types').then(setTypes);
    if (central) api.get<Option[]>('/api/hospitals').then(setHospitals);
    else api.get<Option[]>('/api/departments').then(setDepts);
  }, [central]);
  useEffect(() => {
    const p = new URLSearchParams({ year: String(year) });
    if (hospital) p.set('hospitalId', hospital);
    if (dept) p.set('departmentId', dept);
    if (type) p.set('typeId', type);
    if (q) p.set('q', q);
    if (level) p.set('level', level);
    if (price) {
      const [a, b] = price.split('-');
      if (b) { p.set('minPrice', a!); p.set('maxPrice', b); } else if (a === '20000000') p.set('minPrice', '20000001'); else p.set('minPrice', a!);
    }
    let stale = false;
    const t = setTimeout(() => api.get<HospitalDashboard>(`/api/dashboard/hospital?${p}`).then((r) => {
      if (stale) return;
      setD(r);
      const s = r.equipment.filter((e) => e.utilityScore !== null);
      // ค่าเริ่มต้นของกราฟเปรียบเทียบ: คะแนนสูงสุด และต่ำสุด
      setPicked(s.length ? [...new Set([s[0]!.id, s[s.length - 1]!.id])] : []);
    }), 200);
    return () => { stale = true; clearTimeout(t); };
  }, [year, hospital, dept, type, q, price, level]);

  const scored = useMemo(() => (d?.equipment ?? []).filter((e) => e.utilityScore !== null), [d]);
  const years = d?.totals.map((t) => String(t.fiscalYear)) ?? [];
  const pickedEq = scored.filter((e) => picked.includes(e.id));

  const cfg = useMemo(() => {
    if (!d) return null;
    const lineFor = (key: 'utilizationPct' | 'downtimePct', label: string): ChartConfiguration => ({
      type: 'line',
      data: {
        labels: years,
        datasets: [
          { label: `${label} รวมทุกรายการ`, data: d.totals.map((t) => t[key]), borderColor: COLORS.navy, backgroundColor: COLORS.navy, borderWidth: 3, tension: 0.3, spanGaps: false },
          ...pickedEq.map((e, i) => ({ label: e.code, data: e.series.map((s) => s[key]), borderColor: SERIES[(i + 1) % SERIES.length], backgroundColor: SERIES[(i + 1) % SERIES.length], borderDash: [5, 4], tension: 0.3 })),
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
          datasets: pickedEq.map((e, i) => ({ label: `${e.code} ${e.name}`, data: FACTORS.map(([k]) => e.scores![k]), borderColor: SERIES[i % SERIES.length], backgroundColor: `${SERIES[i % SERIES.length]}22`, pointRadius: 3 })),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, picked]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? [...p.slice(1), id] : [...p, id]));
  const k = d?.kpis;
  const noData = d && !scored.length;
  // กราฟย้อนหลังใช้ข้อมูลรายปีที่ยืนยันแล้วเท่านั้น (ข้อมูลจากไฟล์ Excel เป็นค่าสะสม ไม่มีรายปี)
  const hasTrend = Boolean(d?.totals.some((t) => t.records > 0));
  const fromExcel = scored.filter((e) => e.source === 'excel').length;
  const noTrend = (
    <div className="empty" style={{ height: 220, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, fontSize: 13.5 }}>
      <b>ยังไม่มีข้อมูลรายปีที่ยืนยันแล้วในปีงบ {d?.window.from}–{d?.window.to}</b>
      <span>{fromExcel > 0 ? `ครุภัณฑ์ ${fromExcel} รายการใช้ข้อมูลสะสมจากไฟล์ Excel ซึ่งไม่แยกรายปี จึงแสดงเป็นแนวโน้มไม่ได้ · ` : ''}กราฟจะแสดงเมื่อกรอกข้อมูลรายปีและยืนยันแล้ว</span>
    </div>
  );

  return (
    <>
      <div className="card" style={{ padding: '14px 18px' }}>
        <div className="hrow" style={{ alignItems: 'flex-end' }}>
          <div className="fld" style={{ width: 130 }}><label htmlFor="fy">ปีงบประมาณ</label>
            <select id="fy" className="in" value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 5 }, (_, i) => latestYear() - i).map((y) => <option key={y}>{y}</option>)}</select></div>
          {central ? (
            <div className="fld" style={{ width: 220 }}><label htmlFor="hs">โรงพยาบาล</label>
              <select id="hs" className="in" value={hospital} onChange={(e) => setHospital(e.target.value)}><option value="">ทุกโรงพยาบาล</option>{hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
          ) : (
            <div className="fld" style={{ width: 200 }}><label htmlFor="dp">หน่วยงาน</label>
              <select id="dp" className="in" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">ทุกหน่วยงาน</option>{depts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          )}
          <div className="fld" style={{ width: 170 }}><label htmlFor="tp">ประเภทครุภัณฑ์</label>
            <select id="tp" className="in" value={type} onChange={(e) => setType(e.target.value)}><option value="">ทุกประเภท</option>{types.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div className="fld" style={{ width: 180 }}><label htmlFor="nm">ชื่อครุภัณฑ์</label>
            <input id="nm" className="in" placeholder="ค้นหาชื่อ / รหัส" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="fld" style={{ width: 160 }}><label htmlFor="pr">ช่วงราคาจัดซื้อ</label>
            <select id="pr" className="in" value={price} onChange={(e) => setPrice(e.target.value)}>{PRICE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="fld" style={{ width: 150 }}><label htmlFor="lv">ระดับ Utility Score</label>
            <select id="lv" className="in" value={level} onChange={(e) => setLevel(e.target.value)}>{LEVEL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div style={{ flex: 1 }} />
          {d && <span className="badge-v">ชุดสูตร v{d.formula.version} · ข้อมูลยืนยันแล้ว ปีงบ {d.window.from}–{d.window.to}</span>}
        </div>
      </div>

      {k && (
        <div className="kpis">
          <div className="kpi"><div className="l">จำนวนครุภัณฑ์ทั้งหมด</div><div className="v num">{k.equipment}</div><div className="muted">มีคะแนน {k.scored} รายการ</div></div>
          <div className="kpi"><div className="l">มูลค่าครุภัณฑ์รวม</div><div className="v num">{mb(k.totalValue)} <small style={{ fontSize: 14 }}>ล้านบาท</small></div></div>
          <div className="kpi"><div className="l">Utility Score เฉลี่ย</div><div className="v num">{f1(k.averageScore)}</div></div>
          <div className="kpi g"><div className="l">คะแนนสูง (≥ 80)</div><div className="v num">{k.high}</div><div className="muted">ควรพิจารณาซื้อเพิ่ม/อัปเกรด</div></div>
          <div className="kpi r"><div className="l">ควรพิจารณาทดแทน (&lt; 40)</div><div className="v num">{k.replace}</div></div>
          <div className="kpi w"><div className="l">ค่าบำรุงรักษารวม</div><div className="v num">{mb(k.maintenanceTotal)} <small style={{ fontSize: 14 }}>ล้านบาท</small></div><div className="muted">ปีงบ {d!.window.from}–{d!.window.to}</div></div>
        </div>
      )}

      {noData && <div className="card empty">ยังไม่มีครุภัณฑ์ที่มีคะแนนตามเงื่อนไขนี้ · คะแนนและกราฟจะแสดงเมื่อข้อมูลรายปีได้รับการยืนยัน (<Link to="/equipment">ไปที่ทะเบียนครุภัณฑ์เพื่อกรอกข้อมูลรายปี</Link>)</div>}

      {cfg && !noData && (
        <>
          <div className="dash-row r32">
            <div className="card"><h3>Utility Score แยกตามครุภัณฑ์</h3><div className="sub">สีตามเกณฑ์: เขียว ≥80 · น้ำเงิน 60–79 · เหลือง 40–59 · แดง &lt;40</div>
              <ChartView config={cfg.score} height={Math.max(220, scored.length * 30 + 40)} label="กราฟ Utility Score แยกตามครุภัณฑ์" /></div>
            <div className="card"><h3>เปรียบเทียบคะแนน 6 ปัจจัย</h3><div className="sub">เลือกได้สูงสุด 3 รายการจากตารางจัดอันดับ</div>
              <ChartView config={cfg.radar} height={300} label="กราฟเรดาร์เปรียบเทียบคะแนน 6 ปัจจัย" /></div>
          </div>
          <div className="dash-row r3">
            <div className="card"><h3>Utilization Rate ย้อนหลัง 5 ปี</h3><div className="sub">เส้นทึบ = รวมทุกรายการ (ถ่วงน้ำหนักชั่วโมง) · เส้นประ = รายการที่เลือก</div>{hasTrend ? <ChartView config={cfg.util} height={220} label="กราฟ Utilization ย้อนหลัง 5 ปี" /> : noTrend}</div>
            <div className="card"><h3>ค่าบำรุงรักษาย้อนหลัง 5 ปี</h3><div className="sub">บาท/ปี รวมทุกรายการ</div>{hasTrend ? <ChartView config={cfg.maint} height={220} label="กราฟค่าบำรุงรักษาย้อนหลัง 5 ปี" /> : noTrend}</div>
            <div className="card"><h3>Downtime ย้อนหลัง 5 ปี</h3><div className="sub">% ของชั่วโมงพร้อมใช้งาน</div>{hasTrend ? <ChartView config={cfg.down} height={220} label="กราฟ Downtime ย้อนหลัง 5 ปี" /> : noTrend}</div>
          </div>
          <div className="dash-row r32">
            <div className="card flush">
              <div style={{ padding: '16px 20px 6px' }}><h3>จัดอันดับครุภัณฑ์ตาม Utility Score</h3><div className="sub">ติ๊กเพื่อเปรียบเทียบในกราฟ (สูงสุด 3 รายการ) · อันดับคิดภายในโรงพยาบาล</div></div>
              <div className="tbl-wrap"><table className="tbl compact">
                <thead><tr><th></th><th className="c">อันดับ</th><th>ครุภัณฑ์</th>{central && <th>โรงพยาบาล</th>}<th className="c">Score</th><th>Utilization</th><th>ข้อเสนอแนะ</th></tr></thead>
                <tbody>{scored.map((e) => {
                  const u = e.scores!.utilization;
                  return (
                    <tr key={e.id}>
                      <td><input type="checkbox" aria-label={`เปรียบเทียบ ${e.code}`} checked={picked.includes(e.id)} onChange={() => toggle(e.id)} /></td>
                      <td className="c num">{e.rank}</td>
                      <td><Link to={`/equipment/${e.id}`} style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>{e.name}</Link><div className="muted">{e.code} · {e.department}</div></td>
                      {central && <td>{e.hospitalName}</td>}
                      <td className="c"><ScoreBadge v={e.utilityScore!} /></td>
                      <td><div className="hrow" style={{ gap: 6, flexWrap: 'nowrap' }}><div className="mini-bar" style={{ width: 70 }}><span style={{ width: `${Math.min(100, u)}%` }} /></div><span className="muted num">{f1(u)}%</span><UtilChip u={e.utilization} /></div></td>
                      <td><RecChip level={e.recommendation!} text={e.recommendationText!} /></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </div>
            <div className="card"><h3>รายได้เทียบกับค่าบำรุงรักษา</h3><div className="sub">บาท/ปี รวมทุกรายการ · ยังไม่รวมค่าเสื่อมราคา</div>{hasTrend ? <ChartView config={cfg.rev} height={300} label="กราฟรายได้เทียบค่าบำรุงรักษา" /> : noTrend}</div>
          </div>
        </>
      )}
      {d && d.equipment.some((e) => e.utilityScore === null) && (
        <div className="note">{d.equipment.filter((e) => e.utilityScore === null).length} รายการยังไม่มีคะแนน (ไม่มีข้อมูลที่ยืนยันแล้ว) · <Link to="/scores">ดูเหตุผลที่หน้าผลวิเคราะห์</Link></div>
      )}
      {d && <div className="muted">มูลค่าครุภัณฑ์ใช้ราคาจัดซื้อ {baht(d.kpis.totalValue)} บาท · กราฟใช้เฉพาะข้อมูลที่ยืนยันแล้ว · ปีที่ไม่มีข้อมูลแสดงเป็นช่องว่าง</div>}
    </>
  );
}
