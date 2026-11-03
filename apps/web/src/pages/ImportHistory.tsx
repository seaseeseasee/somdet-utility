import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { thDate } from '../lib/format';

interface Batch {
  id: string; filename: string; uploaded_at: string; mode: string; sheets: string[]; row_count: number; registered_count: number;
  hospital_name: string; uploaded_by_name: string | null; active_rows: number;
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
