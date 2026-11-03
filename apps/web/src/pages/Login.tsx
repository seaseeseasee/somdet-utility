import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const NEW = '__new';
const DEMO_ACCOUNTS = [
  ['PID-DEMO-A-ENTRY', 'เจ้าหน้าที่บันทึกข้อมูล — รพ.ตัวอย่าง A'],
  ['PID-DEMO-B-ENTRY', 'เจ้าหน้าที่บันทึกข้อมูล — รพ.ตัวอย่าง B'],
  ['PID-DEMO-CA', 'ผู้ดูแลระบบส่วนกลาง'],
  [NEW, 'เจ้าหน้าที่ใหม่ (จำลองข้อมูลจาก Provider ID)'],
];

const STEPS: [string, string][] = [
  ['นำเข้าข้อมูล', 'อัปโหลดไฟล์ Excel ตามแบบฟอร์ม หรือบันทึกข้อมูลรายปีของแต่ละเครื่อง'],
  ['ระบบคำนวณคะแนน', 'ตรวจความถูกต้องทุกแถว แล้วคิด Utility Score และอันดับให้อัตโนมัติ'],
  ['ใช้ประกอบการตัดสินใจ', 'ดู Dashboard เทียบหน่วยงาน/โรงพยาบาล และส่งออกรายงาน PDF / Excel'],
];
const FACTORS: [string, number][] = [
  ['Utilization', 25], ['Clinical', 20], ['Financial', 20], ['Reliability', 15], ['Satisfaction', 10], ['Strategic', 10],
];
const TRUST = ['ตรวจสอบที่มาได้ทุกคะแนน', 'แต่ละโรงพยาบาลเห็นเฉพาะข้อมูลของตน', 'ประวัติการแก้ไขตรวจสอบย้อนหลังได้'];

export function Login() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [cfg, setCfg] = useState<{ devLoginEnabled: boolean; oidcConfigured: boolean } | null>(null);
  const [pid, setPid] = useState(DEMO_ACCOUNTS[0]![0]);
  // ข้อมูลที่ Provider ID จะส่งมาเมื่อเชื่อมต่อจริง ใช้สร้างบัญชีเจ้าหน้าที่ครั้งแรก
  const [claims, setClaims] = useState({ providerId: '', name: '', hcode: '', hospitalName: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ devLoginEnabled: boolean; oidcConfigured: boolean }>('/api/auth/config').then(setCfg).catch(() => setCfg(null));
  }, []);
  if (me) return <Navigate to="/" replace />;

  const providerLogin = async () => {
    setMsg(null);
    try {
      await api.get('/api/auth/login');
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 501 ? 'ยังไม่ได้เชื่อมต่อ Provider ID รอเอกสาร API/OIDC จากผู้ดูแลระบบ' : 'เข้าสู่ระบบไม่สำเร็จ');
    }
  };
  const devLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/auth/dev-login', pid === NEW ? claims : { providerId: pid });
      await refresh();
      nav('/');
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="lg-l">
        <div className="brand">
          <div className="logo" style={{ width: 52, height: 52, fontSize: 20 }}>MU</div>
          <div>
            <b style={{ fontSize: 18 }}>Medical Equipment Utility Analysis</b>
            <small style={{ fontSize: 13 }}>ระบบวิเคราะห์ความคุ้มค่าครุภัณฑ์ทางการแพทย์</small>
          </div>
        </div>
        <div className="lg-hero">
          <h2>รู้ว่าครุภัณฑ์เครื่องไหนคุ้มค่า<br />ก่อนตัดสินใจซื้อ ซ่อม หรือทดแทน</h2>
          <p>นำเข้าไฟล์ Excel Utility Analysis หรือบันทึกข้อมูลรายปี ระบบคำนวณ Utility Score จาก 6 ปัจจัยให้ทันที และแสดงที่มาของทุกคะแนน</p>
        </div>

        <ol className="lg-steps" aria-label="ขั้นตอนการใช้งาน">
          {STEPS.map(([t, d], i) => (
            <li key={t}><span className="n">{i + 1}</span><div><b>{t}</b><span>{d}</span></div></li>
          ))}
        </ol>

        <div className="lg-factors">
          <div className="lg-cap">Utility Score = ผลรวมถ่วงน้ำหนัก 6 ปัจจัย (ค่าเริ่มต้น)</div>
          <div className="lg-fgrid">
            {FACTORS.map(([name, w]) => (
              <div key={name} className="lg-f">
                <div className="hrow between"><span>{name}</span><b className="num">{w}%</b></div>
                <div className="bar" aria-hidden><i style={{ width: `${w * 4}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <ul className="lg-trust">
          {TRUST.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="lg-foot">ระบบนี้ใช้สำหรับบุคลากรของหน่วยงานเท่านั้น การเข้าใช้งานทุกครั้งถูกบันทึก</p>
      </div>
      <div className="lg-r">
        <div className="lg-card">
          <div>
            <h3>เข้าสู่ระบบ</h3>
            <div className="muted" style={{ fontSize: 14 }}>ใช้บัญชี Provider ID ระบบจะพาไปยืนยันตัวตนที่หน้าของผู้ให้บริการ และไม่เก็บรหัสผ่าน</div>
          </div>
          <button className="btn p pid-btn" onClick={() => void providerLogin()} disabled={!cfg?.oidcConfigured}>
            เข้าสู่ระบบด้วย Provider ID
          </button>
          {!cfg?.oidcConfigured && <div className="note">ยังไม่ได้เชื่อมต่อ Provider ID — รอเอกสาร API/OIDC และ client_id จากผู้ดูแลระบบ</div>}
          {cfg?.devLoginEnabled && (
            <form className="stack note" onSubmit={devLogin} style={{ borderStyle: 'solid' }}>
              <b>โหมดพัฒนา (ไม่ใช่ Provider ID)</b>
              <div className="fld">
                <label htmlFor="pid">บัญชีตัวอย่าง (DEMO)</label>
                <select id="pid" className="in" value={pid} onChange={(e) => setPid(e.target.value)}>
                  {DEMO_ACCOUNTS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              {pid === NEW && (
                <>
                  {([['providerId', 'Provider ID'], ['name', 'ชื่อ-สกุล'], ['hcode', 'รหัสสถานพยาบาล (hcode)'], ['hospitalName', 'ชื่อโรงพยาบาล']] as const).map(([k, l]) => (
                    <div className="fld" key={k}>
                      <label htmlFor={`c-${k}`}>{l}</label>
                      <input id={`c-${k}`} className="in" required value={claims[k]} onChange={(e) => setClaims({ ...claims, [k]: e.target.value })} />
                    </div>
                  ))}
                  <span className="hint">เข้าครั้งแรกระบบสร้างบัญชีเจ้าหน้าที่ให้ทันที ถ้าโรงพยาบาลมีเจ้าหน้าที่อยู่แล้ว คนเดิมจะถูกระงับ</span>
                </>
              )}
              <button className="btn" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบแบบจำลอง'}</button>
              <span className="hint">ปิดอัตโนมัติเมื่อติดตั้งจริง (NODE_ENV=production)</span>
            </form>
          )}
          {msg && <div className="note red" role="alert">{msg}</div>}
        </div>
      </div>
    </div>
  );
}
