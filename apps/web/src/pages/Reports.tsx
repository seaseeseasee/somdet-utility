import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { latestFiscalYear as latestYear, thDate } from '../lib/format';
import { useOptions } from '../lib/useApi';

const SORT: [string, string][] = [['score_desc', 'Utility Score (มาก → น้อย)'], ['score_asc', 'Utility Score (น้อย → มาก)'], ['code', 'รหัสครุภัณฑ์'], ['department', 'หน่วยงาน']];
interface Recent { at: string; actor_name: string | null; after: { format: string; year: number; scope: string; file: string; rows: number } }

export function Reports() {
  const { me } = useAuth();
  const central = me?.scope === 'all';
  const [sections, setSections] = useState<{ key: string; label: string }[]>([]);
  const [sel, setSel] = useState<string[]>(['kpi', 'chart', 'ranking', 'factors', 'method']);
  const [year, setYear] = useState(latestYear());
  const [hospital, setHospital] = useState('');
  const [dept, setDept] = useState('');
  const [sort, setSort] = useState('score_desc');
  const [sig, setSig] = useState({ preparedBy: '', reviewedBy: '', approvedBy: '', preparedAt: '', reviewedAt: '', approvedAt: '' });
  const opts = useOptions(central ? '/api/hospitals' : '/api/departments');
  const [html, setHtml] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const loadRecent = () => api.get<Recent[]>('/api/reports/recent').then(setRecent, () => undefined);
  useEffect(() => {
    api.get<{ sections: { key: string; label: string }[] }>('/api/reports/options').then((r) => setSections(r.sections));
    void loadRecent();
  }, [central]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ year: String(year), sort, sections: sel.join(',') });
    if (hospital) p.set('hospitalId', hospital);
    if (dept) p.set('departmentId', dept);
    for (const [k, v] of Object.entries(sig)) if (v.trim()) p.set(k, v.trim());
    return p.toString();
  }, [year, sort, sel, hospital, dept, sig]);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/reports/executive/preview?${query}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'โหลดตัวอย่างไม่สำเร็จ');
        const text = await res.text();
        if (!stale) { setHtml(text); setErr(null); }
      } catch (e) { if (!stale) setErr((e as Error).message); }
    }, 400);
    return () => { stale = true; clearTimeout(t); };
  }, [query]);

  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const afterDownload = () => setTimeout(() => void loadRecent(), 2500);

  return (
    <div className="split rep">
      <div className="stack">
        <div className="card stack">
          <h3>ตั้งค่ารายงาน</h3>
          <div className="fld"><label htmlFor="tpl">แบบรายงาน</label><select id="tpl" className="in"><option>สรุปผล Utility Score เพื่อวางแผนจัดซื้อ</option></select></div>
          <div className="fld"><label htmlFor="fy">ปีที่วิเคราะห์ (ปีงบ)</label>
            <select id="fy" className="in" value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 5 }, (_, i) => latestYear() - i).map((y) => <option key={y}>{y}</option>)}</select></div>
          {central ? (
            <div className="fld"><label htmlFor="hs">โรงพยาบาล</label>
              <select id="hs" className="in" value={hospital} onChange={(e) => setHospital(e.target.value)}><option value="">ทุกโรงพยาบาล</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          ) : (
            <div className="fld"><label htmlFor="dp">หน่วยงาน</label>
              <select id="dp" className="in" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">ทุกหน่วยงาน</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          )}
          <div className="fld"><label htmlFor="st">เรียงลำดับ</label>
            <select id="st" className="in" value={sort} onChange={(e) => setSort(e.target.value)}>{SORT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="fld"><label>ส่วนที่แสดง</label>
            <div className="stack" style={{ gap: 6, fontSize: 14 }}>
              {sections.map((s) => <label key={s.key} className="hrow" style={{ fontWeight: 400 }}><input type="checkbox" checked={sel.includes(s.key)} onChange={() => toggle(s.key)} />{s.label}</label>)}
            </div></div>
          <div className="fld"><label>ชื่อและวันที่ลงนาม (ไม่บังคับ)</label>
            {([['preparedBy', 'preparedAt', 'ผู้จัดทำ'], ['reviewedBy', 'reviewedAt', 'ผู้ตรวจสอบ'], ['approvedBy', 'approvedAt', 'ผู้อนุมัติ']] as const).map(([k, d, l]) => (
              <div key={k} className="hrow" style={{ marginBottom: 6, gap: 6 }}>
                <input className="in" aria-label={l} placeholder={l} maxLength={100} value={sig[k]} onChange={(e) => setSig({ ...sig, [k]: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
                <input className="in" type="date" aria-label={`วันที่ลงนาม ${l}`} title="เว้นว่าง = เว้นเส้นไว้เขียนด้วยมือ" value={sig[d]} onChange={(e) => setSig({ ...sig, [d]: e.target.value })} style={{ width: 150 }} />
              </div>
            ))}</div>
          <div className="note blue" style={{ fontSize: 12.5 }}>รายงานใช้เฉพาะข้อมูลที่ยืนยันแล้วเสมอ และระบุเวอร์ชันสูตรในรายงาน</div>
          <div className="hrow">
            <a className="btn" style={{ flex: 1, justifyContent: 'center' }} href={`/api/reports/executive.xlsx?${query}`} download onClick={afterDownload}>ส่งออก Excel</a>
            <a className="btn p" style={{ flex: 1, justifyContent: 'center' }} href={`/api/reports/executive.pdf?${query}`} download onClick={afterDownload}>ส่งออก PDF</a>
          </div>
        </div>
        <div className="card stack">
          <h3>รายงานที่ส่งออกล่าสุด</h3>
          {!recent.length && <div className="muted">ยังไม่มี</div>}
          {recent.map((r, i) => (
            <div key={i} className="hrow" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', flexWrap: 'nowrap' }}>
              <span className={`chip ${r.after.format === 'pdf' ? 'r' : 'g'}`} style={{ flex: 'none' }}>{r.after.format.toUpperCase()}</span>
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{r.after.file}</div>
                <div className="muted">{r.actor_name ?? '—'} · {thDate(r.at, true)} · {r.after.rows} รายการ</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ background: '#e9eef5' }}>
        <div className="hrow between" style={{ marginBottom: 12 }}><b>ตัวอย่างก่อนพิมพ์ (A4)</b><span className="muted">เนื้อหาเดียวกับไฟล์ PDF</span></div>
        {err && <div className="note red">{err}</div>}
        {html ? (
          <iframe title="ตัวอย่างรายงาน" sandbox="" srcDoc={html}
            style={{ width: '100%', maxWidth: 820, height: 1100, border: 0, background: '#fff', boxShadow: '0 4px 24px rgba(16,40,80,.12)', display: 'block', margin: '0 auto' }} />
        ) : !err && <div className="empty">กำลังสร้างตัวอย่าง…</div>}
      </div>
    </div>
  );
}
