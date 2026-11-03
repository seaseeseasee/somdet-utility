import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const S: Record<string, ReturnType<typeof env.as>> = {};
const eq: Record<string, string> = {};
const Y = 2569; // ปีวิเคราะห์ (ระบุชัดเจนเพื่อไม่ขึ้นกับวันที่รันทดสอบ)

/** ใส่ข้อมูลรายปีที่ยืนยันแล้วโดยตรง (fixture) */
async function approved(code: string, fy: number, o: Record<string, unknown> = {}, status = 'approved') {
  const c = new pg.Client({ connectionString: env.adminUrl });
  await c.connect();
  await c.query("SELECT set_config('app.scope','all',false)");
  const e = (await c.query('SELECT id, hospital_id, created_by FROM equipment WHERE id = $1', [eq[code]])).rows[0];
  const v = {
    available_days: 250, actual_days: 200, max_available_hours: 1000, actual_hours: 780, use_count: 2400, case_count: 2400,
    repair_cost: 300000, parts_cost: 0, pm_cost: 0, calibration_cost: 0, other_cost: 0, revenue: 5350000, no_direct_revenue: false,
    repair_days: 5, breakdown_count: 1, downtime_hours: 30, clinical_rating: 4, satisfaction_rating: 4, strategic_rating: 4, ...o,
  };
  const cols = Object.keys(v);
  await c.query(
    `INSERT INTO annual_record (hospital_id, equipment_id, fiscal_year_be, status, created_by, updated_by, ${cols.join(',')})
     VALUES ($1,$2,$3,$4,$5,$5,${cols.map((_, i) => `$${i + 6}`).join(',')})`,
    [e.hospital_id, e.id, fy, status, e.created_by, ...Object.values(v)],
  );
  await c.end();
}

beforeAll(async () => {
  env = await setupTestEnv();
  for (const [k, pid] of Object.entries({ ca: 'PID-DEMO-CA', aEntry: 'PID-DEMO-A-ENTRY', bEntry: 'PID-DEMO-B-ENTRY' }))
    S[k] = env.as((await env.login(pid)).cookie);
  for (const r of (await S.ca!.get('/api/equipment?pageSize=200')).json().rows) eq[r.code] = r.id;
});
afterAll(async () => env?.teardown());

const scores = async (s = 'aEntry', q = '') => (await S[s]!.get(`/api/scores?year=${Y}${q}`)).json();
const row = (r: { rows: { equipment: { code: string } }[] }, code: string) => r.rows.find((x) => x.equipment.code === code) as Record<string, any>;

describe('Utility Score จากข้อมูลรายปี', () => {
  it('ยังไม่มีข้อมูลยืนยัน → ไม่มีคะแนน พร้อมเหตุผล', async () => {
    const r = await scores();
    expect(r.formula.version).toBe('1.1');
    expect(r.window).toEqual({ from: 2565, to: 2569 });
    expect(r.summary.scored).toBe(0);
    expect(row(r, 'DEMO-001').status).toBe('no_data');
    expect(row(r, 'DEMO-001').problems[0]).toMatch(/ยืนยัน/);
  });

  it('รวม 4 ปีงบ (2566–2569) ได้ค่าเท่ากับแถว CT Scan ใน Excel = 75.536', async () => {
    for (const fy of [2566, 2567, 2568, 2569]) await approved('DEMO-001', fy);
    const r = row(await scores(), 'DEMO-001');
    expect(r.status).toBe('scored');
    expect(r.dataYears).toEqual([2566, 2567, 2568, 2569]);
    expect(r.utilizationPct).toBeCloseTo(78, 9);
    expect(r.paybackYears).toBeCloseTo(3.504672897, 8);
    expect(r.utilityScore).toBeCloseTo(75.53598131, 7);
    expect(r.recommendationText).toBe('คงสภาพ ติดตามต่อเนื่อง');
    expect(r.rank).toBe(1);
  });

  it('ใช้เฉพาะข้อมูลที่ยืนยัน/ล็อกแล้ว (ร่างและรอตรวจไม่นับ)', async () => {
    await approved('DEMO-002', 2569, {}, 'submitted');
    await approved('DEMO-003', 2569, {}, 'draft');
    const r = await scores();
    expect(row(r, 'DEMO-002').status).toBe('no_data');
    expect(row(r, 'DEMO-003').status).toBe('no_data');
  });

  it('ข้อมูลผิดหรือไม่ครบ → ไม่คำนวณ และบอกเหตุผล (D-05, D-08)', async () => {
    await approved('DEMO-004', 2569, { revenue: 0, no_direct_revenue: false });
    const r = row(await scores(), 'DEMO-004');
    expect(r.status).toBe('incomplete');
    expect(r.problems.join(' ')).toMatch(/ไม่มีรายได้ตรง/);
  });

  it('D-16: เครื่องอายุเกิน 5 ปี ใช้ตัวหาร = จำนวนปีที่มีข้อมูล และข้อมูลเก่ากว่า 5 ปีงบไม่นับ', async () => {
    // DEMO-008 ซื้อ 2562 (อายุ 7 ปี ณ 2569)
    for (const fy of [2564, 2565, 2566, 2567, 2568, 2569]) await approved('DEMO-008', fy, { revenue: 500000 });
    const d = (await S.aEntry!.get(`/api/equipment/${eq['DEMO-008']}/score?year=${Y}`)).json();
    expect(d.outcome.status).toBe('scored');
    expect(d.outcome.years).toEqual([2565, 2566, 2567, 2568, 2569]);
    expect(d.outcome.breakdown.ageYears).toBe(7);
    expect(d.outcome.breakdown.paybackDivisorYears).toBe(5);
    expect(d.outcome.breakdown.paybackYears).toBeCloseTo(2800000 / (2500000 / 5), 9);
    expect(d.outcome.breakdown.explanation.join(' ')).toMatch(/MIN\(อายุ 7, ข้อมูล 5 ปี\)/);
  });

  it('รายละเอียด: ข้อมูลรายปี + Score รายปี + อันดับ', async () => {
    const d = (await S.aEntry!.get(`/api/equipment/${eq['DEMO-001']}/score?year=${Y}`)).json();
    expect(d.annual.map((a: { fiscalYear: number }) => a.fiscalYear)).toEqual([2566, 2567, 2568, 2569]);
    expect(d.annual[0].metrics.utilizationPctHours).toBeCloseTo(78, 9);
    expect(d.annual[0].annualScore).toBeGreaterThan(0);
    expect(d.rank).toBe(1);
    expect(d.rankOf).toBe(2);
    expect(d.outcome.breakdown.explanation.length).toBeGreaterThan(8);
  });

  it('อันดับคิดแยกแต่ละโรงพยาบาล และ รพ. อื่นมองไม่เห็น', async () => {
    for (const fy of [2568, 2569]) await approved('DEMO-B01', fy);
    const all = await scores('ca');
    expect(row(all, 'DEMO-B01').rank).toBe(1);
    expect(row(all, 'DEMO-001').rank).toBe(1);
    const b = await scores('bEntry');
    expect(b.rows.map((x: { equipment: { code: string } }) => x.equipment.code).sort()).toEqual(['DEMO-B01', 'DEMO-B02']);
    expect((await S.bEntry!.get(`/api/equipment/${eq['DEMO-001']}/score?year=${Y}`)).statusCode).toBe(404);
  });

  it('สรุปภาพรวม', async () => {
    const r = await scores();
    expect(r.summary.total).toBe(8);
    expect(r.summary.scored).toBe(2);
    expect(r.summary.notScored).toBe(6);
    expect(r.summary.average).toBeCloseTo((row(r, 'DEMO-001').utilityScore + row(r, 'DEMO-008').utilityScore) / 2, 9);
  });

});
