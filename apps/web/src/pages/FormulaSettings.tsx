import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { thDate } from '../lib/format';

type WeightKey = 'utilization' | 'clinical' | 'financial' | 'reliability' | 'satisfaction' | 'strategic';
interface Current { version: string; weights: Record<WeightKey, number>; paybackPenalty: number; currentYearBe: number | null; currentYearBeUsed: number }
interface Version {
  version: string; status: string; approved_at: string | null; approved_by_name: string | null; has_approver: boolean;
  definition: { weights?: Record<WeightKey, number>; paybackPenalty?: number; currentYearBe?: number | null; change?: string };
}

/** ตรงกับชีต "สมมติฐาน" ของไฟล์ต้นแบบ */
const ROWS: [WeightKey, string, string][] = [
  ['utilization', 'น้ำหนัก: Utilization Rate', 'สัดส่วนความสำคัญของอัตราการใช้งานจริง'],
  ['clinical', 'น้ำหนัก: Clinical Outcome', 'สัดส่วนความสำคัญของผลลัพธ์ทางคลินิก'],
  ['financial', 'น้ำหนัก: Financial Return', 'สัดส่วนความสำคัญของผลตอบแทนทางการเงิน'],
  ['reliability', 'น้ำหนัก: Reliability', 'สัดส่วนความสำคัญของความน่าเชื่อถือ/Downtime'],
  ['satisfaction', 'น้ำหนัก: Satisfaction', 'สัดส่วนความสำคัญของความพึงพอใจผู้ใช้งาน/ผู้ป่วย'],
  ['strategic', 'น้ำหนัก: Strategic Value', 'สัดส่วนความสำคัญของมูลค่าเชิงกลยุทธ์'],
];
const pct = (v: number) => Number((v * 100).toFixed(4)).toString();
const toForm = (c: Current) => ({
  ...(Object.fromEntries(ROWS.map(([k]) => [k, pct(c.weights[k])])) as Record<WeightKey, string>),
  paybackPenalty: String(c.paybackPenalty),
  currentYearBe: c.currentYearBe === null ? '' : String(c.currentYearBe),
  note: '',
});

export function FormulaSettings() {
  const { can } = useAuth();
  const editable = can('formula.manage');
  const [data, setData] = useState<{ current: Current; history: Version[] } | null>(null);
  const [form, setForm] = useState<ReturnType<typeof toForm> | null>(null);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<{ current: Current; history: Version[] }>('/api/formula-sets').then((d) => { setData(d); setForm(toForm(d.current)); });
  useEffect(() => { void load(); }, []);
  if (!data || !form) return <div className="empty">กำลังโหลด…</div>;

  const sum = ROWS.reduce((s, [k]) => s + (Number(form[k]) || 0), 0);
  const sumOk = Math.abs(sum - 100) < 1e-4;
  const changed = ROWS.some(([k]) => Number(form[k]) !== Number(pct(data.current.weights[k])))
    || Number(form.paybackPenalty) !== data.current.paybackPenalty
    || (form.currentYearBe.trim() ? Number(form.currentYearBe) : null) !== data.current.currentYearBe;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ version: string }>('/api/formula-sets', {
        weights: Object.fromEntries(ROWS.map(([k]) => [k, Number(form[k]) / 100])),
        paybackPenalty: Number(form.paybackPenalty),
        currentYearBe: form.currentYearBe.trim() ? Number(form.currentYearBe) : null,
        note: form.note.trim() || undefined,
      });
      setMsg({ tone: 'blue', text: `เปิดใช้ชุดสูตร v${r.version} แล้ว คะแนนทุกหน้าคำนวณใหม่ด้วยค่านี้ทันที` });
      await load();
    } catch (x) {
      setMsg({ tone: 'red', text: x instanceof ApiError ? x.message : 'บันทึกไม่สำเร็จ' });
    } finally { setBusy(false); }
  };
  const num = (k: keyof typeof form, w = 100) => (
    <input className="in num" style={{ width: w, textAlign: 'right' }} inputMode="decimal" value={form[k]} disabled={!editable}
      onChange={(e) => setForm({ ...form, [k]: e.target.value })} aria-label={String(k)} />
  );

  return (
    <div className="stack">
      <div className="note blue">
        ชุดสูตรเดียวใช้ทั้งระบบ: คะแนนจากข้อมูลรายปี ข้อมูลที่นำเข้าจาก Excel Dashboard หน้าผลวิเคราะห์ และรายงานผู้บริหาร ·
        ปรับแล้วระบบสร้างเวอร์ชันใหม่ (เวอร์ชันเดิมเก็บไว้ รายงานที่ออกไปแล้วยังอ้างอิงได้){!editable && ' · ผู้ดูแลระบบส่วนกลางเป็นผู้ปรับ'}
      </div>
      {msg && <div className={`note ${msg.tone}`} role="status">{msg.text}</div>}
      <form className="card stack" onSubmit={save}>
        <div className="hrow between"><h3>สมมติฐานและน้ำหนักคะแนน</h3><span className="badge-v">ใช้อยู่: ชุดสูตร v{data.current.version}</span></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>รายการ</th><th className="r">ค่า</th><th>หมายเหตุ</th></tr></thead>
          <tbody>
            {ROWS.map(([k, label, note]) => (
              <tr key={k}><td>{label}</td><td className="r"><span className="hrow" style={{ gap: 4, justifyContent: 'flex-end' }}>{num(k, 90)}%</span></td><td className="muted">{note}</td></tr>
            ))}
            <tr><td>ตัวคูณบทลงโทษ Payback (ปี)</td><td className="r">{num('paybackPenalty', 90)}</td>
              <td className="muted">ทุก 1 ปีที่คืนทุนช้าลง หัก Financial Score {Number(form.paybackPenalty) || 0} คะแนน</td></tr>
            <tr><td>ปีปัจจุบัน (พ.ศ.)</td><td className="r">
              <input className="in num" style={{ width: 90, textAlign: 'right' }} inputMode="numeric" placeholder={String(data.current.currentYearBeUsed)} value={form.currentYearBe} disabled={!editable}
                onChange={(e) => setForm({ ...form, currentYearBe: e.target.value })} aria-label="ปีปัจจุบัน" /></td>
              <td className="muted">ใช้คำนวณจำนวนปีที่ใช้งานเครื่องมือของข้อมูลที่นำเข้าจาก Excel · เว้นว่าง = ปีปัจจุบันตามวันที่ ({data.current.currentYearBeUsed}) · ข้อมูลรายปีใช้ปีที่วิเคราะห์ที่เลือกในแต่ละหน้า</td></tr>
            <tr><td><b>ผลรวมน้ำหนัก (ต้อง = 100%)</b></td><td className="r"><b className={sumOk ? '' : 'hint e'}>{Number(sum.toFixed(4))}%</b></td><td className={sumOk ? 'muted' : 'hint e'}>{sumOk ? 'ถูกต้อง' : 'ผลรวมต้องเท่ากับ 100% จึงจะบันทึกได้'}</td></tr>
          </tbody>
        </table></div>
        {editable && (
          <div className="hrow between" style={{ alignItems: 'flex-end' }}>
            <div className="fld" style={{ flex: 1, maxWidth: 480 }}><label htmlFor="note">เหตุผลของการปรับ (บันทึกในประวัติ)</label>
              <input id="note" className="in" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="เช่น ปรับตามมติคณะกรรมการ ครั้งที่ 1/2570" /></div>
            <div className="hrow">
              <button type="button" className="btn ghost" disabled={busy || !changed} onClick={() => setForm(toForm(data.current))}>คืนค่าที่ใช้อยู่</button>
              <button className="btn p" disabled={busy || !sumOk || !changed}>{busy ? 'กำลังบันทึก…' : 'บันทึกเป็นเวอร์ชันใหม่และเปิดใช้'}</button>
            </div>
          </div>
        )}
      </form>

      <div className="card stack">
        <h3>ประวัติชุดสูตร</h3>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>เวอร์ชัน</th><th>สถานะ</th><th className="r">Util / Clin / Fin / Rel / Sat / Str (%)</th><th className="r">ตัวคูณ Payback</th><th className="c">ปีปัจจุบัน</th><th>เปิดใช้เมื่อ</th><th>ผู้ปรับ</th><th>เหตุผล</th></tr></thead>
          <tbody>{data.history.map((v) => {
            const w = v.definition.weights;
            return (
              <tr key={v.version}>
                <td className="num"><b>v{v.version}</b></td>
                <td><span className={`chip ${v.status === 'approved' ? 'g' : 'n'}`}>{v.status === 'approved' ? 'ใช้อยู่' : v.status === 'retired' ? 'เลิกใช้' : v.status}</span></td>
                <td className="r num">{w ? ROWS.map(([k]) => pct(w[k] ?? 0)).join(' / ') : '—'}</td>
                <td className="r num">{v.definition.paybackPenalty ?? '—'}</td>
                <td className="c num">{v.definition.currentYearBe ?? 'อัตโนมัติ'}</td>
                <td className="num">{thDate(v.approved_at, true)}</td>
                <td>{v.approved_by_name ?? (v.has_approver ? 'ผู้ดูแลระบบส่วนกลาง' : 'ค่าเริ่มต้นของระบบ')}</td>
                <td className="muted" style={{ maxWidth: 320 }}>{v.definition.change ?? '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
