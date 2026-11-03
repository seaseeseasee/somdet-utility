import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { thDate } from '../lib/format';

type WeightKey = 'utilization' | 'clinical' | 'financial' | 'reliability' | 'satisfaction' | 'strategic';
interface Settings { id: string; weights: Record<WeightKey, number>; paybackPenalty: number; currentYearBe: number | null; currentYearBeUsed?: number }
interface Batch {
  id: string; filename: string; uploaded_at: string; mode: string; sheets: string[]; row_count: number; registered_count: number;
  hospital_name: string; uploaded_by_name: string | null; active_rows: number;
}

const WEIGHTS: [WeightKey, string][] = [
  ['utilization', 'Utilization'], ['clinical', 'Clinical Outcome'], ['financial', 'Financial'],
  ['reliability', 'Reliability'], ['satisfaction', 'Satisfaction'], ['strategic', 'Strategic Value'],
];
const toForm = (s: Settings) => ({
  ...(Object.fromEntries(WEIGHTS.map(([k]) => [k, String(s.weights[k])])) as Record<WeightKey, string>),
  paybackPenalty: String(s.paybackPenalty),
  currentYearBe: s.currentYearBe === null ? '' : String(s.currentYearBe),
});

/** ชุดน้ำหนักสำหรับคะแนนของครุภัณฑ์ที่นำเข้าจาก Excel — ผู้ดูแลระบบส่วนกลางเป็นผู้เปิดใช้ */
export function ImportSettings({ refreshKey }: { refreshKey?: unknown }) {
  const { can } = useAuth();
  const editable = can('utility.settings');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<ReturnType<typeof toForm> | null>(null);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const load = () => api.get<{ active: Settings }>('/api/utility/settings').then((r) => { setSettings(r.active); setForm(toForm(r.active)); });
  useEffect(() => { void load(); }, [refreshKey]);
  if (!settings || !form) return null;
  const sum = WEIGHTS.reduce((s, [k]) => s + (Number(form[k]) || 0), 0);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/utility/settings', {
        weights: Object.fromEntries(WEIGHTS.map(([k]) => [k, Number(form[k])])),
        paybackPenalty: Number(form.paybackPenalty),
        currentYearBe: form.currentYearBe.trim() ? Number(form.currentYearBe) : null,
      });
      setMsg({ tone: 'blue', text: 'เปิดใช้ชุดน้ำหนักใหม่แล้ว คะแนนของครุภัณฑ์ที่นำเข้าคำนวณใหม่ทันที' });
      void load();
    } catch (x) { setMsg({ tone: 'red', text: x instanceof ApiError ? x.message : 'บันทึกไม่สำเร็จ' }); }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h3>ชุดน้ำหนักของข้อมูลที่นำเข้า</h3>
      <div className="muted">ใช้คิดคะแนนครุภัณฑ์ที่ยังใช้ข้อมูลจากไฟล์ Excel · ปีปัจจุบันที่ใช้ พ.ศ. {settings.currentYearBeUsed}</div>
      {msg && <div className={`note ${msg.tone}`} role="status">{msg.text}</div>}
      <div className="hrow" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {WEIGHTS.map(([k, l]) => (
          <div key={k} className="fld" style={{ width: 130 }}><label htmlFor={`w-${k}`}>{l}</label>
            <input id={`w-${k}`} className="in num" inputMode="decimal" value={form[k]} disabled={!editable} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
        ))}
        <div className="fld" style={{ width: 130 }}><label htmlFor="pp">ตัวคูณ Payback</label>
          <input id="pp" className="in num" inputMode="decimal" value={form.paybackPenalty} disabled={!editable} onChange={(e) => setForm({ ...form, paybackPenalty: e.target.value })} /></div>
        <div className="fld" style={{ width: 150 }}><label htmlFor="cy">ปีปัจจุบัน (พ.ศ.)</label>
          <input id="cy" className="in num" inputMode="numeric" placeholder="อัตโนมัติ" value={form.currentYearBe} disabled={!editable} onChange={(e) => setForm({ ...form, currentYearBe: e.target.value })} /></div>
      </div>
      <div className="hrow between">
        <span className={Math.abs(sum - 1) > 1e-6 ? 'hint e' : 'muted'}>ผลรวมน้ำหนัก {sum.toFixed(2)} (ต้องเท่ากับ 1.00) · ปีปัจจุบันเว้นว่าง = ใช้ปีปัจจุบันตามวันที่</span>
        {editable ? <button className="btn p" disabled={Math.abs(sum - 1) > 1e-6}>เปิดใช้ชุดน้ำหนักนี้</button> : <span className="muted">ผู้ดูแลระบบส่วนกลางเป็นผู้ปรับ</span>}
      </div>
    </form>
  );
}

export function ImportHistory({ refreshKey }: { refreshKey?: unknown }) {
  const { me } = useAuth();
  const central = me?.scope === 'all';
  const [batches, setBatches] = useState<Batch[]>([]);
  useEffect(() => { api.get<Batch[]>('/api/utility/batches').then(setBatches, () => undefined); }, [refreshKey]);
  if (!batches.length) return null;
  return (
    <div className="card stack">
      <h3>ประวัติการนำเข้า</h3>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>เมื่อ</th><th>ไฟล์</th>{central && <th>โรงพยาบาล</th>}<th>ชีต</th><th>วิธี</th><th className="r">แถว (ยังใช้อยู่)</th><th className="r">สร้างในทะเบียน</th><th>ผู้นำเข้า</th></tr></thead>
        <tbody>{batches.map((b) => (
          <tr key={b.id}><td className="num">{thDate(b.uploaded_at, true)}</td><td>{b.filename}</td>{central && <td>{b.hospital_name}</td>}
            <td>{b.sheets.join(', ')}</td><td>{b.mode === 'replace' ? 'แทนที่' : 'เพิ่ม'}</td><td className="r num">{b.row_count} ({b.active_rows})</td>
            <td className="r num">{b.registered_count}</td><td>{b.uploaded_by_name ?? '—'}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
