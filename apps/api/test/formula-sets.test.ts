import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const C: Record<string, string> = {};
const Y = 2568; // ข้อมูล DEMO รายปีที่ยืนยันแล้วมีถึงปีงบ 2568
const as = (who: string) => env.as(C[who]!);
const body = (o: Record<string, unknown> = {}) => ({
  weights: { utilization: 0.4, clinical: 0.15, financial: 0.15, reliability: 0.1, satisfaction: 0.1, strategic: 0.1 },
  paybackPenalty: 10, currentYearBe: null, note: 'ทดสอบ (DEMO)', ...o,
});

beforeAll(async () => {
  env = await setupTestEnv({}, { annual: true });
  for (const [k, pid] of Object.entries({ ca: 'PID-DEMO-CA', aEntry: 'PID-DEMO-A-ENTRY' })) C[k] = (await env.login(pid)).cookie;
});
afterAll(async () => env?.teardown());

describe('สมมติฐานและน้ำหนักคะแนน (ชุดสูตรเดียวทั้งระบบ)', () => {
  it('ทุกคนดูค่าที่ใช้อยู่ได้ ตรงกับชีตสมมติฐานของไฟล์ต้นแบบ', async () => {
    const d = (await as('aEntry').get('/api/formula-sets')).json();
    expect(d.current).toMatchObject({
      version: '1.1', paybackPenalty: 15, currentYearBe: null,
      weights: { utilization: 0.25, clinical: 0.2, financial: 0.2, reliability: 0.15, satisfaction: 0.1, strategic: 0.1 },
    });
    expect(d.history.map((h: { version: string; status: string }) => `${h.version}:${h.status}`)).toEqual(['1.1:approved', '1.0:retired']);
  });
  it('เฉพาะผู้ดูแลระบบส่วนกลางปรับได้ และผลรวมน้ำหนักต้องเท่ากับ 100%', async () => {
    expect((await as('aEntry').post('/api/formula-sets', body())).statusCode).toBe(403);
    const bad = await as('ca').post('/api/formula-sets', body({ weights: { ...body().weights, utilization: 0.5 } }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/ผลรวมน้ำหนักต้องเท่ากับ 1\.00 \(100%\)/);
    expect((await as('ca').post('/api/formula-sets', body({ paybackPenalty: -1 }))).statusCode).toBe(400);
    expect((await as('ca').post('/api/formula-sets', body({ currentYearBe: 3000 }))).statusCode).toBe(400);
  });
  it('บันทึกแล้วสร้างเวอร์ชันใหม่ เปิดใช้ทันที และเวอร์ชันเดิมเลิกใช้ (ไม่ถูกแก้)', async () => {
    const before = (await as('aEntry').get(`/api/scores?year=${Y}`)).json();
    const r = await as('ca').post('/api/formula-sets', body());
    expect(r.statusCode).toBe(201);
    expect(r.json().version).toBe('1.2');
    const d = (await as('aEntry').get('/api/formula-sets')).json();
    expect(d.current).toMatchObject({ version: '1.2', paybackPenalty: 10 });
    expect(d.history.map((h: { version: string; status: string }) => `${h.version}:${h.status}`)).toEqual(['1.2:approved', '1.1:retired', '1.0:retired']);
    expect(d.history.find((h: { version: string }) => h.version === '1.1').definition.weights.utilization).toBe(0.25);
    expect(d.history[0]).toMatchObject({ has_approver: true });
    // ชื่อผู้ปรับเห็นได้เฉพาะส่วนกลาง (RLS ของผู้ใช้) — เจ้าหน้าที่ รพ. เห็นเป็นบทบาท
    expect((await as('ca').get('/api/formula-sets')).json().history[0].approved_by_name).toBe('ผู้ดูแลส่วนกลางตัวอย่าง');
    expect(d.history[0].definition).toMatchObject({ change: 'ทดสอบ (DEMO)', basedOn: '1.1', paybackDivisor: 'min_age_data_years' });

    // คะแนนจากข้อมูลรายปี (หน้าผลวิเคราะห์ / Dashboard / รายงาน) ใช้ชุดสูตรใหม่ทันที
    const after = (await as('aEntry').get(`/api/scores?year=${Y}`)).json();
    expect(after.formula.version).toBe('1.2');
    const one = (x: { rows: { equipment: { code: string }; utilityScore: number; scores: Record<string, number> }[] }) => x.rows.find((r) => r.equipment.code === 'DEMO-001')!;
    const s = one(after).scores;
    expect(one(after).utilityScore).toBeCloseTo(s.utilization! * 0.4 + s.clinical! * 0.15 + s.financial! * 0.15 + s.reliability! * 0.1 + s.satisfaction! * 0.1 + s.strategic! * 0.1, 9);
    expect(one(after).utilityScore).not.toBeCloseTo(one(before).utilityScore, 3);
    expect((await as('aEntry').get(`/api/dashboard/hospital?year=${Y}`)).json().formula.version).toBe('1.2');
    expect((await as('aEntry').get(`/api/reports/executive/preview?year=${Y}`)).body).toContain('1.2');
  });
  it('แต่ละเวอร์ชันบันทึกใน Audit Log และ hash chain ถูกต้อง', async () => {
    const r = await as('ca').post('/api/formula-sets', body({ paybackPenalty: 12 }));
    expect(r.json().version).toBe('1.3');
    const v = (await as('ca').get('/api/audit/verify')).json();
    expect(v.broken).toEqual([]);
  });
});
