import { Link, useParams } from 'react-router-dom';
import { type Equipment, type ScoreDetail, type YearList } from '../lib/api';
import { f1, ScoreBadge } from '../lib/score';
import { useApi } from '../lib/useApi';
import { Breakdown } from './Scores';
import { TrendCharts } from './TrendCharts';
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
  const { data: e, error: err } = useApi<Equipment>(`/api/equipment/${id}`);
  // ประวัติการแก้ไขดูได้เฉพาะผู้มีสิทธิ์ (ไม่มีสิทธิ์ = แสดงว่าไม่มีประวัติ)
  const hist = useApi<HistoryRow[]>(`/api/equipment/${id}/history`).data ?? [];
  const { data: years, error: yearsErr } = useApi<YearList>(`/api/equipment/${id}/annual`);
  const { data: score, error: scoreErr } = useApi<ScoreDetail>(`/api/equipment/${id}/score`);

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
      {(yearsErr || scoreErr) && <div className="note red">โหลดข้อมูลรายปีหรือคะแนนไม่ได้: {yearsErr ?? scoreErr}</div>}
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
          <div className="card flush">
            <div style={{ padding: '16px 20px 6px' }}><h3>ข้อมูลรายปี (ปีงบประมาณ)</h3><div className="sub">แต่ละปีบันทึกแยกกัน แก้ปีหนึ่งไม่กระทบปีอื่น</div></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>ปีงบประมาณ</th><th>สถานะ</th><th className="r">ครบถ้วน</th><th>แก้ไขล่าสุด</th><th></th></tr></thead>
              <tbody>
                {(years?.years ?? []).slice().reverse().map((y) => (
                  <tr key={y.fiscalYear}>
                    <td className="num">{y.fiscalYear}{y.fiscalYear === years?.currentFiscalYear && <span className="muted"> (ปีปัจจุบัน)</span>}</td>
                    <td><span className={`chip ${{ draft: 'b', submitted: 'w', approved: 'g', locked: 'n' }[y.status ?? ''] ?? 'n'}`}>{y.statusLabel}</span></td>
                    <td className="r num">{y.recordId ? `${y.completeness}%` : '—'}</td>
                    <td className="muted">{thDate(y.updatedAt, true)}</td>
                    <td><Link className="btn sm" to={`/equipment/${e.id}/annual/${y.fiscalYear}`}>{y.recordId ? 'เปิด' : can('annual.write') ? 'บันทึก' : 'ดู'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
          {score && (
            <div className="card stack">
              <div className="hrow between"><h3>Utility Score ปีงบ {score.year}</h3><span className="badge-v">ชุดสูตร v{score.formula.version} · ข้อมูลปีงบ {score.window.from}–{score.window.to}</span></div>
              <Breakdown equipmentId={e.id} year={score.year} />
            </div>
          )}
          {score && score.annual.some((x) => x.confirmed) && <TrendCharts s={score} />}
          {score && score.annual.length > 0 && (
            <div className="card flush">
              <div style={{ padding: '16px 20px 6px' }}><h3>แนวโน้มรายปี</h3><div className="sub">Score รายปีใช้ข้อมูลปีเดียวเพื่อดูแนวโน้ม (D-02) · คำนวณเฉพาะปีที่ยืนยันแล้ว</div></div>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>ปีงบ</th><th className="r">Utilization</th><th className="r">Downtime</th><th className="r">ค่าบำรุงรักษา</th><th className="r">รายได้</th><th className="r">เคส</th><th className="c">Score รายปี</th></tr></thead>
                <tbody>
                  {score.annual.map((a) => (
                    <tr key={a.fiscalYear}>
                      <td className="num">{a.fiscalYear} {!a.confirmed && <span className="muted">(ยังไม่ยืนยัน)</span>}</td>
                      <td className="r num">{a.metrics?.utilizationPctHours != null ? `${f1(a.metrics.utilizationPctHours)}%` : '—'}</td>
                      <td className="r num">{a.metrics?.downtimePct != null ? `${f1(a.metrics.downtimePct)}%` : '—'}</td>
                      <td className="r num">{a.metrics ? baht(a.metrics.maintenanceCost) : '—'}</td>
                      <td className="r num">{baht(a.revenue)}</td>
                      <td className="r num">{baht(a.caseCount)}</td>
                      <td className="c">{a.annualScore !== null ? <ScoreBadge v={a.annualScore} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
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
