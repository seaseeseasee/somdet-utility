import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { thDate } from '../lib/format';

interface Row { id: string; fiscal_year_be: number; submitted_at: string; equipment_id: string; code: string; name: string; department_name: string; hospital_name: string; updated_by_name: string | null; canApprove: boolean }

export function ReviewQueue() {
  const { me, can } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { api.get<Row[]>('/api/review-queue').then(setRows); }, []);
  return (
    <>
      <div className="note blue">ข้อมูลที่เจ้าหน้าที่ส่งตรวจสอบแล้ว · ผู้ตรวจสอบยืนยันข้อมูลที่ตนเองบันทึกหรือแก้ไขไม่ได้{!can('annual.review') && ' · ท่านดูได้อย่างเดียว'}</div>
      <div className="card flush"><div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>ครุภัณฑ์</th>{me?.scope === 'all' && <th>โรงพยาบาล</th>}<th>หน่วยงาน</th><th className="c">ปีงบ</th><th>ผู้บันทึกล่าสุด</th><th>ส่งเมื่อ</th><th></th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="code">{r.code}</div></td>
                {me?.scope === 'all' && <td>{r.hospital_name}</td>}
                <td>{r.department_name}</td>
                <td className="c num">{r.fiscal_year_be}</td>
                <td>{r.updated_by_name ?? '—'}</td>
                <td className="muted num">{thDate(r.submitted_at, true)}</td>
                <td><Link className={`btn sm ${r.canApprove ? 'p' : ''}`} to={`/equipment/${r.equipment_id}/annual/${r.fiscal_year_be}`}>{r.canApprove ? 'ตรวจสอบ' : 'ดู'}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows && !rows.length && <div className="empty">ไม่มีข้อมูลรอตรวจสอบ</div>}
      </div>
    </>
  );
}
