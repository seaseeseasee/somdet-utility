import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type NetworkDashboard } from '../lib/api';
import { latestFiscalYear as latestYear, mb } from '../lib/format';
import { f1, ScoreBadge } from '../lib/score';

const short = (n: string) => n.replace('โรงพยาบาล', 'รพ.');

/** สีช่องตาราง: ยิ่งเข้มยิ่งมีข้อมูลมาก (สีน้ำเงินไล่ระดับ) */
const pctCell = (v: number | null) =>
  v === null ? { background: '#f7f8fa', color: '#a0aaba' } : v === 0 ? { background: '#f2f4f7', color: '#8a96a8' }
    : { background: `rgba(21,89,181,${(0.12 + 0.78 * (v / 100)).toFixed(2)})`, color: v >= 55 ? '#fff' : '#0a2e5c' };
const countCell = (v: number) => (!v ? { background: '#f2f4f7', color: '#a0aaba' } : { background: `rgba(21,89,181,${(0.15 + 0.15 * Math.min(v, 5)).toFixed(2)})`, color: v >= 3 ? '#fff' : '#0a2e5c' });

export function Network() {
  const [year, setYear] = useState(latestYear());
  const [province, setProvince] = useState('');
  const [type, setType] = useState('');
  const [d, setD] = useState<NetworkDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams({ year: String(year) });
    if (province) p.set('province', province);
    if (type) p.set('typeId', type);
    let stale = false;
    api.get<NetworkDashboard>(`/api/dashboard/network?${p}`).then((r) => !stale && setD(r), (e: Error) => setErr(e.message));
    return () => { stale = true; };
  }, [year, province, type]);

  if (err) return <div className="note red">{err}</div>;
  const k = d?.kpis;
  const follow = (d?.hospitals ?? []).flatMap((h) => h.followUps.map((f) => ({ ...f, hospital: h.hospital.name }))).sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));

  return (
    <>
      <div className="card" style={{ padding: '14px 18px' }}>
        <div className="hrow" style={{ alignItems: 'flex-end' }}>
          <div className="fld" style={{ width: 140 }}><label htmlFor="fy">ปีงบประมาณ</label>
            <select id="fy" className="in" value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 5 }, (_, i) => latestYear() - i).map((y) => <option key={y}>{y}</option>)}</select></div>
          <div className="fld" style={{ width: 200 }}><label htmlFor="pv">จังหวัด</label>
            <select id="pv" className="in" value={province} onChange={(e) => setProvince(e.target.value)}><option value="">ทั้งหมด</option>{d?.provinces.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="fld" style={{ width: 200 }}><label htmlFor="tp">ประเภทครุภัณฑ์</label>
            <select id="tp" className="in" value={type} onChange={(e) => setType(e.target.value)}><option value="">ทุกประเภท</option>{d?.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div style={{ flex: 1 }} />
          {d && <span className="badge-v">ชุดสูตร v{d.formula.version} · ใช้เฉพาะข้อมูลที่ยืนยันแล้ว</span>}
        </div>
      </div>

      {k && (
        <div className="kpis">
          <div className="kpi"><div className="l">โรงพยาบาลที่ส่งข้อมูลปี {d!.year}</div><div className="v num">{k.hospitalsReporting}<small style={{ fontSize: 14 }}> / {k.hospitals} แห่ง</small></div><div className="muted">มีรายการยืนยันแล้วอย่างน้อย 1</div></div>
          <div className="kpi"><div className="l">ครุภัณฑ์ทั้งหมด</div><div className="v num">{k.equipment}</div></div>
          <div className="kpi"><div className="l">มูลค่ารวม</div><div className="v num">{mb(k.totalValue)} <small style={{ fontSize: 14 }}>ล้านบาท</small></div></div>
          <div className="kpi g"><div className="l">ข้อมูลปี {d!.year} ยืนยันแล้ว</div><div className="v num">{k.confirmedPct}%</div><div className="muted">{k.confirmedThisYear} จาก {k.equipment} รายการ</div></div>
          <div className="kpi"><div className="l">Utility Score เฉลี่ยเครือข่าย</div><div className="v num">{f1(k.averageScore)}</div><div className="muted">จาก {k.scored} รายการที่มีคะแนน</div></div>
          <div className="kpi r"><div className="l">ควรพิจารณาทดแทน (&lt; 40)</div><div className="v num">{k.replace}</div></div>
        </div>
      )}

      {d && (
        <div className="card flush">
          <div style={{ padding: '16px 20px 4px' }}>
            <h3>สรุปรายโรงพยาบาล</h3>
            <div className="legend" style={{ marginTop: 4 }}>
              <span>ความคืบหน้า:</span><span><i style={{ background: 'var(--good)' }} />ยืนยัน</span><span><i style={{ background: 'var(--sky)' }} />กำลังบันทึก</span><span><i style={{ background: '#c9d2de' }} />ยังไม่เริ่ม</span>
              <span style={{ marginLeft: 12 }}>ระดับคะแนน:</span><span><i style={{ background: 'var(--good)' }} />≥80</span><span><i style={{ background: 'var(--blue-2)' }} />60–79</span><span><i style={{ background: '#e0a100' }} />40–59</span><span><i style={{ background: 'var(--bad)' }} />&lt;40</span><span><i className="na" style={{ background: 'repeating-linear-gradient(45deg,#e1e7ef 0 3px,#f4f6f9 3px 6px)' }} />ไม่มีคะแนน</span>
            </div>
          </div>
          <div className="tbl-wrap"><table className="tbl compact">
            <thead><tr><th>โรงพยาบาล</th><th className="r">ครุภัณฑ์</th><th className="r">มูลค่า (ลบ.)</th><th>ข้อมูลปี {d.year}</th><th className="c">Score เฉลี่ย</th><th>ระดับคะแนน</th><th></th></tr></thead>
            <tbody>{d.hospitals.map((h) => {
              const p = h.progress;
              const dist = h.distribution;
              return (
                <tr key={h.hospital.id}>
                  <td style={{ minWidth: 180 }}><div style={{ fontWeight: 600 }}>{h.hospital.name}</div><div className="muted">{h.hospital.province ?? '—'} · {h.hospital.hcode}</div></td>
                  <td className="r num">{h.equipment}</td>
                  <td className="r num">{mb(h.totalValue)}</td>
                  <td style={{ minWidth: 170 }}>
                    <div className="stackbar" aria-label={`ยืนยัน ${p.approved} จาก ${p.total}`}>
                      {([['var(--good)', p.approved], ['var(--sky)', p.inProgress], ['#c9d2de', p.notStarted]] as [string, number][]).map(([c, v], i) => <span key={i} style={{ width: `${p.total ? (v / p.total) * 100 : 0}%`, background: c }} />)}
                    </div>
                    <div className="muted num">ยืนยัน {p.approved}/{p.total}</div>
                  </td>
                  <td className="c">{h.averageScore !== null ? <ScoreBadge v={h.averageScore} /> : '—'}</td>
                  <td style={{ minWidth: 150 }}>
                    <div className="stackbar">
                      {([['var(--good)', dist.high], ['var(--blue-2)', dist.good], ['#e0a100', dist.medium], ['var(--bad)', dist.low]] as [string, number][]).map(([c, v], i) => <span key={i} style={{ width: `${h.equipment ? (v / h.equipment) * 100 : 0}%`, background: c }} />)}
                      <span className="na" style={{ width: `${h.equipment ? (h.notScored / h.equipment) * 100 : 0}%` }} />
                    </div>
                    <div className="muted num">{dist.high} / {dist.good} / {dist.medium} / {dist.low}{h.notScored ? ` · ไม่มีคะแนน ${h.notScored}` : ''}</div>
                  </td>
                  <td><Link className="btn sm" to={`/dashboard?hospitalId=${h.hospital.id}`}>เปิด Dashboard</Link></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </div>
      )}

      {d && (
        <>
          <div className="dash-row r2">
            <div className="card"><h3>แต่ละโรงพยาบาลมีครุภัณฑ์ประเภทใด</h3><div className="sub">จำนวนรายการแยกตามประเภท</div>
              <div className="tbl-wrap"><table className="tbl hm">
                <thead><tr><th>โรงพยาบาล</th>{d.types.map((t) => <th key={t.id} className="c">{t.name}</th>)}</tr></thead>
                <tbody>{d.hospitals.map((h) => <tr key={h.hospital.id}><td style={{ whiteSpace: 'nowrap' }}>{short(h.hospital.name)}</td>{d.types.map((t) => <td key={t.id} className="cell" style={countCell(h.types[t.id] ?? 0)}>{h.types[t.id] ?? 0}</td>)}</tr>)}</tbody>
              </table></div></div>
            <div className="card"><h3>ความครบถ้วนของข้อมูลแต่ละหมวด (ปี {d.year})</h3><div className="sub">% ของครุภัณฑ์ที่กรอกหมวดนั้น · ช่องจาง = ข้อมูลน้อย</div>
              <div className="tbl-wrap"><table className="tbl hm">
                <thead><tr><th>โรงพยาบาล</th>{d.completenessGroups.map((g) => <th key={g} className="c">{g}</th>)}</tr></thead>
                <tbody>{d.hospitals.map((h) => <tr key={h.hospital.id}><td style={{ whiteSpace: 'nowrap' }}>{short(h.hospital.name)}</td>{d.completenessGroups.map((g) => <td key={g} className="cell" style={pctCell(h.completeness[g] ?? 0)}>{h.completeness[g] ?? 0}%</td>)}</tr>)}</tbody>
              </table></div></div>
          </div>
          <div className="dash-row r2">
            <div className="card"><h3>ข้อมูลย้อนหลังที่มีในระบบ</h3><div className="sub">% ของครุภัณฑ์ที่มีข้อมูลยืนยันแล้ว แยกตามปีงบ · “—” = ยังไม่มีครุภัณฑ์ในปีนั้น</div>
              <div className="tbl-wrap"><table className="tbl hm">
                <thead><tr><th>โรงพยาบาล</th>{(d.hospitals[0]?.coverage ?? []).map((c) => <th key={c.fiscalYear} className="c">{c.fiscalYear}</th>)}</tr></thead>
                <tbody>{d.hospitals.map((h) => <tr key={h.hospital.id}><td style={{ whiteSpace: 'nowrap' }}>{short(h.hospital.name)}</td>{h.coverage.map((c) => <td key={c.fiscalYear} className="cell" style={pctCell(c.pct)}>{c.pct === null ? '—' : `${c.pct}%`}</td>)}</tr>)}</tbody>
              </table></div></div>
            <div className="card stack"><h3>สิ่งที่ควรติดตาม</h3>
              {!follow.length && <div className="note blue">ไม่มีรายการที่ต้องติดตาม</div>}
              {follow.slice(0, 10).map((f, i) => <div key={i} className={`note ${f.level === 'red' ? 'red' : ''}`}><b>{short(f.hospital)}</b> · {f.text}</div>)}
              {follow.length > 10 && <div className="muted">และอีก {follow.length - 10} รายการ</div>}
              <div className="note blue" style={{ fontSize: 12.5 }}>รายการนี้มาจากกฎความครบถ้วนของข้อมูล (เช่น หมวดที่กรอกต่ำกว่า 50% หรือยังยืนยันไม่ครบ) ไม่ได้มาจากสูตร Utility Score</div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
