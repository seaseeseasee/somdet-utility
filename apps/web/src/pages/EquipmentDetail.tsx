import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Equipment } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ageYears, baht, MAINT_PLAN, STATUS, thDate } from '../lib/format';

interface HistoryRow { id: number; action: string; at: string; actor_name: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

const LABEL: Record<string, string> = {
  code: 'รหัส', name: 'ชื่อ', type_name: 'ประเภท', department_name: 'หน่วยงาน', brand: 'ยี่ห้อ', model: 'รุ่น', serial_no: 'Serial',
  purchase_year_be: 'ปีที่ซื้อ', budget_year_be: 'ปีงบประมาณ', purchase_price: 'ราคา', contract_no: 'เลขที่สัญญา', funding_source: 'แหล่งเงิน',
  received_date: 'วันที่รับเข้า', start_date: 'วันที่เริ่มใช้', useful_life_years: 'อายุตามเกณฑ์', status: 'สถานะ',
  maintenance_plan: 'แผนบำรุงรักษา', status_note: 'หมายเหตุสถานะ',
};
const show = (k: string, v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : k === 'status' ? (STATUS[String(v)]?.label ?? String(v)) : k === 'maintenance_plan' ? MAINT_PLAN[String(v)] : k === 'purchase_price' ? baht(Number(v)) : String(v);

function changes(h: HistoryRow) {
  if (!h.before || !h.after) return [];
  return Object.keys(LABEL).filter((k) => JSON.stringify(h.before![k]) !== JSON.stringify(h.after![k]));
}

export function EquipmentDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [e, setE] = useState<Equipment | null>(null);
  const [hist, setHist] = useState<HistoryRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Equipment>(`/api/equipment/${id}`).then(setE, (x: Error) => setErr(x.message));
    api.get<HistoryRow[]>(`/api/equipment/${id}/history`).then(setHist, () => undefined);
  }, [id]);

  if (err) return <div className="note red">{err}</div>;
  if (!e) return <div className="empty">กำลังโหลด…</div>;
  const rows: [string, React.ReactNode][] = [
    ['โรงพยาบาล', e.hospital_name], ['หน่วยงาน', e.department_name], ['ประเภท', e.type_name], ['ยี่ห้อ / รุ่น', `${e.brand} / ${e.model}`],
    ['Serial Number', e.serial_no], ['ปีที่จัดซื้อ (พ.ศ.)', e.purchase_year_be], ['ปีงบประมาณ', e.budget_year_be ?? '—'],
    ['ราคาจัดซื้อ (บาท)', baht(e.purchase_price)], ['เลขที่สัญญา', e.contract_no ?? '—'], ['แหล่งเงิน', e.funding_source ?? '—'],
    ['วันที่รับเข้า', thDate(e.received_date)], ['วันที่เริ่มใช้งาน', thDate(e.start_date)],
    ['อายุที่ใช้งานแล้ว', `${ageYears(e.purchase_year_be)} ปี`], ['อายุตามเกณฑ์', e.useful_life_years ? `${e.useful_life_years} ปี` : '—'],
    ['แผนบำรุงรักษา', MAINT_PLAN[e.maintenance_plan]], ['หมายเหตุสถานะ', e.status_note ?? '—'],
  ];
  return (
    <>
      <div className="card hrow between">
        <div className="hrow" style={{ gap: 14 }}>
          <div>
            <div className="hrow">
              <b style={{ fontSize: 20, color: 'var(--navy)' }}>{e.name}</b>
              <span className="chip b">{e.code}</span>
              <span className={`chip ${STATUS[e.status]?.tone ?? 'n'}`}>{STATUS[e.status]?.label}</span>
            </div>
            <div className="muted" style={{ fontSize: 13.5 }}>{e.department_name} · {e.brand} / {e.model} · S/N {e.serial_no}</div>
          </div>
        </div>
        <div className="hrow">
          <Link className="btn" to="/equipment">กลับไปทะเบียน</Link>
          {can('equipment.write') && <Link className="btn p" to={`/equipment/${e.id}/edit`}>แก้ไข</Link>}
        </div>
      </div>
      <div className="split">
        <div className="stack">
          <div className="card">
            <h3>ข้อมูลพื้นฐาน</h3>
            <table className="tbl"><tbody>
              {rows.map(([k, v]) => <tr key={k}><td className="muted" style={{ width: 200 }}>{k}</td><td>{v}</td></tr>)}
            </tbody></table>
          </div>
          <div className="note blue">ข้อมูลการใช้งานรายปี, Utility Score และกราฟย้อนหลัง 5 ปี จะแสดงที่หน้านี้เมื่อพัฒนา Sprint 3–5 เสร็จ</div>
        </div>
        <div className="card stack">
          <h3>ประวัติการแก้ไข</h3>
          {!hist.length && <div className="muted">ไม่มีสิทธิ์ดูหรือยังไม่มีประวัติ</div>}
          <div className="tl">
            {hist.map((h) => (
              <div className="it" key={h.id}>
                <div>
                  <b>{h.actor_name ?? 'ระบบ'}</b> {h.action === 'create' ? 'ลงทะเบียนครุภัณฑ์' : 'แก้ไขข้อมูล'}
                  <div className="muted">{thDate(h.at, true)}</div>
                  {changes(h).map((k) => (
                    <div className="diff" key={k}>
                      {LABEL[k]}: <del>{show(k, h.before?.[k])}</del> → <ins>{show(k, h.after?.[k])}</ins>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
