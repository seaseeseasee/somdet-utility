import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { useAuth } from './lib/auth';

type Item = { to: string; label: string; perm?: string; soon?: string; central?: boolean; end?: boolean };
const NAV: [string, Item[]][] = [
  ['ภาพรวม', [
    { to: '/network', label: 'ภาพรวมเครือข่าย', central: true },
    { to: '/dashboard', label: 'Dashboard โรงพยาบาล', perm: 'dashboard.view' },
  ]],
  ['ครุภัณฑ์', [
    { to: '/equipment', label: 'ทะเบียนครุภัณฑ์', perm: 'equipment.read' },
  ]],
  ['วิเคราะห์', [
    { to: '/scores', label: 'ผลวิเคราะห์ Utility Score', perm: 'dashboard.view' },
    { to: '/reports', label: 'รายงานผู้บริหาร', perm: 'report.export' },
  ]],
  ['ระบบ', [
    { to: '/formula', label: 'สมมติฐานและน้ำหนักคะแนน', perm: 'dashboard.view' },
    { to: '/users', label: 'ผู้ใช้งานและสิทธิ์', perm: 'users.manage' },
  ]],
];
const TITLES: Record<string, string> = { equipment: 'ทะเบียนครุภัณฑ์', users: 'ผู้ใช้งานและสิทธิ์', scores: 'ผลการวิเคราะห์ Utility Score', dashboard: 'Dashboard โรงพยาบาล', network: 'Dashboard ภาพรวมเครือข่าย', reports: 'รายงานสำหรับผู้บริหาร', formula: 'สมมติฐานและน้ำหนักคะแนน' };

export function Layout() {
  const { me, logout, can } = useAuth();
  const [formula, setFormula] = useState<string | null>(null);
  const loc = useLocation();
  // เวอร์ชันชุดสูตรที่ใช้อยู่ (อัปเดตเมื่อเปลี่ยนหน้า เช่น หลังผู้ดูแลปรับน้ำหนัก)
  useEffect(() => { if (me) api.get<{ version: string }>('/api/formula-sets/current').then((r) => setFormula(r.version), () => undefined); }, [me, loc.pathname]);
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
                  <NavLink key={i.to} to={i.to} end={i.end}>
                    {i.label}
                    {i.soon && <span className="soon" title="อยู่ระหว่างพัฒนา">{i.soon}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="foot">
          ชุดสูตร: <Link to="/formula"><b>{formula ? `v${formula}` : '…'}</b></Link>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div>
            <div className="crumb">ระบบวิเคราะห์ความคุ้มค่าครุภัณฑ์</div>
            <h1>{loc.pathname.includes('/annual/') ? 'บันทึกข้อมูลรายปี' : loc.pathname === '/equipment/import' ? 'นำเข้าครุภัณฑ์จากไฟล์ Excel' : (TITLES[section] ?? '')}</h1>
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
