import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const S: Record<string, ReturnType<typeof env.as>> = {};
const Y = 2568; // ข้อมูล DEMO รายปีมีถึงปีงบ 2568

async function sql(q: string, args: unknown[] = []) {
  const c = new pg.Client({ connectionString: env.adminUrl });
  await c.connect();
  const r = await c.query(q, args);
  await c.end();
  return r.rows;
}

beforeAll(async () => {
  env = await setupTestEnv({}, { annual: true });
  for (const [k, pid] of Object.entries({ ca: 'PID-DEMO-CA', aEntry: 'PID-DEMO-A-ENTRY', bEntry: 'PID-DEMO-B-ENTRY' }))
    S[k] = env.as((await env.login(pid)).cookie);
});
afterAll(async () => env?.teardown());

const dash = async (s: string, q = '') => (await S[s]!.get(`/api/dashboard/hospital?year=${Y}${q}`)).json();

describe('Dashboard โรงพยาบาล', () => {
  it('KPI ตรงกับข้อมูลในฐานข้อมูล', async () => {
    const d = await dash('aEntry');
    expect(d.window).toEqual({ from: 2564, to: 2568 });
    expect(d.kpis.equipment).toBe(8);
    expect(d.kpis.scored).toBe(8);
    expect(d.kpis.totalValue).toBe(76000000);
    const [m] = await sql(
      `SELECT sum(repair_cost + parts_cost + pm_cost + calibration_cost + other_cost)::float AS total FROM annual_record
        WHERE hospital_id = $1 AND status IN ('approved','locked') AND fiscal_year_be BETWEEN 2564 AND 2568`,
      [env.seed.hid.DEMOA],
    );
    expect(d.kpis.maintenanceTotal).toBeCloseTo(m.total, 6);
    const avg = d.equipment.reduce((s: number, e: { utilityScore: number }) => s + e.utilityScore, 0) / 8;
    expect(d.kpis.averageScore).toBeCloseTo(avg, 9);
    expect(d.kpis.high + d.kpis.replace).toBeLessThanOrEqual(8);
  });
  it('แนวโน้มรายปี: Utilization ถ่วงน้ำหนักด้วยชั่วโมง และปีที่ไม่มีข้อมูลเป็น null', async () => {
    const d = await dash('aEntry');
    expect(d.totals.map((t: { fiscalYear: number }) => t.fiscalYear)).toEqual([2564, 2565, 2566, 2567, 2568]);
    expect(d.totals[0].utilizationPct).toBeNull();
    const [u] = await sql(
      `SELECT (sum(actual_hours) / sum(max_available_hours) * 100)::float AS u, sum(revenue)::float AS rev FROM annual_record
        WHERE hospital_id = $1 AND status IN ('approved','locked') AND fiscal_year_be = 2568`,
      [env.seed.hid.DEMOA],
    );
    expect(d.totals[4].utilizationPct).toBeCloseTo(u.u, 9);
    expect(d.totals[4].revenue).toBeCloseTo(u.rev, 6);
    const ct = d.equipment.find((e: { code: string }) => e.code === 'DEMO-001');
    expect(ct.series.map((s: { utilizationPct: number | null }) => s.utilizationPct === null)).toEqual([true, true, false, false, false]);
  });
  it('ตัวกรอง 6 แบบ', async () => {
    const codes = async (q: string) => (await dash('aEntry', q)).equipment.map((e: { code: string }) => e.code).sort();
    expect(await codes('&level=low')).toEqual(['DEMO-008']);
    expect(await codes(`&typeId=${env.seed.types['รังสีวินิจฉัย']}`)).toEqual(['DEMO-001', 'DEMO-002', 'DEMO-004', 'DEMO-005']);
    expect(await codes('&q=ct')).toEqual(['DEMO-001']);
    expect(await codes('&minPrice=10000000')).toEqual(['DEMO-001', 'DEMO-004']);
    expect(await codes('&maxPrice=2000000')).toEqual(['DEMO-003', 'DEMO-007']);
    expect(await codes(`&departmentId=${env.seed.dep['DEMOA/หอผู้ป่วยวิกฤต']}`)).toEqual(['DEMO-003']);
    expect(await codes('&level=none')).toEqual([]);
  });
  it('รพ. B เห็นเฉพาะของตน', async () => {
    const d = await dash('bEntry');
    expect(d.kpis.equipment).toBe(2);
    expect(d.kpis.scored).toBe(0);
    expect(d.equipment.every((e: { hospitalName: string }) => e.hospitalName.includes('B'))).toBe(true);
  });
});

describe('Dashboard ภาพรวมเครือข่าย', () => {
  it('เฉพาะผู้ใช้ส่วนกลาง', async () => {
    expect((await S.aEntry!.get(`/api/dashboard/network?year=${Y}`)).statusCode).toBe(403);
  });
  it('แต่ละโรงพยาบาลมีข้อมูลแบบไหน', async () => {
    const n = (await S.ca!.get(`/api/dashboard/network?year=${Y}`)).json();
    expect(n.kpis.hospitals).toBe(2);
    expect(n.kpis.equipment).toBe(10);
    expect(n.kpis.hospitalsReporting).toBe(1);
    expect(n.kpis.confirmedThisYear).toBe(8);
    expect(n.kpis.confirmedPct).toBe(80);
    const a = n.hospitals.find((h: { hospital: { hcode: string } }) => h.hospital.hcode === 'DEMOA');
    const b = n.hospitals.find((h: { hospital: { hcode: string } }) => h.hospital.hcode === 'DEMOB');
    expect(a.scoredCount).toBe(8);
    expect(Object.values(a.distribution).reduce((x: number, y) => x + (y as number), 0)).toBe(8);
    expect(a.types[env.seed.types['รังสีวินิจฉัย']]).toBe(4);
    expect(a.completeness['ชั่วโมงใช้งาน']).toBe(100);
    expect(a.completeness['มีรายได้ตรง']).toBe(88); // DEMO-003 ไม่มีรายได้ตรง → 7/8
    expect(a.coverage.find((c: { fiscalYear: number }) => c.fiscalYear === 2568).pct).toBe(100);
    expect(a.coverage.find((c: { fiscalYear: number }) => c.fiscalYear === 2564).pct).toBe(0); // มีเครื่องซื้อ 2564 (DEMO-004) แต่ไม่มีข้อมูล
    expect(b.scoredCount).toBe(0);
    expect(b.notScored).toBe(2);
    expect(b.followUps.some((f: { text: string }) => /ยังไม่มีข้อมูลยืนยันปีงบ/.test(f.text))).toBe(true);
    // ไม่มีข้อมูลเลย → รวมเป็นรายการเดียว ไม่แยกทุกหมวด
    expect(b.followUps.filter((f: { text: string }) => /กรอกเพียง|รายได้ตรงเพียง/.test(f.text))).toEqual([]);
    expect(b.followUps.some((f: { text: string }) => /ยังไม่มีการบันทึกข้อมูลปีงบ 2568 เลย \(2 รายการ/.test(f.text))).toBe(true);
  });
  it('ความคืบหน้าข้อมูลปีนี้แสดงในภาพรวม (ไม่มีรอบประเมิน)', async () => {
    const n = (await S.ca!.get(`/api/dashboard/network?year=${Y}`)).json();
    const a = n.hospitals.find((h: { hospital: { hcode: string } }) => h.hospital.hcode === 'DEMOA');
    expect(a.progress.total).toBe(7); // DEMO-008 งดใช้ ไม่ต้องกรอก
    expect(a.progress.approved).toBe(7);
    expect(a.followUps.map((f: { text: string }) => f.text).join(' ')).not.toMatch(/ยืนยันแล้ว d+ จาก/);
    const b = n.hospitals.find((h: { hospital: { hcode: string } }) => h.hospital.hcode === 'DEMOB');
    expect(b.progress).toEqual({ approved: 0, inProgress: 0, notStarted: 2, total: 2 });
  });
});
