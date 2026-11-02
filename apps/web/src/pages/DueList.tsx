import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Cycle, type Option, type TaskRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { thDate } from '../lib/format';

export const TASK_TONE: Record<string, string> = { not_started: 'n', in_progress: 'b', rejected: 'r', submitted: 'w', approved: 'g' };
const KPI: [string, string, string][] = [
  ['total', 'ครบกำหนดทั้งหมด', ''], ['not_started', 'ยังไม่เริ่ม', ''], ['in_progress', 'กำลังบันทึก', ''],
  ['submitted', 'รอตรวจสอบ', 'w'], ['rejected', 'ถูกตีกลับ', 'r'], ['approved', 'ยืนยันแล้ว', 'g'],
];

export function DueList() {
  const { me, can } = useAuth();
  const admin = can('cycle.manage');
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [cycleId, setCycleId] = useState<string>('');
  const [data, setData] = useState<{ cycle: Cycle; summary: Record<string, number>; tasks: TaskRow[] } | null>(null);
  const [mine, setMine] = useState(false);
  const [filter, setFilter] = useState('');
  const [people, setPeople] = useState<Option[]>([]);
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const loadCycles = useCallback(async () => {
    const r = await api.get<{ cycles: Cycle[]; suggestedFiscalYear: number }>('/api/cycles');
    setCycles(r.cycles);
    setSuggested(r.suggestedFiscalYear);
    setCycleId((cur) => cur || r.cycles.find((c) => c.status === 'open')?.id || r.cycles[0]?.id || '');
  }, []);
  const [tick, setTick] = useState(0);

  useEffect(() => { void loadCycles(); if (admin) api.get<Option[]>('/api/assignees').then(setPeople); }, [loadCycles, admin]);
  // โหลดรายการใหม่เมื่อเปลี่ยนรอบ/ตัวกรอง หรือหลังดำเนินการ และไม่ใช้ผลของคำขอเก่าที่ตอบกลับช้ากว่า
  useEffect(() => {
    let stale = false;
    if (!cycleId) { setData(null); return; }
    api.get<{ cycle: Cycle; summary: Record<string, number>; tasks: TaskRow[] }>(`/api/cycles/${cycleId}/tasks${mine ? '?mine=1' : ''}`)
      .then((d) => { if (!stale) setData(d); });
    return () => { stale = true; };
  }, [cycleId, mine, tick]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: 'blue', text: typeof r === 'string' ? r : ok });
      await loadCycles();
      setTick((t) => t + 1);
    }
    catch (e) { setMsg({ tone: 'red', text: e instanceof ApiError ? e.message : 'ดำเนินการไม่สำเร็จ' }); }
  };
  const openCycle = () => run(async () => {
    const c = await api.post<{ id: string; tasksCreated: number }>('/api/cycles', { fiscalYearBe: suggested });
    setCycleId(c.id);
  }, `เปิดรอบประเมินปีงบ ${suggested} แล้ว`);

  const hasSuggested = cycles?.some((c) => c.fiscal_year_be === suggested && c.hospital_id === me?.hospital?.id);
  const tasks = (data?.tasks ?? []).filter((t) => !filter || t.status === filter);
  const c = data?.cycle;
  const s = data?.summary;
  const step = !c ? 0 : c.status === 'closed' ? 4 : s && s.total && s.approved === s.total ? 3 : 2;

  return (
    <>
      {msg && <div className={`note ${msg.tone}`} role="status">{msg.text}</div>}
      {admin && suggested && cycles && !hasSuggested && (
        <div className="card hrow between">
          <div>
            <b>ยังไม่ได้เปิดรอบประเมินปีงบ {suggested}</b>
            <div className="muted">ระบบจะสร้างรายการครบกำหนดจากครุภัณฑ์ที่ใช้งาน/พร้อมใช้/ซ่อม ทุกเครื่อง · เปิดรับ 1–31 ต.ค. {suggested}</div>
          </div>
          <button className="btn p" onClick={() => void openCycle()}>เปิดรอบประเมินปีงบ {suggested}</button>
        </div>
      )}
      {cycles && !cycles.length && !admin && <div className="card empty">ยังไม่มีรอบประเมิน รอผู้ดูแลระบบโรงพยาบาลเปิดรอบ</div>}
      {c && (
        <div className="card hrow between" style={{ background: 'linear-gradient(90deg,#eaf3fc,#fff)' }}>
          <div>
            <div className="muted">รอบการประเมิน{me?.scope === 'all' ? ` · ${c.hospital_name}` : ''}</div>
            <div className="hrow">
              <b style={{ fontSize: 20, color: 'var(--navy)' }}>ปีงบประมาณ {c.fiscal_year_be}</b>
              <span className={`chip ${c.status === 'open' ? 'b' : 'n'}`}>{c.status === 'open' ? 'เปิดรับข้อมูล' : 'ปิดรอบแล้ว'}</span>
              {cycles && cycles.length > 1 && (
                <select className="in" style={{ width: 'auto' }} value={cycleId} onChange={(e) => setCycleId(e.target.value)} aria-label="เลือกรอบ">
                  {cycles.map((x) => <option key={x.id} value={x.id}>ปีงบ {x.fiscal_year_be}{me?.scope === 'all' ? ` · ${x.hospital_name}` : ''}</option>)}
                </select>
              )}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-2)' }}>
              ข้อมูล {thDate(c.period.from)} – {thDate(c.period.to)} · ปิดรับ {thDate(c.closes_at)} · ผลใช้วางแผนปีงบ <b>{c.planFiscalYear}</b>
            </div>
          </div>
          <div className="steps" aria-label="ขั้นตอนรอบประเมิน">
            {['เปิดรอบ', 'ตรวจ/บันทึก', 'ยืนยันข้อมูล', 'ปิดรอบ'].map((l, i) => (
              <span key={l} className={`st ${i + 1 < step || step === 4 ? 'done' : i + 1 === step ? 'cur' : ''}`}><span className="c">{i + 1 < step || step === 4 ? '✓' : i + 1}</span>{l}</span>
            ))}
          </div>
        </div>
      )}
      {s && (
        <div className="kpis">
          {KPI.map(([k, l, t]) => (
            <button key={k} className={`kpi ${t} ${filter === k || (!filter && k === 'total') ? 'sel' : ''}`} onClick={() => setFilter(k === 'total' ? '' : k)}>
              <div className="l">{l}</div><div className="v num">{s[k] ?? 0}</div>
            </button>
          ))}
        </div>
      )}
      {data && (
        <div className="card flush">
          <div className="hrow between" style={{ padding: '12px 16px' }}>
            <label className="hrow" style={{ fontSize: 14 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> เฉพาะงานที่มอบหมายให้ฉัน</label>
            {admin && c?.status === 'open' && (
              <div className="hrow">
                <button className="btn sm" onClick={() => void run(async () => {
                  const r = await api.post<{ tasksCreated: number }>(`/api/cycles/${c.id}/regenerate`);
                  return r.tasksCreated ? `เพิ่มครุภัณฑ์ใหม่เข้ารอบ ${r.tasksCreated} รายการ` : 'ไม่มีครุภัณฑ์ใหม่ · ปรับเหตุที่ครบกำหนดของรายการเดิมแล้ว';
                }, '')}>เพิ่มครุภัณฑ์ใหม่เข้ารอบ</button>
                {!confirmClose ? <button className="btn sm" onClick={() => setConfirmClose(true)}>ปิดรอบประเมิน</button> : (
                  <span className="hrow note red" style={{ padding: '4px 10px' }}>
                    ล็อกข้อมูลที่ยืนยันแล้ว {s?.approved} รายการ ({(s?.total ?? 0) - (s?.approved ?? 0)} รายการยังไม่ยืนยัน)
                    <button className="btn sm p" onClick={() => { setConfirmClose(false); void run(() => api.post(`/api/cycles/${c.id}/close`), 'ปิดรอบประเมินแล้ว'); }}>ยืนยันปิดรอบ</button>
                    <button className="btn sm" onClick={() => setConfirmClose(false)}>ยกเลิก</button>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>ครุภัณฑ์</th><th>เหตุที่ครบกำหนด</th><th>ผู้รับผิดชอบ</th><th>กำหนดส่ง</th><th className="r">ครบถ้วน</th><th>สถานะ</th><th></th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 600 }}>{t.equipment.name}</div>
                      <div className="muted"><span className="code">{t.equipment.code}</span> · {t.equipment.department}</div>
                      {t.rejection && <div className="note red" style={{ marginTop: 6, padding: '6px 10px', fontSize: 12.5 }}>ตีกลับโดย {t.rejection.by}: “{t.rejection.reason}”</div>}
                    </td>
                    <td>{t.reasons.map((r, i) => <span key={r.code} className={`chip ${i ? 'w' : 'n'}`} style={{ margin: '2px 4px 2px 0' }}>{r.label}</span>)}</td>
                    <td>
                      {admin && c?.status === 'open' ? (
                        <select className="in" style={{ height: 34, minWidth: 170 }} value={t.assignee?.id ?? ''} aria-label={`ผู้รับผิดชอบ ${t.equipment.code}`}
                          onChange={(e) => void run(() => api.put(`/api/tasks/${t.id}`, { assigneeId: e.target.value || null }), `มอบหมาย ${t.equipment.code} แล้ว`)}>
                          <option value="">— ยังไม่มอบหมาย —</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (t.assignee?.name ?? <span className="muted">ยังไม่มอบหมาย</span>)}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{thDate(t.dueDate)}</td>
                    <td className="r num">{t.completeness}%</td>
                    <td><span className={`chip ${TASK_TONE[t.status]}`}>{t.statusLabel}</span></td>
                    <td>
                      <Link className={`btn sm ${['not_started', 'in_progress', 'rejected'].includes(t.status) && can('annual.write') && c?.status === 'open' ? 'p' : ''}`}
                        to={`/equipment/${t.equipment.id}/annual/${c?.fiscal_year_be}`}>
                        {t.status === 'not_started' && can('annual.write') ? 'เริ่มตรวจ/บันทึก' : ['in_progress', 'rejected'].includes(t.status) && can('annual.write') ? 'บันทึกต่อ' : 'ดู'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!tasks.length && <div className="empty">ไม่มีรายการตามเงื่อนไขนี้</div>}
        </div>
      )}
      <div className="note blue">ขั้นตอนเจ้าหน้าที่: ① ตรวจสภาพเครื่องจริงและตรวจกับทะเบียน ② กรอกข้อมูลการใช้งาน ค่าใช้จ่าย Downtime และคะแนน 1–5 ของปีงบนี้ ③ บันทึกประวัติซ่อมบำรุง ④ ส่งให้ผู้ตรวจสอบของโรงพยาบาล</div>
    </>
  );
}
