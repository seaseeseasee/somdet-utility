import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ScoreDetail, type ScoreList, type ScoreRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { baht, latestFiscalYear, num } from '../lib/format';
import { useOptions } from '../lib/useApi';
import { ADVICE_DISCLAIMER, f1, f2, FACTORS, RecChip, ScoreBadge, UtilChip, ValueChip, weightPct } from '../lib/score';

const LEVELS: [string, string][] = [['', 'ทุกระดับ'], ['high', '80–100 ซื้อเพิ่ม/อัปเกรด'], ['good', '60–79 คงสภาพ'], ['medium', '40–59 ทบทวนแผน'], ['low', '< 40 พิจารณาทดแทน']];

export function Breakdown({ equipmentId, year }: { equipmentId: string; year: number }) {
  const [d, setD] = useState<ScoreDetail | null>(null);
  useEffect(() => { setD(null); api.get<ScoreDetail>(`/api/equipment/${equipmentId}/score?year=${year}`).then(setD); }, [equipmentId, year]);
  if (!d) return <div className="muted">กำลังโหลด…</div>;
  if (d.outcome.status !== 'scored')
    return <div className="note">{d.outcome.problems.map((p) => <div key={p}>{p}</div>)}</div>;
  const b = d.outcome.breakdown;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="hrow"><span className="score big num" style={{ color: 'var(--navy)' }}>{f2(b.utilityScore)}</span><RecChip level={b.recommendation} text={b.recommendationText} /></div>
      {b.warning && <div className="note red" style={{ padding: '6px 10px' }}>ธงเตือน: Utilization &lt; 40% หรือ Score &lt; 50 (D-12)</div>}
      <div className="note" style={{ padding: '8px 10px' }}>
        <div className="hrow" style={{ gap: 6 }}><b>ข้อเสนอแนะด้านการใช้งาน</b><UtilChip u={d.utilization} />
          {d.utilization && <span className="muted num">Utilization {f2(Number(d.outcome.inputs.utilizationPct))}% ({d.utilization.range})</span>}</div>
        <div>{d.utilization?.advice ?? 'ไม่มีข้อมูล Utilization ที่ใช้จัดระดับได้'}</div>
        <div className="muted" style={{ fontSize: 12 }}>{ADVICE_DISCLAIMER}</div>
      </div>
      {d.assessment && (
        <div className="note" style={{ padding: '8px 10px' }}>
          <div className="hrow" style={{ gap: 6 }}><b>ผลประเมินความคุ้มค่า (เกณฑ์เสริม)</b><ValueChip a={d.assessment} /><span className="muted">คะแนนรวม {d.assessment.range}</span></div>
          <div>{d.assessment.advice}</div>
          {d.assessment.flags.map((f) => <div key={f.rule + f.text} className={f.severity === 'red' ? 'hint e' : 'muted'} style={{ fontSize: 13 }}>{f.severity === 'red' ? '⚑ ' : ''}{f.text}</div>)}
          {d.assessment.dimensions.filter((x) => x.status === 'low' || x.status === 'watch').map((x) => (
            <div key={x.key} style={{ fontSize: 13, marginTop: 4 }}>
              <span className={`chip ${x.status === 'low' ? 'r' : 'w'}`}>{x.label} {f1(x.score)} · {x.status === 'low' ? 'ต่ำ' : 'เฝ้าระวัง'}</span> {x.meaning} → {x.actions}
            </div>
          ))}
          {d.assessment.dimensions.some((x) => x.status === 'insufficient') && <div className="muted" style={{ fontSize: 13 }}>Financial: ข้อมูลไม่เพียงพอ (ไม่ประเมินรายมิติ)</div>}
          <div className="muted" style={{ fontSize: 12 }}>เกณฑ์เสริม: คะแนนรวม ≥ 80 / 65–79 / 50–64 / &lt; 50 · รายมิติต่ำ &lt; 50, เฝ้าระวัง 50–59 · ไม่แสดงในรายงานผู้บริหาร</div>
        </div>
      )}
      {FACTORS.map(([k, label]) => (
        <div className="calc-line" key={k}>
          <span>{label} Score <span className="muted">× {d.weights[k]}</span></span>
          <b className="num">{f2(b.scores[k])} → {f2(b.weighted[k])}</b>
        </div>
      ))}
      <div className="stack" style={{ gap: 2 }}>
        <b style={{ fontSize: 13 }}>วิธีคำนวณ</b>
        {b.explanation.map((l) => <div key={l} className="f" style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'ui-monospace, Menlo, monospace' }}>{l}</div>)}
      </div>
      <div className="note blue" style={{ fontSize: 12.5 }}>
        {d.outcome.source === 'excel'
          ? <>ข้อมูลที่ใช้: ข้อมูลสะสมจากไฟล์ Excel {d.outcome.imported ? `"${d.outcome.imported.filename}"` : ''} (ใช้จนกว่าจะมีข้อมูลรายปีที่ยืนยันแล้ว)</>
          : <>ข้อมูลที่ใช้: ปีงบ {d.outcome.years.join(', ')} (ยืนยันแล้ว) · ชุดสูตร v{b.formulaVersion}</>}
        {d.rank && <> · อันดับ {d.rank} จาก {d.rankOf} ในโรงพยาบาล</>}
      </div>
      <Link className="btn sm" to={`/equipment/${equipmentId}`}>ดูรายละเอียดและข้อมูลรายปี</Link>
    </div>
  );
}

export function Scores() {
  const { me } = useAuth();
  const central = me?.scope === 'all';
  const latest = latestFiscalYear();
  const [year, setYear] = useState(latest);
  const [dept, setDept] = useState('');
  const [hospital, setHospital] = useState('');
  const [level, setLevel] = useState('');
  const opts = useOptions(central ? '/api/hospitals' : '/api/departments');
  const [data, setData] = useState<ScoreList | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams({ year: String(year) });
    if (dept) p.set('departmentId', dept);
    if (hospital) p.set('hospitalId', hospital);
    api.get<ScoreList>(`/api/scores?${p}`).then((d) => { setData(d); setSel((s) => s ?? d.rows.find((r) => r.status === 'scored')?.equipment.id ?? null); });
  }, [year, dept, hospital]);

  const scored = useMemo(() => (data?.rows ?? []).filter((r) => r.status === 'scored' && (!level || r.recommendation === level)), [data, level]);
  const notScored = (data?.rows ?? []).filter((r) => r.status !== 'scored');
  const years = Array.from({ length: 5 }, (_, i) => latest - i);
  const s = data?.summary;
  const selRow = scored.find((r) => r.equipment.id === sel) ?? null;

  return (
    <>
      <div className="card hrow between" style={{ padding: '14px 18px' }}>
        <div className="hrow" style={{ alignItems: 'flex-end' }}>
          <div className="fld" style={{ width: 200 }}><label htmlFor="yr">ปีที่วิเคราะห์ (ปีงบ)</label>
            <select id="yr" className="in" value={year} onChange={(e) => { setYear(Number(e.target.value)); setSel(null); }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select></div>
          {central ? (
            <div className="fld" style={{ width: 240 }}><label htmlFor="hs">โรงพยาบาล</label>
              <select id="hs" className="in" value={hospital} onChange={(e) => setHospital(e.target.value)}><option value="">ทุกโรงพยาบาล</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          ) : (
            <div className="fld" style={{ width: 220 }}><label htmlFor="dp">หน่วยงาน</label>
              <select id="dp" className="in" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">ทุกหน่วยงาน</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          )}
          <div className="fld" style={{ width: 220 }}><label htmlFor="lv">ระดับคะแนน</label>
            <select id="lv" className="in" value={level} onChange={(e) => setLevel(e.target.value)}>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        {data && <span className="badge-v">ชุดสูตร v{data.formula.version} · ข้อมูลปีงบ {data.window.from}–{data.window.to} ที่ยืนยันแล้ว</span>}
      </div>

      {s && (
        <div className="kpis">
          <div className="kpi"><div className="l">มีคะแนน</div><div className="v num">{s.scored}<small style={{ fontSize: 14, color: 'var(--ink-3)' }}> / {s.total}</small></div></div>
          <div className="kpi"><div className="l">Utility Score เฉลี่ย</div><div className="v num">{f1(s.average)}</div></div>
          <div className="kpi g"><div className="l">80–100 ซื้อเพิ่ม/อัปเกรด</div><div className="v num">{s.high}</div></div>
          <div className="kpi"><div className="l">60–79 คงสภาพ</div><div className="v num">{s.good}</div></div>
          <div className="kpi w"><div className="l">40–59 ทบทวนแผน</div><div className="v num">{s.medium}</div></div>
          <div className="kpi r"><div className="l">&lt; 40 พิจารณาทดแทน</div><div className="v num">{s.low}</div></div>
        </div>
      )}

      <div className="split scores">
        <div className="card flush">
          <div className="tbl-wrap">
            <table className="tbl compact">
              <thead><tr>
                <th className="c">อันดับ</th><th>ครุภัณฑ์</th>
                <th className="r">ปีที่ใช้<br />งานแล้ว</th><th className="r">ค่าบำรุงรักษา<br />สะสม (บาท)</th>
                {FACTORS.map(([k, l]) => <th key={k} className="r">{l}<br /><span className="muted">{weightPct(data?.weights[k])}</span></th>)}
                <th className="r">ต้นทุน<br />ต่อเคส (บาท)</th><th className="r">Payback<br />(ปี)</th><th className="c">Utility<br />Score</th><th>ข้อเสนอแนะ</th><th>ระดับการใช้งาน</th><th>ความคุ้มค่า<br /><span className="muted">(เกณฑ์เสริม)</span></th>
              </tr></thead>
              <tbody>
                {scored.map((r: ScoreRow) => (
                  <tr key={r.equipment.id} className={`click ${sel === r.equipment.id ? 'sel' : ''}`} onClick={() => setSel(r.equipment.id)}>
                    <td className="c num">{r.rank}</td>
                    <td style={{ minWidth: 170 }}>
                      <div style={{ fontWeight: 600 }}>{r.equipment.name}{r.warning && <span className="chip r" style={{ marginLeft: 6 }} title="Utilization < 40% หรือ Score < 50">เตือน</span>}
                        {r.source === 'excel' && <span className="chip n" style={{ marginLeft: 6 }} title="คะแนนจากข้อมูลสะสมในไฟล์ Excel จนกว่าจะมีข้อมูลรายปีที่ยืนยันแล้ว">จากไฟล์ Excel</span>}</div>
                      <div className="muted">{r.equipment.code} · {central ? r.equipment.hospitalName : r.equipment.department}</div>
                    </td>
                    <td className="r num">{r.ageYears ?? '—'}</td>
                    <td className="r num">{num(r.maintenanceCost)}</td>
                    {FACTORS.map(([k]) => <td key={k} className="r num">{f1(r.scores?.[k])}</td>)}
                    <td className="r num">{r.costPerCase === null || r.costPerCase === undefined ? <span className="muted">N/A</span> : num(r.costPerCase, 2)}</td>
                    <td className="r num">{r.paybackYears === null ? <span className="muted">N/A</span> : f2(r.paybackYears)}</td>
                    <td className="c" title={r.recommendationText}><ScoreBadge v={r.utilityScore!} /></td>
                    <td style={{ minWidth: 150, fontSize: 13 }}>{r.recommendationText}</td>
                    <td><UtilChip u={r.utilization} /></td>
                    <td><ValueChip a={r.assessment} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && !scored.length && <div className="empty">ยังไม่มีครุภัณฑ์ที่มีคะแนนตามเงื่อนไขนี้ · คะแนนจะคำนวณเมื่อข้อมูลรายปีได้รับการยืนยัน</div>}
          <div className="hrow between" style={{ padding: '12px 16px' }}>
            <div className="legend">
              <span><i style={{ background: 'var(--good)' }} />80–100 ประสิทธิภาพสูงมาก</span><span><i style={{ background: 'var(--blue-2)' }} />60–79 ดี</span>
              <span><i style={{ background: '#e0a100' }} />40–59 ปานกลาง</span><span><i style={{ background: 'var(--bad)' }} />&lt; 40 ต่ำ</span>
            </div>
            <span className="muted">สีของคะแนนบอกระดับข้อเสนอแนะ · อันดับคิดภายในแต่ละโรงพยาบาล (RANK) · คลิกแถวเพื่อดูที่มาของคะแนน</span>
          </div>
        </div>
        <div className="card stack sticky">
          <h3>ที่มาของคะแนน</h3>
          {selRow ? (
            <>
              <div><b>{selRow.equipment.name}</b><div className="muted">{selRow.equipment.code} · ซื้อปี {selRow.equipment.purchaseYear} · {baht(selRow.equipment.purchasePrice)} บาท</div></div>
              <Breakdown equipmentId={selRow.equipment.id} year={data!.year} />
            </>
          ) : <div className="muted">เลือกครุภัณฑ์จากตาราง</div>}
        </div>
      </div>

      {notScored.length > 0 && (
        <div className="card flush">
          <div style={{ padding: '16px 20px 6px' }}><h3>ยังคำนวณคะแนนไม่ได้ ({notScored.length} รายการ)</h3>
            <div className="sub">ระบบไม่ให้คะแนนเมื่อไม่มีข้อมูลที่ยืนยันแล้ว หรือข้อมูลไม่ครบ (D-08)</div></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>ครุภัณฑ์</th>{central && <th>โรงพยาบาล</th>}<th>เหตุผล</th><th></th></tr></thead>
            <tbody>
              {notScored.map((r) => (
                <tr key={r.equipment.id}>
                  <td><div style={{ fontWeight: 600 }}>{r.equipment.name}</div><div className="code">{r.equipment.code}</div></td>
                  {central && <td>{r.equipment.hospitalName}</td>}
                  <td className="muted">{r.problems?.slice(0, 2).join(' · ')}</td>
                  <td><Link className="btn sm" to={`/equipment/${r.equipment.id}`}>ดูข้อมูลรายปี</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </>
  );
}
