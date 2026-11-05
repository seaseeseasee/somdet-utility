import React, { useState } from 'react';
import { api, type AnnualDetail } from '../../lib/api';
import { baht, thDate } from '../../lib/format';
import { MoneyInput } from '../../lib/MoneyInput';
import { ACTION, KIND, pct, type Form } from './annualForm.model';

/** ดำเนินการกับข้อมูลรายปีแล้วแสดงผล (จัดการ busy/ข้อความ/โหลดใหม่ที่หน้าหลัก) */
export type Act = (fn: () => Promise<AnnualDetail | unknown>, ok: string) => Promise<void>;

export function Field({ k, label, req, hint, issue, children, cls }: { k: string; label: string; req?: boolean; hint?: string; issue?: string; children: React.ReactNode; cls?: string }) {
  return (
    <div className={`fld ${cls ?? ''}`}>
      <label htmlFor={k}>{label} {req && <span className="req">*</span>}</label>
      {children}
      {issue ? <span className="hint e">{issue}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** ขั้นตอน ร่าง → ยืนยันแล้ว (ข้อมูลเดิมที่ "รอตรวจสอบ" หรือ "ล็อก" ถือว่าผ่านขั้นร่างแล้ว) */
export function StatusSteps({ status }: { status: string }) {
  return (
    <div className="steps">
      {[['draft', 'ร่าง'], ['approved', 'ยืนยันแล้ว']].map(([k, l], i) => {
        const s = status === 'submitted' || status === 'locked' ? 'approved' : status;
        const order = ['new', 'draft', 'approved'];
        const done = order.indexOf(s) > i + 1 || (s === 'approved' && k === 'approved');
        const cur = order.indexOf(s) === i + 1 && !done;
        return <span key={k} className={`st ${done ? 'done' : cur ? 'cur' : ''}`}><span className="c">{done ? '✓' : i + 1}</span>{l}</span>;
      })}
    </div>
  );
}

/** ประวัติการซ่อมบำรุงของปีนี้ (เพิ่ม/ลบได้เฉพาะตอนเป็นร่างและบันทึกร่างแล้ว) */
export function MaintenanceSection({ d, editable, busy, act }: { d: AnnualDetail; editable: boolean; busy: boolean; act: Act }) {
  const [mx, setMx] = useState({ eventDate: '', kind: 'repair', detail: '', cost: '', workOrderNo: '' });
  return (
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
          <div className="fld" style={{ width: 130 }}><label htmlFor="mxCost">ค่าใช้จ่าย</label><MoneyInput id="mxCost" className="in num" value={mx.cost} onChange={(e) => setMx({ ...mx, cost: e.target.value })} /></div>
          <div className="fld" style={{ width: 150 }}><label htmlFor="mxWo">เลขที่ใบงาน</label><input id="mxWo" className="in" value={mx.workOrderNo} onChange={(e) => setMx({ ...mx, workOrderNo: e.target.value })} /></div>
          <button className="btn" disabled={busy || !mx.eventDate || !mx.detail} onClick={() => void act(async () => {
            await api.post(`/api/annual/${d.record!.id}/maintenance`, { ...mx, cost: Number(mx.cost) || 0, workOrderNo: mx.workOrderNo || null });
            setMx({ eventDate: '', kind: 'repair', detail: '', cost: '', workOrderNo: '' });
          }, 'เพิ่มประวัติซ่อมบำรุงแล้ว')}>+ เพิ่ม</button>
        </div>
      )}
      {editable && !d.record && <span className="hint">บันทึกร่างก่อนจึงจะเพิ่มประวัติซ่อมบำรุงได้</span>}
    </div>
  );
}

/** ค่าคำนวณอัตโนมัติของปีนี้ ข้อผิดพลาด และข้อสังเกต (พร้อมช่องเหตุผลของการเปลี่ยนแปลง) */
export function CalcPanel({ d, fy, form, set, editable, dirty, status, formulaVersion }: {
  d: AnnualDetail; fy: number; form: Form; set: (k: string) => (e: { target: { value: string } }) => void;
  editable: boolean; dirty: boolean; status: string; formulaVersion: string | null;
}) {
  const ev = d.evaluation;
  const m = ev?.metrics;
  return (
    <div className="card stack">
      <h3>ค่าคำนวณอัตโนมัติ (ปี {fy})</h3>
      <div className="muted">คำนวณจากข้อมูลที่บันทึกล่าสุด{formulaVersion && ` · ชุดสูตร v${formulaVersion}`} · ความครบถ้วน {ev?.completeness ?? 0}%</div>
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
  );
}

/** ปลดล็อกข้อมูลที่ยืนยันแล้วให้กลับเป็นร่าง (ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร) */
export function UnlockCard({ d, busy, act }: { d: AnnualDetail; busy: boolean; act: Act }) {
  const [unlocking, setUnlocking] = useState(false);
  const [reason, setReason] = useState('');
  return (
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
  );
}

export function ReviewHistory({ reviews }: { reviews: AnnualDetail['reviews'] }) {
  return (
    <div className="card stack">
      <h3>ประวัติการยืนยันและแก้ไข</h3>
      {!reviews.length && <div className="muted">ยังไม่มี</div>}
      <div className="tl">
        {reviews.map((r, i) => (
          <div className="it" key={i}><div><b>{r.actor_name ?? '—'}</b> {ACTION[r.action] ?? r.action}
            <div className="muted">{thDate(r.at, true)}</div>{r.reason && <div className="diff">“{r.reason}”</div>}</div></div>
        ))}
      </div>
    </div>
  );
}
