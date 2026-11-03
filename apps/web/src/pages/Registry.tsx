import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Equipment, type Option, type Paged } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ageYears, baht, STATUS } from '../lib/format';

export function Registry() {
  const { me, can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [hospital, setHospital] = useState('');
  const [pending, setPending] = useState(false);
  const [depts, setDepts] = useState<Option[]>([]);
  const [hospitals, setHospitals] = useState<Option[]>([]);
  const [data, setData] = useState<Paged<Equipment> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const central = me?.scope === 'all';

  useEffect(() => {
    api.get<Option[]>('/api/departments').then(setDepts).catch(() => undefined);
    if (central) api.get<Option[]>('/api/hospitals').then(setHospitals).catch(() => undefined);
  }, [central]);

  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams({ pageSize: '200' });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      if (dept) p.set('departmentId', dept);
      if (hospital) p.set('hospitalId', hospital);
      if (pending) p.set('pending', '1');
      api.get<Paged<Equipment>>(`/api/equipment?${p}`).then(setData, (e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, status, dept, hospital, pending]);

  const rows = data?.rows ?? [];
  const count = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  return (
    <>
      <div className="hrow between">
        <div className="hrow">
          <input className="in" style={{ width: 320 }} placeholder="ค้นหา รหัส ชื่อ Serial No. ยี่ห้อ/รุ่น" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
          {central && (
            <select className="in" style={{ width: 220 }} value={hospital} onChange={(e) => setHospital(e.target.value)} aria-label="โรงพยาบาล">
              <option value="">โรงพยาบาล: ทั้งหมด</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
          {!central && (
            <select className="in" style={{ width: 200 }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="หน่วยงาน">
              <option value="">หน่วยงาน: ทั้งหมด</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select className="in" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ">
            <option value="">สถานะ: ทั้งหมด</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <label className="hrow" style={{ fontSize: 14 }}><input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} />รอกรอกข้อมูลเพิ่ม</label>
        </div>
        <div className="hrow">
          {can('utility.import') && <Link className="btn" to="/equipment/import">นำเข้าจาก Excel</Link>}
          {can('equipment.write') && <Link className="btn p" to="/equipment/new">+ เพิ่มครุภัณฑ์</Link>}
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="l">ทั้งหมด</div><div className="v num">{data?.total ?? '—'}</div></div>
        <div className="kpi g"><div className="l">ใช้งาน / พร้อมใช้</div><div className="v num">{count(['in_use', 'ready'])}</div></div>
        <div className="kpi w"><div className="l">ส่งซ่อม</div><div className="v num">{count(['repair'])}</div></div>
        <div className="kpi r"><div className="l">งดใช้ / รอจำหน่าย</div><div className="v num">{count(['suspended', 'pending_disposal'])}</div></div>
      </div>
      {error && <div className="note red">{error}</div>}
      <div className="card flush">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อครุภัณฑ์ / ยี่ห้อ-รุ่น</th>{central && <th>โรงพยาบาล</th>}<th>หน่วยงาน</th><th>Serial No.</th>
                <th className="c">ปีที่ซื้อ</th><th className="r">ราคาจัดซื้อ (บาท)</th><th className="c">อายุ (ปี)</th><th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/equipment/${r.id}`)}>
                  <td><Link className="code" to={`/equipment/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.code}</Link></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="muted">{r.brand} / {r.model}
                      {r.details_pending && <span className="chip w" style={{ marginLeft: 6 }} title="สร้างจากไฟล์ Excel ช่องที่ไฟล์ไม่มีเป็นค่าชั่วคราว">นำเข้าจาก Excel · รอกรอกข้อมูลเพิ่ม</span>}</div>
                  </td>
                  {central && <td>{r.hospital_name}</td>}
                  <td>{r.department_name}</td>
                  <td className="muted">{r.serial_no}</td>
                  <td className="c num">{r.purchase_year_be}</td>
                  <td className="r num">{baht(r.purchase_price)}</td>
                  <td className="c num">{ageYears(r.purchase_year_be)}</td>
                  <td><span className={`chip ${STATUS[r.status]?.tone ?? 'n'}`}>{STATUS[r.status]?.label ?? r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && !rows.length && (
          <div className="empty">
            ยังไม่มีครุภัณฑ์ตามเงื่อนไขนี้{can('equipment.write') && <> · <Link to="/equipment/new">ลงทะเบียนครุภัณฑ์รายการแรก</Link></>}
          </div>
        )}
      </div>
      <div className="note blue">อายุ (ปี) = MAX(ปีปัจจุบัน − ปีที่ซื้อ, 1) ตามสูตร Excel · ครุภัณฑ์ที่นำเข้าจาก Excel ใช้คะแนนจากไฟล์จนกว่าจะมีข้อมูลรายปีที่ยืนยันแล้ว</div>
    </>
  );
}
