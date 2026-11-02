import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Option } from '../lib/api';
import { useAuth } from '../lib/auth';
import { thDate } from '../lib/format';

interface UserRow { id: string; provider_id: string; name: string; hospital_id: string | null; hospital_name: string | null; status: string; roles: string[]; last_login_at: string | null }

const ROLE_LABEL: Record<string, string> = {
  central_admin: 'ผู้ดูแลระบบส่วนกลาง', central_executive: 'ผู้บริหารส่วนกลาง', hospital_admin: 'ผู้ดูแลระบบโรงพยาบาล',
  data_entry: 'เจ้าหน้าที่บันทึกข้อมูล', reviewer: 'ผู้ตรวจสอบ', executive: 'ผู้บริหารโรงพยาบาล',
};
const HOSPITAL_ROLES = ['hospital_admin', 'data_entry', 'reviewer', 'executive'];
const STATUS: Record<string, [string, string]> = { active: ['ใช้งาน', 'g'], pending: ['รออนุมัติ', 'w'], suspended: ['ระงับ', 'r'] };

export function Users() {
  const { me } = useAuth();
  const central = me?.scope === 'all';
  const [users, setUsers] = useState<UserRow[]>([]);
  const [hospitals, setHospitals] = useState<Option[]>([]);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const [form, setForm] = useState({ providerId: '', name: '', hospitalId: '', roles: ['data_entry'] as string[] });
  const [editing, setEditing] = useState<string | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);

  const load = () => api.get<UserRow[]>('/api/users').then(setUsers, (e: Error) => setMsg({ tone: 'red', text: e.message }));
  useEffect(() => {
    void load();
    if (central) api.get<Option[]>('/api/hospitals').then(setHospitals);
  }, [central]);

  const roleChoices = (hospitalId: string | null) => (hospitalId ? HOSPITAL_ROLES : ['central_admin', 'central_executive']);
  const fail = (e: unknown) => setMsg({ tone: 'red', text: e instanceof ApiError ? e.message : 'ดำเนินการไม่สำเร็จ' });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/users', { ...form, hospitalId: central ? form.hospitalId || null : undefined });
      setMsg({ tone: 'blue', text: `เพิ่มผู้ใช้ ${form.name} แล้ว` });
      setForm({ providerId: '', name: '', hospitalId: '', roles: ['data_entry'] });
      void load();
    } catch (x) { fail(x); }
  };
  const update = async (u: UserRow, body: Record<string, unknown>) => {
    try {
      await api.put(`/api/users/${u.id}`, body);
      setMsg({ tone: 'blue', text: `บันทึกการเปลี่ยนแปลงของ ${u.name} แล้ว` });
      setEditing(null);
      void load();
    } catch (x) { fail(x); }
  };
  const formHospital = central ? form.hospitalId || null : me?.hospital?.id ?? null;

  return (
    <>
      <div className="note blue">ผู้ใช้เข้าสู่ระบบด้วย Provider ID ระบบเก็บเฉพาะ Provider ID และข้อมูลพื้นฐาน ไม่เก็บรหัสผ่าน · ผู้ใช้ที่ยังไม่มีบทบาทจะมีสถานะ “รออนุมัติ”</div>
      {msg && <div className={`note ${msg.tone}`} role="status">{msg.text}</div>}
      <form className="card stack" onSubmit={add}>
        <h3>เพิ่มผู้ใช้ด้วย Provider ID</h3>
        <div className="hrow" style={{ alignItems: 'flex-end' }}>
          <div className="fld" style={{ width: 220 }}><label htmlFor="pid">Provider ID <span className="req">*</span></label>
            <input id="pid" className="in" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} required minLength={3} /></div>
          <div className="fld" style={{ width: 260 }}><label htmlFor="nm">ชื่อ-สกุล <span className="req">*</span></label>
            <input id="nm" className="in" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          {central && (
            <div className="fld" style={{ width: 260 }}><label htmlFor="hs">โรงพยาบาล</label>
              <select id="hs" className="in" value={form.hospitalId} onChange={(e) => setForm({ ...form, hospitalId: e.target.value, roles: [] })}>
                <option value="">— ส่วนกลาง —</option>
                {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select></div>
          )}
          <div className="fld"><label>บทบาท</label>
            <div className="radios">
              {roleChoices(formHospital).map((r) => (
                <label key={r}><input type="checkbox" checked={form.roles.includes(r)}
                  onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...form.roles, r] : form.roles.filter((x) => x !== r) })} />{ROLE_LABEL[r]}</label>
              ))}
            </div></div>
          <button className="btn p">เพิ่มผู้ใช้</button>
        </div>
      </form>
      <div className="card flush"><div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>ชื่อ-สกุล</th><th>Provider ID</th>{central && <th>โรงพยาบาล</th>}<th>บทบาท</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.name}</td>
                <td className="code">{u.provider_id}</td>
                {central && <td>{u.hospital_name ?? 'ส่วนกลาง'}</td>}
                <td>
                  {editing === u.id ? (
                    <div className="radios">
                      {roleChoices(u.hospital_id).map((r) => (
                        <label key={r}><input type="checkbox" checked={editRoles.includes(r)}
                          onChange={(e) => setEditRoles(e.target.checked ? [...editRoles, r] : editRoles.filter((x) => x !== r))} />{ROLE_LABEL[r]}</label>
                      ))}
                    </div>
                  ) : u.roles.length ? u.roles.map((r) => <span key={r} className="role">{ROLE_LABEL[r]}</span>) : <span className="muted">ยังไม่กำหนด</span>}
                </td>
                <td><span className={`chip ${STATUS[u.status]?.[1]}`}>{STATUS[u.status]?.[0]}</span></td>
                <td className="muted num">{thDate(u.last_login_at, true)}</td>
                <td>
                  <div className="hrow">
                    {editing === u.id ? (
                      <>
                        <button className="btn sm p" type="button" onClick={() => void update(u, { roles: editRoles, status: editRoles.length ? 'active' : 'pending' })}>บันทึก</button>
                        <button className="btn sm" type="button" onClick={() => setEditing(null)}>ยกเลิก</button>
                      </>
                    ) : (
                      <>
                        <button className="btn sm" type="button" onClick={() => { setEditing(u.id); setEditRoles(u.roles); }}>แก้ไขสิทธิ์</button>
                        {u.id !== me?.id && (u.status === 'suspended'
                          ? <button className="btn sm ghost" type="button" onClick={() => void update(u, { status: 'active' })}>เปิดใช้งาน</button>
                          : <button className="btn sm ghost" type="button" onClick={() => void update(u, { status: 'suspended' })}>ระงับ</button>)}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}
