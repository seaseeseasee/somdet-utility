import { useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type FactorScores } from '../lib/api';
import { useAuth } from '../lib/auth';
import { num, thDate } from '../lib/format';
import { useOptions } from '../lib/useApi';
import { ScoreBadge } from '../lib/score';
import { ImportHistory } from './ImportHistory';

type Status = 'ok' | 'warning' | 'incomplete' | 'error';
interface PRow {
  sourceRow: number; seqNo: number; name: string; status: Status; register: boolean; errors: string[]; warnings: string[]; missing: string[];
  utilityScore: number | null; rank: number | null; recommendation: string | null; paybackYears: number | null;
  /** E, N, P–U ที่ระบบคำนวณ (null = แถวนี้ไม่มีคะแนน) */
  ageYears: number | null; costPerCase: number | null; scores: FactorScores | null;
  input: Record<string, number | null>;
}
interface PSheet { sheet: string; title: string; isExample: boolean; selected: boolean; rows: PRow[]; summary: Record<Status, number> }
interface Preview {
  previewToken: string; filename: string; hospital: { name: string }; notices: string[]; ignoredSheets: string[];
  duplicateOf: { id: string; uploaded_at: string; uploaded_by_name: string | null }[];
  settings: { currentYearBe: number; fromFile: { values: unknown; problems: string[] } | null };
  sheets: PSheet[];
}

/** หัวตารางตามคอลัมน์ในไฟล์ Excel (แถว 3) — ตัวอักษรคอลัมน์กำกับไว้ให้เทียบกับไฟล์ได้ */
const XL_HEADS: [string, string, string][] = [
  ['A', 'ลำดับ', 'c'], ['B', 'รายการครุภัณฑ์', ''], ['C', 'ปีที่ซื้อ (พ.ศ.)', 'c'], ['D', 'ราคาซื้อ (บาท)', 'r'], ['E', 'ปีที่ใช้งานแล้ว (ปี)', 'r'],
  ['F', 'Utilization (%)', 'r'], ['G', 'จำนวนเคสสะสม', 'r'], ['H', 'ค่าบำรุงรักษาสะสม (บาท)', 'r'], ['I', 'Downtime สะสม (%)', 'r'],
  ['J', 'รายได้สะสม (บาท)', 'r'], ['K', 'คะแนนผลลัพธ์ทางคลินิก (1-5)', 'c'], ['L', 'คะแนนความพึงพอใจ (1-5)', 'c'], ['M', 'คะแนนมูลค่าเชิงกลยุทธ์ (1-5)', 'c'],
  ['N', 'ต้นทุนต่อเคส (บาท)', 'r'], ['O', 'Payback Period (ปี)', 'r'], ['P', 'Utilization Score', 'r'], ['Q', 'Financial Score', 'r'],
  ['R', 'Reliability Score', 'r'], ['S', 'Clinical Score', 'r'], ['T', 'Satisfaction Score', 'r'], ['U', 'Strategic Score', 'r'],
  ['V', 'Utility Score รวม (0-100)', 'c'], ['W', 'อันดับ', 'c'], ['X', 'ข้อเสนอแนะ', ''],
];
/** P–U เรียงตามไฟล์ Excel */
const XL_FACTORS: (keyof FactorScores)[] = ['utilization', 'financial', 'reliability', 'clinical', 'satisfaction', 'strategic'];
/** ช่องที่ระบบคำนวณ: แถวที่ไม่มีคะแนนแสดง — · N/A ตามสูตร Excel เมื่อหารด้วย 0 */
const calc = (scored: boolean, v: number | null | undefined, d = 2) => (!scored ? '—' : v === null || v === undefined ? 'N/A' : num(v, d));

const STATUS: Record<Status, [string, string]> = { ok: ['พร้อม', 'g'], warning: ['มีข้อสังเกต', 'w'], incomplete: ['ข้อมูลไม่ครบ', 'n'], error: ['ผิดพลาด', 'r'] };

export function UtilityImport() {
  const { me } = useAuth();
  const central = me?.scope === 'all';
  const hospitals = useOptions(central ? '/api/hospitals' : null);
  const [hospitalId, setHospitalId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const [done, setDone] = useState<{ inserted: number; replaced: number; skipped: number; registered: number; reused: number; removed: number } | null>(null);


  const send = async (file: File) => {
    setMsg(null);
    setDone(null);
    if (!/\.xlsx$/i.test(file.name)) return setMsg({ tone: 'red', text: 'รับเฉพาะไฟล์ .xlsx' });
    if (file.size > 5 * 1024 * 1024) return setMsg({ tone: 'red', text: 'ไฟล์ใหญ่เกิน 5 MB' });
    if (central && !hospitalId) return setMsg({ tone: 'red', text: 'กรุณาเลือกโรงพยาบาลก่อนอัปโหลด' });
    setBusy(true);
    try {
      const p = await api.upload<Preview>(`/api/utility/import/preview${central ? `?hospitalId=${hospitalId}` : ''}`, file);
      setPreview(p);
      setSelected(p.sheets.filter((s) => s.selected).map((s) => s.sheet));
      setTab(p.sheets.find((s) => s.selected)?.sheet ?? p.sheets[0]!.sheet);
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof ApiError ? e.message : 'อ่านไฟล์ไม่สำเร็จ' });
    } finally { setBusy(false); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void send(f); };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setMsg(null);
    try {
      setDone(await api.post('/api/utility/import/commit', { previewToken: preview.previewToken, selectedSheets: selected, mode }));
      setPreview(null);
    } catch (e) {
      setMsg({ tone: 'red', text: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ' });
    } finally { setBusy(false); }
  };

  const sheet = preview?.sheets.find((s) => s.sheet === tab);
  const chosen = preview?.sheets.filter((s) => selected.includes(s.sheet)) ?? [];
  const willImport = chosen.reduce((n, s) => n + s.rows.length - s.summary.error, 0);
  const willSkip = chosen.reduce((n, s) => n + s.summary.error, 0);
  const willRegister = chosen.reduce((n, s) => n + s.rows.filter((r) => r.register).length, 0);

  return (
    <div className="stack">
      <div className="note blue">
        นำเข้าไฟล์ .xlsx ตามแบบฟอร์ม Utility Analysis (หัวตารางแถว 3) ระบบคำนวณคะแนนใหม่เองทุกแถว ไม่ใช้ค่าที่สูตรในไฟล์คำนวณไว้ ·{' '}
        แถวที่มีปีที่ซื้อและราคาจะถูกสร้างเป็นครุภัณฑ์ในทะเบียน ช่องที่ไฟล์ไม่มี (รหัส ยี่ห้อ รุ่น Serial หน่วยงาน) เป็นค่าชั่วคราวให้แก้ภายหลัง ·{' '}
        คะแนนคิดด้วย<Link to="/formula">สมมติฐานและน้ำหนักคะแนน</Link>ของระบบ (ชุดเดียวกับข้อมูลรายปี) · <a href="/api/utility/template" download>ดาวน์โหลดแบบฟอร์มเปล่า</a> · <Link to="/equipment">กลับไปทะเบียนครุภัณฑ์</Link>
      </div>
      {msg && <div className={`note ${msg.tone}`} role="status">{msg.text}</div>}
      {done && (
        <div className="note blue" role="status">
          <b>นำเข้าสำเร็จ {done.inserted} แถว · สร้างครุภัณฑ์ใหม่ในทะเบียน {done.registered} รายการ</b>
          {done.reused > 0 && ` · ใช้ครุภัณฑ์เดิม ${done.reused} รายการ`}
          {done.removed > 0 && ` · ลบครุภัณฑ์ชั่วคราวที่ไม่มีในไฟล์ใหม่ ${done.removed} รายการ`}
          {done.replaced > 0 && ` · แทนที่ข้อมูลนำเข้าเดิม ${done.replaced} แถว`}
          {done.skipped > 0 && ` · ข้ามแถวที่ผิดพลาด ${done.skipped} แถว`}
          <div><Link to="/equipment">ดูในทะเบียนครุภัณฑ์</Link> · <Link to="/scores">ดูผลวิเคราะห์ Utility Score</Link> · <Link to="/reports">รายงานผู้บริหาร</Link></div>
        </div>
      )}

      {!preview && (
        <div className="card stack">
          {central && (
            <div className="fld" style={{ maxWidth: 320 }}><label htmlFor="hs">โรงพยาบาลที่นำเข้า <span className="req">*</span></label>
              <select id="hs" className="in" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
                <option value="">— เลือก —</option>{hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select></div>
          )}
          <label className={`drop ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send(f); }} />
            <b>{busy ? 'กำลังอ่านไฟล์…' : 'ลากไฟล์ .xlsx มาวาง หรือคลิกเพื่อเลือกไฟล์'}</b>
            <span className="muted">ไฟล์เดียว ไม่เกิน 5 MB ไม่เกิน 5,000 แถว ไม่รับไฟล์ที่มีมาโคร</span>
          </label>
        </div>
      )}

      {preview && (
        <>
          <div className="card stack">
            <div className="hrow between">
              <div><b>{preview.filename}</b><div className="muted">นำเข้าให้ {preview.hospital.name} · คำนวณด้วยปีปัจจุบัน พ.ศ. {preview.settings.currentYearBe}</div></div>
              <button className="btn ghost" onClick={() => { setPreview(null); setMsg(null); }}>เลือกไฟล์อื่น</button>
            </div>
            {preview.duplicateOf.length > 0 && <div className="note red">ไฟล์นี้เคยนำเข้าแล้ว {preview.duplicateOf.length} ครั้ง (ล่าสุด {thDate(preview.duplicateOf[0]!.uploaded_at, true)} โดย {preview.duplicateOf[0]!.uploaded_by_name ?? '—'}) ถ้าเลือก "เพิ่ม" ข้อมูลจะซ้ำ</div>}
            {preview.notices.filter((n) => !n.startsWith('ไฟล์นี้เคยนำเข้า')).map((n) => <div key={n} className="note">{n}</div>)}
            <div className="fld"><label>ชีตที่จะนำเข้า</label>
              <div className="stack" style={{ gap: 6 }}>
                {preview.sheets.map((s) => (
                  <label key={s.sheet} className="hrow" style={{ fontWeight: 400 }}>
                    <input type="checkbox" checked={selected.includes(s.sheet)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.sheet] : selected.filter((x) => x !== s.sheet))} />
                    <span><b>{s.sheet}</b>{s.isExample && <span className="chip n" style={{ marginLeft: 6 }}>ข้อมูลตัวอย่าง</span>} <span className="muted">· {s.title} · {s.rows.length} แถว</span></span>
                    {(Object.keys(STATUS) as Status[]).filter((k) => s.summary[k]).map((k) => <span key={k} className={`chip ${STATUS[k][1]}`}>{STATUS[k][0]} {s.summary[k]}</span>)}
                  </label>
                ))}
              </div>
              {preview.ignoredSheets.length > 0 && <span className="hint">ไม่นำเข้า: {preview.ignoredSheets.join(', ')} (สรุปผลระบบสร้างเองจากข้อมูล)</span>}
            </div>
            <div className="fld"><label>วิธีนำเข้า</label>
              <div className="radios">
                <label><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} />เพิ่มเป็นครุภัณฑ์ใหม่ทั้งหมด</label>
                <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />แทนที่ข้อมูลเดิมของชีตที่เลือก (ใช้ครุภัณฑ์เดิมเมื่อชื่อ+ปี+ราคาตรงกัน)</label>
              </div></div>
            <div className="hrow between">
              <span className="muted">จะนำเข้า {willImport} แถว · สร้างในทะเบียนได้ {willRegister} รายการ{willSkip > 0 && ` · ข้ามแถวที่ผิดพลาด ${willSkip} แถว`} · แถวที่ข้อมูลไม่ครบไม่คิดคะแนน</span>
              <button className="btn p" disabled={busy || !selected.length || !willImport} onClick={() => void commit()}>{busy ? 'กำลังบันทึก…' : 'ยืนยันนำเข้า'}</button>
            </div>
          </div>

          <nav className="tabs" aria-label="ชีต">
            {preview.sheets.map((s) => <button key={s.sheet} type="button" className={`tab ${s.sheet === tab ? 'on' : ''}`} onClick={() => setTab(s.sheet)}>{s.sheet}</button>)}
          </nav>
          {sheet && (
            <div className="card flush"><div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th className="c">แถวในไฟล์</th>
                  {XL_HEADS.map(([col, label, align]) => <th key={col} className={align}><span className="muted">{col}</span><br />{label}</th>)}
                  <th>สถานะ / ข้อสังเกต</th></tr></thead>
                <tbody>
                  {sheet.rows.map((r) => (
                    <tr key={r.sourceRow} className={`st-${r.status}`}>
                      <td className="c num">{r.sourceRow}</td>
                      <td className="c num">{r.seqNo}</td>
                      <td style={{ minWidth: 220 }}>{r.name || <span className="muted">—</span>}</td>
                      <td className="c num">{r.input.purchaseYearBe ?? '—'}</td>
                      <td className="r num">{num(r.input.purchasePrice, 2)}</td>
                      <td className="r num">{calc(r.utilityScore !== null, r.ageYears, 0)}</td>
                      <td className="r num">{num(r.input.utilizationPct, 2)}</td>
                      <td className="r num">{num(r.input.totalCases)}</td>
                      <td className="r num">{num(r.input.maintenanceCostTotal, 2)}</td>
                      <td className="r num">{num(r.input.downtimePct, 2)}</td>
                      <td className="r num">{num(r.input.revenueTotal, 2)}</td>
                      <td className="c num">{r.input.clinicalRating ?? '—'}</td>
                      <td className="c num">{r.input.satisfactionRating ?? '—'}</td>
                      <td className="c num">{r.input.strategicRating ?? '—'}</td>
                      <td className="r num">{calc(r.utilityScore !== null, r.costPerCase)}</td>
                      <td className="r num">{calc(r.utilityScore !== null, r.paybackYears)}</td>
                      {XL_FACTORS.map((k) => <td key={k} className="r num">{calc(r.utilityScore !== null, r.scores?.[k])}</td>)}
                      <td className="c">{r.utilityScore !== null ? <ScoreBadge v={r.utilityScore} /> : '—'}</td>
                      <td className="c num">{r.rank ?? '—'}</td>
                      <td style={{ minWidth: 200 }}>{r.recommendation ?? <span className="muted">—</span>}</td>
                      <td style={{ minWidth: 260 }}>
                        <span className={`chip ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>
                        {r.register && <span className="chip b" style={{ marginLeft: 4 }}>สร้างในทะเบียน</span>}
                        {r.missing.length > 0 && <div className="hint">เหตุผล: {r.missing.join(', ')}</div>}
                        {[...r.errors, ...r.warnings].map((m) => <div key={m} className={`hint ${r.errors.includes(m) ? 'e' : ''}`}>{m}</div>)}
                      </td>
                    </tr>
                  ))}
                  {!sheet.rows.length && <tr><td colSpan={XL_HEADS.length + 2} className="muted">ชีตนี้ไม่มีข้อมูล</td></tr>}
                </tbody>
              </table>
            </div></div>
          )}
        </>
      )}

      <ImportHistory refreshKey={done} />
    </div>
  );
}
