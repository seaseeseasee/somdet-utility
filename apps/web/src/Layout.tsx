import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';

type Item = { to: string; label: string; perm?: string; soon?: string; central?: boolean };
const NAV: [string, Item[]][] = [
  ['ภาพรวม', [
    { to: '/network', label: 'ภาพรวมเครือข่าย', central: true, soon: 'S5' },
    { to: '/dashboard', label: 'Dashboard โรงพยาบาล', soon: 'S5' },
  ]],
  ['ครุภัณฑ์', [
    { to: '/due', label: 'ครบกำหนดประเมิน', perm: 'equipment.read' },
    { to: '/equipment', label: 'ทะเบียนครุภัณฑ์', perm: 'equipment.read' },
    { to: '/review', label: 'รอตรวจสอบ / ยืนยัน', perm: 'equipment.read' },
  ]],
  ['วิเคราะห์', [
    { to: '/scores', label: 'ผลวิเคราะห์ Utility Score', perm: 'dashboard.view' },
    { to: '/reports', label: 'รายงานผู้บริหาร', soon: 'S6' },
  ]],
  ['ระบบ', [{ to: '/users', label: 'ผู้ใช้งานและสิทธิ์', perm: 'users.manage' }]],
];
const TITLES: Record<string, string> = { equipment: 'ทะเบียนครุภัณฑ์', users: 'ผู้ใช้งานและสิทธิ์', due: 'รายการครบกำหนดประเมิน', review: 'รอตรวจสอบ / ยืนยัน', scores: 'ผลการวิเคราะห์ Utility Score' };

export function Layout() {
  const { me, logout, can } = useAuth();
  const loc = useLocation();
  if (!me) return null;
  const isCentral = me.scope === 'all';
  const section = loc.pathname.split('/')[1] ?? '';
  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="logo">MU</div>
          <div>
            <b>Medical Equipment Utility Analysis</b>
            <small>ระบบวิเคราะห์ความคุ้มค่าครุภัณฑ์</small>
          </div>
        </div>
        <nav className="nav" aria-label="เมนูหลัก">
          {NAV.map(([g, items]) => {
            const vis = items.filter((i) => (!i.perm || can(i.perm)) && (!i.central || isCentral));
            if (!vis.length) return null;
            return (
              <div key={g} style={{ display: 'contents' }}>
                <div className="grp">{g}</div>
                {vis.map((i) => (
                  <NavLink key={i.to} to={i.to}>
                    {i.label}
                    {i.soon && <span className="soon" title="อยู่ระหว่างพัฒนา">{i.soon}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="foot">
          ชุดสูตร: <b>v1.1 (อนุมัติแล้ว)</b>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div>
            <div className="crumb">ระบบวิเคราะห์ความคุ้มค่าครุภัณฑ์</div>
            <h1>{loc.pathname.includes('/annual/') ? 'บันทึกข้อมูลรายปี' : (TITLES[section] ?? '')}</h1>
          </div>
          <div className="sp" />
          <span className="pill hosp">{me.hospital?.name ?? 'ทุกโรงพยาบาล (ส่วนกลาง)'}</span>
          <div className="user">
            <div className="av" aria-hidden>{me.name.slice(0, 2)}</div>
            <div>
              <div>{me.name}</div>
              {me.roles.map((r) => (
                <span className="role" key={r.role}>{r.label}</span>
              ))}
            </div>
            <button className="btn sm ghost" onClick={() => void logout()}>ออกจากระบบ</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
