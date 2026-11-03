import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type AnnualDetail, type Issue, type YearList } from '../lib/api';
import { useAuth } from '../lib/auth';
import { baht, thDate } from '../lib/format';

type Form = Record<string, string | boolean>;
type NumField = [key: string, label: string, unit: string, req?: boolean, hint?: string];

const USAGE: NumField[] = [
  ['availableDays', 'จำนวนวันพร้อมใช้งาน', 'วัน/ปี', true],
  ['actualDays', 'จำนวนวันใช้งานจริง', 'วัน/ปี', true],
  ['maxAvailableHours', 'ชั่วโมงพร้อมใช้งานสูงสุด', 'ชม./ปี', true, 'เช่น 10 ชม. × 245 วัน = 2,450'],
  ['actualHours', 'ชั่วโมงใช้งานจริง', 'ชม./ปี', true, 'จาก PACS/RIS/LIS หรือบันทึกในเครื่อง'],
  ['useCount', 'จำนวนครั้งใช้งาน', 'ครั้ง/ปี', true],
  ['caseCount', 'จำนวนเคส/ผู้ป่วย', 'ราย/ปี', true, 'จำนวนเท่านั้น ห้ามบันทึกข้อมูลระบุตัวผู้ป่วย'],
];
const MONEY: NumField[] = [
  ['repairCost', 'ค่าซ่อม', 'บาท', true], ['partsCost', 'ค่าอะไหล่', 'บาท', true], ['pmCost', 'ค่า PM', 'บาท', true],
  ['calibrationCost', 'ค่าสอบเทียบ/ทดสอบ', 'บาท', true], ['otherCost', 'ค่าใช้จ่ายอื่น', 'บาท'],
];
const RELIABILITY: NumField[] = [
  ['repairDays', 'จำนวนวันหยุดซ่อม', 'วัน/ปี', true], ['breakdownCount', 'จำนวนครั้งที่เสีย', 'ครั้ง/ปี', true],
  ['downtimeHours', 'ชั่วโมง Downtime', 'ชม./ปี', true, 'ชั่วโมงที่เครื่องเสีย หยุด หรือส่งซ่อม'],
];
const RATINGS: [string, string, string][] = [
  ['clinicalRating', 'Clinical Outcome (1–5)', 'ผลลัพธ์ก่อน–หลังมีเครื่อง เช่น ความแม่นยำ, TAT'],
  ['satisfactionRating', 'Satisfaction (1–5)', 'จากแบบสอบถามผู้ใช้/ผู้ป่วย'],
  ['strategicRating', 'Strategic Value (1–5)', 'การรองรับ Service Plan/นโยบาย'],
];
const NUMERIC = [...USAGE, ...MONEY, ['revenue'], ...RELIABILITY, ...RATINGS].map((f) => f[0] as string);
const TEXT = ['ratingRationale', 'clinicalNecessity', 'condition', 'inspectedAt', 'inspectionNote', 'safetyDetail', 'recallStatus', 'unitRecommendation', 'rationale', 'changeReason'];
const UNIT_REC: Record<string, string> = { continue: 'ใช้ต่อ', increase_use: 'เพิ่มการใช้ประโยชน์', repair: 'ซ่อม', reallocate: 'ย้ายจัดสรร', replace: 'ทดแทน', decommission: 'จำหน่าย (Decommission)' };
const KIND: Record<string, string> = { repair: 'ซ่อม', pm: 'PM', calibration: 'สอบเทียบ', other: 'อื่น ๆ' };
const ACTION: Record<string, string> = { submit: 'ส่งตรวจสอบ', approve: 'ยืนยันข้อมูล', reject: 'ตีกลับ', unlock: 'ปลดล็อกเพื่อแก้ไข', lock: 'ล็อก (ปิดรอบ)' };
const TONE: Record<string, string> = { draft: 'b', submitted: 'w', approved: 'g', locked: 'n' };

const toForm = (d: Record<string, unknown> | null): Form => {
  const f: Form = { noDirectRevenue: false, safetyEvent: '' };
  for (const k of [...NUMERIC, ...TEXT]) f[k] = d?.[k] === null || d?.[k] === undefined ? '' : String(d[k]);
  if (d) {
    f.noDirectRevenue = Boolean(d.noDirectRevenue);
    f.safetyEvent = d.safetyEvent === null || d.safetyEvent === undefined ? '' : d.safetyEvent ? 'yes' : 'no';
  }
  if (!d) f.otherCost = '0';
  return f;
};
const toBody = (f: Form, version?: number) => {
  const b: Record<string, unknown> = { version };
  for (const k of NUMERIC) b[k] = f[k] === '' ? null : Number(String(f[k]).replace(/,/g, ''));
  for (const k of TEXT) b[k] = f[k] === '' ? null : f[k];
  b.noDirectRevenue = Boolean(f.noDirectRevenue);
  b.safetyEvent = f.safetyEvent === '' ? null : f.safetyEvent === 'yes';
  return b;
};
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

function Field({ k, label, req, hint, issue, children, cls }: { k: string; label: string; req?: boolean; hint?: string; issue?: string; children: React.ReactNode; cls?: string }) {
  return (
    <div className={`fld ${cls ?? ''}`}>
      <label htmlFor={k}>{label} {req && <span className="req">*</span>}</label>
      {children}
      {issue ? <span className="hint e">{issue}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function AnnualForm() {
  const { id, year } = useParams();
  const fy = Number(year);
  const nav = useNavigate();
  const { can } = useAuth();
  const [years, setYears] = useState<YearList | null>(null);
  const [d, setD] = useState<AnnualDetail | null>(null);
  const [form, setForm] = useState<Form>(toForm(null));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: string; text: string; list?: Issue[] } | null>(null);
  const [reason, setReason] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [mx, setMx] = useState({ eventDate: '', kind: 'repair', detail: '', cost: '', workOrderNo: '' });

  const load = useCallback(async () => {
    const [y, det] = await Promise.all([api.get<YearList>(`/api/equipment/${id}/annual`), api.get<AnnualDetail>(`/api/equipment/${id}/annual/${fy}`)]);
    setYears(y);
    setD(det);
    setForm(toForm(det.data));
    setDirty(false);
  }, [id, fy]);
  useEffect(() => { setMsg(null); setUnlocking(false); void load().catch((e: Error) => setMsg({ tone: 'red', text: e.message })); }, [load]);

  const status = d?.record?.status ?? 'new';
  const editable = can('annual.write') && (status === 'new' || status === 'draft');
  const issues = useMemo(() => Object.fromEntries((d?.evaluation?.errors ?? []).map((e) => [e.field, e.message])), [d]);
  const ev = d?.evaluation;

  const set = (k: string) => (e: { target: { value: string } }) => { setForm({ ...form, [k]: e.target.value }); setDirty(true); };
  const act = async (fn: () => Promise<AnnualDetail | unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'fiscalYear' in r) { setD(r as AnnualDetail); setForm(toForm((r as AnnualDetail).data)); setDirty(false); }
      else await load();
      setYears(await api.get<YearList>(`/api/equipment/${id}/annual`));
      setMsg({ tone: 'blue', text: ok });
      setUnlocking(false);
      setReason('');
    } catch (e) {
      if (e instanceof ApiError) setMsg({ tone: 'red', text: e.message, list: e.issues });
      else setMsg({ tone: 'red', text: 'ดำเนินการไม่สำเร็จ' });
    } finally { setBusy(false); }
  };
  const save = () => act(() => api.put<AnnualDetail>(`/api/equipment/${id}/annual/${fy}`, toBody(form, d?.record?.version)), 'บันทึกร่างแล้ว');
  const submit = () => act(async () => {
    const det = await api.put<AnnualDetail>(`/api/equipment/${id}/annual/${fy}`, toBody(form, d?.record?.version));
    setD(det);
    setDirty(false);
    return api.post<AnnualDetail>(`/api/annual/${det.record!.id}/submit`);
  }, 'ยืนยันข้อมูลแล้ว ข้อมูลนี้ใช้คำนวณ Utility Score ได้');

  if (!d || !years) return msg ? <div className="note red">{msg.text}</div> : <div className="empty">กำลังโหลด…</div>;
  const m = ev?.metrics;
  const num = (f: NumField) => (
    <Field key={f[0]} k={f[0]} label={f[1]} req={f[3]} hint={f[4] ?? f[2]} issue={issues[f[0]]}>
      <input id={f[0]} inputMode="decimal" className={`in num ${issues[f[0]] ? 'err' : ''}`} value={String(form[f[0]] ?? '')} onChange={set(f[0])} disabled={!editable} />
    </Field>
  );
  const maint = m?.maintenanceCost ?? MONEY.reduce((s, f) => s + (Number(form[f[0]]) || 0), 0);

  return (
    <>
      <div className="card hrow between">
        <div>
          <div className="muted"><Link to={`/equipment/${d.equipment.id}`}>{d.equipment.code}</Link> · ซื้อปี {d.equipment.purchase_year_be} · {baht(d.equipment.purchase_price)} บาท</div>
          <div className="hrow"><b style={{ fontSize: 19, color: 'var(--navy)' }}>{d.equipment.name}</b>
            <span className={`chip ${TONE[status] ?? 'n'}`}>{d.record?.statusLabel ?? 'ยังไม่บันทึก'}</span></div>
          <div className="muted">ปีงบประมาณ {fy}: {thDate(d.period.from)} – {thDate(d.period.to)}</div>
        </div>
        <div className="steps">
          {[['draft', 'ร่าง'], ['approved', 'ยืนยันแล้ว']].map(([k, l], i) => {
            // ข้อมูลเดิมที่ "รอตรวจสอบ" หรือ "ล็อก" ถือว่าผ่านขั้นร่างแล้ว
            const s = status === 'submitted' || status === 'locked' ? 'approved' : status;
            const order = ['new', 'draft', 'approved'];
            const done = order.indexOf(s) > i + 1 || (s === 'approved' && k === 'approved');
            const cur = order.indexOf(s) === i + 1 && !done;
            return <span key={k} className={`st ${done ? 'done' : cur ? 'cur' : ''}`}><span className="c">{done ? '✓' : i + 1}</span>{l}</span>;
          })}
        </div>
      </div>

      <nav className="tabs" aria-label="ปีงบประมาณ">
        {years.years.map((y) => (
          <Link key={y.fiscalYear} to={`/equipment/${id}/annual/${y.fiscalYear}`} className={`tab ${y.fiscalYear === fy ? 'on' : ''}`}
            onClick={(e) => { if (dirty && y.fiscalYear !== fy && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการเปลี่ยนปีโดยไม่บันทึกหรือไม่')) e.preventDefault(); }}>
            ปีงบ {y.fiscalYear} <span className={`chip ${y.status ? TONE[y.status] : 'n'}`}>{y.statusLabel}</span>
          </Link>
        ))}
      </nav>

      {msg && (
        <div className={`note ${msg.tone}`} role="status">
          <b>{msg.text}</b>
          {msg.list && msg.list.length > 0 && <ul>{msg.list.slice(0, 8).map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul>}
        </div>
      )}
      {!editable && status !== 'new' && (
        <div className="note blue">
          {status === 'draft' ? 'ท่านดูข้อมูลได้อย่างเดียว' : `ข้อมูลอยู่ในสถานะ "${d.record?.statusLabel}" แก้ไขไม่ได้`}
          {can('annual.unlock') && status !== 'draft' && ' · กด "ปลดล็อกเพื่อแก้ไข" ด้านขวาหากต้องแก้ (ต้องระบุเหตุผล)'}
        </div>
      )}

      <div className="split">
        <div className="stack">
          <div className="card stack">
            <h3 className="sec-t"><span className="n">A</span>ข้อมูลการใช้งาน</h3>
            <div className="grid-f">{USAGE.map(num)}</div>
          </div>
          <div className="card stack">
            <h3 className="sec-t"><span className="n">B</span>ข้อมูลการเงิน (บาท/ปี)</h3>
            <div className="grid-f">
              {MONEY.map(num)}
              <Field k="maintTotal" label="รวมค่าบำรุงรักษา" hint="ซ่อม + อะไหล่ + PM + สอบเทียบ + อื่น ๆ (D-03)">
                <input id="maintTotal" className="in calc num" readOnly tabIndex={-1} value={baht(maint)} />
              </Field>
              <Field k="revenue" label="รายได้จากการให้บริการ" req issue={issues.revenue} hint="ถ้าไม่มีรายได้ตรง ให้กรอก 0 และเลือกช่องด้านล่าง (Financial Score = 50)">
                <input id="revenue" inputMode="decimal" className={`in num ${issues.revenue ? 'err' : ''}`} value={String(form.revenue)} onChange={set('revenue')} disabled={!editable} />
              </Field>
              <div className="fld" style={{ justifyContent: 'center' }}>
                <label className="hrow" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={Boolean(form.noDirectRevenue)} disabled={!editable}
                    onChange={(e) => { setForm({ ...form, noDirectRevenue: e.target.checked, revenue: e.target.checked ? '0' : (form.revenue ?? '') }); setDirty(true); }} />
                  ไม่มีรายได้ตรง
                </label>
              </div>
            </div>
          </div>
          <div className="card stack">
            <h3 className="sec-t"><span className="n">C</span>ความน่าเชื่อถือ</h3>
            <div className="grid-f">{RELIABILITY.map(num)}</div>
            <div className="stack" style={{ gap: 8 }}>
              <b style={{ fontSize: 14 }}>ประวัติการซ่อมบำรุง</b>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>วันที่</th><th>ประเภท</th><th>รายละเอียด</th><th className="r">ค่าใช้จ่าย</th><th>เลขที่ใบงาน</th><th></th></tr></thead>
                <tbody>
                  {d.maintenance.map((x) => (
                    <tr key={x.id}><td className="num">{thDate(x.event_date)}</td><td>{KIND[x.kind]}</td><td>{x.detail}</td><td className="r num">{baht(x.cost)}</td><td>{x.work_order_no ?? '—'}</td>
                      <td>{editable && <button className="btn sm ghost" onClick={() => void act(() => api.del(`/api/annual/${d.record!.id}/maintenance/${x.id}`), 'ลบรายการแล้ว')}>ลบ</button>}</td></tr>
                  ))}
                  {!d.maintenance.length && <tr><td colSpan={6} className="muted">ยังไม่มีรายการ</td></tr>}
                </tbody>
              </table></div>
              {editable && d.record && (
                <div className="hrow" style={{ alignItems: 'flex-end' }}>
                  <div className="fld"><label htmlFor="mxDate">วันที่</label><input id="mxDate" type="date" className="in" min={d.period.from} max={d.period.to} value={mx.eventDate} onChange={(e) => setMx({ ...mx, eventDate: e.target.value })} /></div>
                  <div className="fld"><label htmlFor="mxKind">ประเภท</label><select id="mxKind" className="in" value={mx.kind} onChange={(e) => setMx({ ...mx, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="fld" style={{ flex: 1, minWidth: 180 }}><label htmlFor="mxDetail">รายละเอียด</label><input id="mxDetail" className="in" value={mx.detail} onChange={(e) => setMx({ ...mx, detail: e.target.value })} /></div>
                  <div className="fld" style={{ width: 130 }}><label htmlFor="mxCost">ค่าใช้จ่าย</label><input id="mxCost" inputMode="decimal" className="in num" value={mx.cost} onChange={(e) => setMx({ ...mx, cost: e.target.value })} /></div>
                  <div className="fld" style={{ width: 150 }}><label htmlFor="mxWo">เลขที่ใบงาน</label><input id="mxWo" className="in" value={mx.workOrderNo} onChange={(e) => setMx({ ...mx, workOrderNo: e.target.value })} /></div>
                  <button className="btn" disabled={busy || !mx.eventDate || !mx.detail} onClick={() => void act(async () => {
                    await api.post(`/api/annual/${d.record!.id}/maintenance`, { ...mx, cost: Number(mx.cost) || 0, workOrderNo: mx.workOrderNo || null });
                    setMx({ eventDate: '', kind: 'repair', detail: '', cost: '', workOrderNo: '' });
                  }, 'เพิ่มประวัติซ่อมบำรุงแล้ว')}>+ เพิ่ม</button>
                </div>
              )}
              {editable && !d.record && <span className="hint">บันทึกร่างก่อนจึงจะเพิ่มประวัติซ่อมบำรุงได้</span>}
            </div>
          </div>
          <div className="card stack">
            <h3 className="sec-t"><span className="n">D</span>ผลลัพธ์ ความปลอดภัย และการตรวจสภาพเครื่อง</h3>
            <div className="grid-f">
              {RATINGS.map(([k, l, h]) => (
                <Field key={k} k={k} label={l} req hint={h} issue={issues[k]}>
                  <input id={k} type="number" min={1} max={5} step={0.1} className={`in num ${issues[k] ? 'err' : ''}`} value={String(form[k])} onChange={set(k)} disabled={!editable} />
                </Field>
              ))}
              <Field k="ratingRationale" label="เหตุผลประกอบคะแนน 1–5" req cls="full" issue={issues.ratingRationale} hint="ระบุแหล่งข้อมูล เช่น แบบสอบถาม ตัวชี้วัดคุณภาพ (D-13)">
                <textarea id="ratingRationale" className="in" value={String(form.ratingRationale)} onChange={set('ratingRationale')} disabled={!editable} />
              </Field>
              <Field k="condition" label="ผลตรวจสภาพเครื่อง" req issue={issues.condition}>
                <select id="condition" className="in" value={String(form.condition)} onChange={set('condition')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="good">ดี</option><option value="fair">พอใช้</option><option value="broken">ชำรุด</option>
                </select>
              </Field>
              <Field k="inspectedAt" label="วันที่ตรวจสภาพ" req issue={issues.inspectedAt} hint={form.inspectedAt ? thDate(String(form.inspectedAt)) : undefined}>
                <input id="inspectedAt" type="date" className="in" value={String(form.inspectedAt)} onChange={set('inspectedAt')} disabled={!editable} />
              </Field>
              <Field k="inspectionNote" label="บันทึกผลตรวจ">
                <input id="inspectionNote" className="in" value={String(form.inspectionNote)} onChange={set('inspectionNote')} disabled={!editable} />
              </Field>
              <Field k="clinicalNecessity" label="ความจำเป็นทางคลินิก" req issue={issues.clinicalNecessity}>
                <select id="clinicalNecessity" className="in" value={String(form.clinicalNecessity)} onChange={set('clinicalNecessity')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="high">สูง</option><option value="medium">ปานกลาง</option><option value="low">ต่ำ</option>
                </select>
              </Field>
              <Field k="safetyEvent" label="เหตุการณ์ความปลอดภัย" req issue={issues.safetyEvent}>
                <select id="safetyEvent" className="in" value={String(form.safetyEvent)} onChange={set('safetyEvent')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="no">ไม่มี</option><option value="yes">มี (ระบุ)</option>
                </select>
              </Field>
              <Field k="recallStatus" label="สถานะ Recall" req issue={issues.recallStatus}>
                <select id="recallStatus" className="in" value={String(form.recallStatus)} onChange={set('recallStatus')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="none">ไม่มี</option><option value="past">เคย Recall</option><option value="ongoing">อยู่ระหว่าง Recall</option>
                </select>
              </Field>
              {form.safetyEvent === 'yes' && (
                <Field k="safetyDetail" label="รายละเอียดเหตุการณ์ความปลอดภัย" req cls="full" issue={issues.safetyDetail}>
                  <textarea id="safetyDetail" className="in" value={String(form.safetyDetail)} onChange={set('safetyDetail')} disabled={!editable} />
                </Field>
              )}
              <Field k="unitRecommendation" label="ข้อเสนอแนะของหน่วยงาน" req issue={issues.unitRecommendation}>
                <select id="unitRecommendation" className="in" value={String(form.unitRecommendation)} onChange={set('unitRecommendation')} disabled={!editable}>
                  <option value="">— เลือก —</option>{Object.entries(UNIT_REC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field k="rationale" label="เหตุผลประกอบข้อเสนอแนะ" req cls="span2" issue={issues.rationale}>
                <input id="rationale" className="in" value={String(form.rationale)} onChange={set('rationale')} disabled={!editable} />
              </Field>
            </div>
          </div>
          {editable && (
            <div className="hrow between">
              <span className="muted">{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : d.record ? `บันทึกล่าสุด ${thDate(d.record.updatedAt, true)}` : 'ยังไม่ได้บันทึก'} · ข้อมูลปีอื่นไม่ถูกเขียนทับ</span>
              <div className="hrow">
                <button className="btn" disabled={busy} onClick={() => void save()}>บันทึกร่าง</button>
                <button className="btn p" disabled={busy} onClick={() => void submit()}>ยืนยันข้อมูล</button>
              </div>
            </div>
          )}
        </div>

        <div className="stack sticky">
          <div className="card stack">
            <h3>ค่าคำนวณอัตโนมัติ (ปี {fy})</h3>
            <div className="muted">คำนวณจากข้อมูลที่บันทึกล่าสุด · ชุดสูตร v1.0 · ความครบถ้วน {ev?.completeness ?? 0}%</div>
            <div className="calc-line"><span>Utilization Rate</span><b className="num">{pct(m?.utilizationPctHours)}</b><span className="f">= ชม.ใช้จริง ÷ ชม.พร้อมใช้ × 100 (D-01)</span></div>
            <div className="calc-line"><span>Utilization (แบบวัน)</span><b className="num">{pct(m?.utilizationPctDays)}</b><span className="f">= วันใช้จริง ÷ วันพร้อมใช้ × 100 (แสดงประกอบ)</span></div>
            <div className="calc-line"><span>Availability Rate</span><b className="num">{pct(m?.availabilityPct)}</b><span className="f">= (วันพร้อมใช้ − วันหยุดซ่อม) ÷ วันพร้อมใช้ × 100</span></div>
            <div className="calc-line"><span>Downtime</span><b className="num">{pct(m?.downtimePct)}</b><span className="f">= ชม.หยุด ÷ ชม.พร้อมใช้ × 100 (D-06)</span></div>
            <div className="calc-line"><span>Reliability Score</span><b className="num">{m?.downtimePct !== undefined && m?.downtimePct !== null ? (100 - m.downtimePct).toFixed(1) : '—'}</b><span className="f">= 100 − Downtime %</span></div>
            <div className="calc-line"><span>Maintenance Cost</span><b className="num">{m ? baht(m.maintenanceCost) : '—'}</b><span className="f">= ซ่อม + อะไหล่ + PM + สอบเทียบ + อื่น ๆ</span></div>
            <div className="calc-line"><span>Cost per Use</span><b className="num">{m?.costPerUse ? baht(Math.round(m.costPerUse)) : '—'}</b><span className="f">{d.equipment.useful_life_years ? `= (ราคา ÷ ${d.equipment.useful_life_years} ปี + บำรุงรักษา) ÷ ครั้งใช้งาน` : 'ต้องกรอกอายุตามเกณฑ์ในทะเบียนก่อน'}</span></div>
            {dirty && <div className="hint">กด "บันทึกร่าง" เพื่อคำนวณใหม่</div>}
            {ev && ev.errors.length > 0 && (
              <div className="note red"><b>พบ {ev.errors.length} รายการที่ต้องแก้ก่อนยืนยัน</b><ul>{ev.errors.slice(0, 6).map((e) => <li key={e.field + e.message}>{e.message}</li>)}</ul></div>
            )}
            {ev && ev.warnings.length > 0 && (
              <div className="note"><b>ข้อสังเกต {ev.warnings.length} รายการ</b><ul>{ev.warnings.map((w) => <li key={w.message}>{w.message}</li>)}</ul>
                <div className="fld" style={{ marginTop: 8 }}><label htmlFor="changeReason">เหตุผลของการเปลี่ยนแปลง <span className="req">*</span></label>
                  <textarea id="changeReason" className="in" value={String(form.changeReason)} onChange={set('changeReason')} disabled={!editable} /></div>
              </div>
            )}
            {ev && !ev.errors.length && !ev.needsChangeReason && status === 'draft' && <div className="note blue">ข้อมูลครบ พร้อมยืนยัน</div>}
          </div>

          {d.record && can('annual.unlock') && ['approved', 'locked', 'submitted'].includes(status) && (
            <div className="card stack">
              <h3>แก้ไขข้อมูลที่ยืนยันแล้ว</h3>
              {unlocking ? (
                <div className="stack">
                  <label htmlFor="reason" style={{ fontWeight: 600, fontSize: 13 }}>เหตุผลการปลดล็อก <span className="req">*</span></label>
                  <textarea id="reason" className="in" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="hrow">
                    <button className="btn p" disabled={busy || reason.trim().length < 5}
                      onClick={() => void act(() => api.post(`/api/annual/${d.record!.id}/unlock`, { reason }), 'ปลดล็อกแล้ว ข้อมูลกลับเป็นร่าง')}>
                      ยืนยันปลดล็อก</button>
                    <button className="btn" onClick={() => { setUnlocking(false); setReason(''); }}>ยกเลิก</button>
                  </div>
                </div>
              ) : (
                <button className="btn ghost" onClick={() => setUnlocking(true)}>ปลดล็อกเพื่อแก้ไข…</button>
              )}
            </div>
          )}

          <div className="card stack">
            <h3>ประวัติการยืนยันและแก้ไข</h3>
            {!d.reviews.length && <div className="muted">ยังไม่มี</div>}
            <div className="tl">
              {d.reviews.map((r, i) => (
                <div className="it" key={i}><div><b>{r.actor_name ?? '—'}</b> {ACTION[r.action] ?? r.action}
                  <div className="muted">{thDate(r.at, true)}</div>{r.reason && <div className="diff">“{r.reason}”</div>}</div></div>
              ))}
            </div>
          </div>
          <button className="btn ghost" onClick={() => nav(`/equipment/${d.equipment.id}`)}>← กลับไปหน้าครุภัณฑ์</button>
        </div>
      </div>
    </>
  );
}
