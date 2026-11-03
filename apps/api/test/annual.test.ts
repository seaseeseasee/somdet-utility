import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fiscalYearOf } from '../src/annual.js';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const S: Record<string, ReturnType<typeof env.as>> = {};
const eqId: Record<string, string> = {};
const FY = fiscalYearOf(new Date()) - 1; // ปีงบที่เพิ่งสิ้นสุด

/** ข้อมูลรายปีครบทุกช่อง (DEMO) — ตรงกับตัวอย่างในแบบฟอร์ม Mockup */
const full = (o: Record<string, unknown> = {}) => ({
  availableDays: 245, actualDays: 200, maxAvailableHours: 2450, actualHours: 980, useCount: 1120, caseCount: 1050,
  repairCost: 42000, partsCost: 18500, pmCost: 30000, calibrationCost: 12000, otherCost: 2500, revenue: 388000,
  noDirectRevenue: false, repairDays: 21, breakdownCount: 3, downtimeHours: 245,
  clinicalRating: 3, satisfactionRating: 3, strategicRating: 3, ratingRationale: 'ประเมินจากแบบสอบถามผู้ใช้ (DEMO)',
  clinicalNecessity: 'high', condition: 'good', inspectedAt: `${FY - 543}-10-05`, inspectionNote: 'ตรวจสภาพแล้ว (DEMO)',
  safetyEvent: false, recallStatus: 'none', unitRecommendation: 'increase_use', rationale: 'ผู้รับบริการลดลง (DEMO)', ...o,
});

beforeAll(async () => {
  env = await setupTestEnv();
  for (const [k, pid] of Object.entries({ ca: 'PID-DEMO-CA', aEntry: 'PID-DEMO-A-ENTRY', bEntry: 'PID-DEMO-B-ENTRY' }))
    S[k] = env.as((await env.login(pid)).cookie);
  for (const r of (await S.aEntry!.get('/api/equipment?pageSize=200')).json().rows) eqId[r.code] = r.id;
});
afterAll(async () => env?.teardown());

const put = (s: string, code: string, fy: number, body: unknown) => S[s]!.put(`/api/equipment/${eqId[code]}/annual/${fy}`, body);

describe('ไม่มีรอบประเมินและผู้ตรวจสอบแยก', () => {
  it('API รอบประเมินและคิวรอตรวจสอบถูกนำออก', async () => {
    expect((await S.aEntry!.get('/api/cycles')).statusCode).toBe(404);
    expect((await S.aEntry!.get('/api/review-queue')).statusCode).toBe(404);
  });
  it('เจ้าหน้าที่กรอกข้อมูลปีไหนก็ได้โดยไม่ต้องเปิดรอบ', async () => {
    expect((await put('aEntry', 'DEMO-006', FY, { availableDays: 200 })).statusCode).toBe(200);
    expect((await put('aEntry', 'DEMO-006', FY - 1, { availableDays: 210 })).statusCode).toBe(200);
  });
  it('ส่วนกลางกรอกข้อมูลรายปีไม่ได้', async () => {
    expect((await put('ca', 'DEMO-007', FY, full())).statusCode).toBe(403);
  });
});

describe('บันทึกและยืนยันข้อมูลรายปี', () => {
  let recId: string;
  it('ร่างกรอกไม่ครบได้ ระบบบอกความครบถ้วนและข้อผิดพลาด', async () => {
    const r = await put('aEntry', 'DEMO-002', FY, { availableDays: 245, actualDays: 260, maxAvailableHours: 2450, actualHours: 980 });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    recId = d.record.id;
    expect(d.record.status).toBe('draft');
    expect(d.evaluation.completeness).toBeLessThan(30);
    expect(d.evaluation.errors.map((e: { field: string }) => e.field)).toContain('actualDays');
    expect(d.period).toEqual({ from: `${FY - 544}-10-01`, to: `${FY - 543}-09-30` });
  });
  it('ค่าที่เป็นไปไม่ได้ถูกปฏิเสธแม้เป็นร่าง', async () => {
    const r = await put('aEntry', 'DEMO-002', FY, { clinicalRating: 6, availableDays: 400 });
    expect(r.statusCode).toBe(400);
    expect(r.json().issues.map((i: { field: string }) => i.field)).toEqual(expect.arrayContaining(['clinicalRating', 'availableDays']));
  });
  it('ยืนยันขณะข้อมูลไม่ครบไม่ได้ (422 พร้อมรายการ)', async () => {
    const r = await S.aEntry!.post(`/api/annual/${recId}/submit`, {});
    expect(r.statusCode).toBe(422);
    expect(r.json().details.length).toBeGreaterThan(5);
  });
  it('บันทึกครบแล้วได้ค่าคำนวณอัตโนมัติตรงกับแบบฟอร์ม', async () => {
    const d = (await put('aEntry', 'DEMO-002', FY, full())).json();
    expect(d.evaluation.errors).toEqual([]);
    expect(d.evaluation.completeness).toBe(100);
    expect(d.evaluation.metrics.maintenanceCost).toBe(105000);
    expect(d.evaluation.metrics.utilizationPctHours).toBeCloseTo(40, 9);
    expect(d.evaluation.metrics.downtimePct).toBeCloseTo(10, 9);
    expect(d.record.version).toBe(2);
  });
  it('ป้องกันบันทึกทับเมื่อ version ไม่ตรง', async () => {
    expect((await put('aEntry', 'DEMO-002', FY, { ...full(), version: 1 })).statusCode).toBe(409);
  });
  it('ประวัติซ่อมบำรุง: วันที่ต้องอยู่ในปีงบ', async () => {
    expect((await S.aEntry!.post(`/api/annual/${recId}/maintenance`, { eventDate: `${FY - 543}-12-01`, kind: 'repair', detail: 'นอกปีงบ', cost: 1 })).statusCode).toBe(400);
    const ok = await S.aEntry!.post(`/api/annual/${recId}/maintenance`, { eventDate: `${FY - 544}-12-12`, kind: 'repair', detail: 'เปลี่ยน Probe (DEMO)', cost: 28000, workOrderNo: 'WO-DEMO-0141' });
    expect(ok.statusCode).toBe(201);
  });
  it('เจ้าหน้าที่ยืนยันข้อมูลของตนเองได้ทันที และบันทึก Provider ID ผู้ยืนยัน', async () => {
    const r = await S.aEntry!.post(`/api/annual/${recId}/submit`, {});
    expect(r.statusCode).toBe(200);
    const me = (await S.aEntry!.get('/api/auth/me')).json();
    expect(r.json().record.status).toBe('approved');
    expect(r.json().record.approvedAt).toBeTruthy();
    expect(r.json().reviews.map((x: { action: string }) => x.action)).toEqual(['approve']);
    expect(r.json().reviews[0].reason).toContain('PID-DEMO-A-ENTRY');
    expect(r.json().reviews[0].actor_name).toBe(me.name);
    expect((await S.aEntry!.post(`/api/annual/${recId}/submit`, {})).statusCode).toBe(409);
  });
  it('ยืนยันแล้วแก้ไขไม่ได้จนกว่าจะปลดล็อก', async () => {
    expect((await put('aEntry', 'DEMO-002', FY, full())).statusCode).toBe(409);
    expect((await S.aEntry!.post(`/api/annual/${recId}/maintenance`, { eventDate: `${FY - 544}-12-13`, kind: 'pm', detail: 'x', cost: 1 })).statusCode).toBe(409);
  });
  it('ปลดล็อกต้องมีเหตุผล ส่วนกลางและ รพ. อื่นปลดล็อกไม่ได้', async () => {
    expect((await S.aEntry!.post(`/api/annual/${recId}/unlock`, { reason: 'สั้น' })).statusCode).toBe(400);
    expect((await S.ca!.post(`/api/annual/${recId}/unlock`, { reason: 'ขอแก้ไขตัวเลข (DEMO)' })).statusCode).toBe(403);
    expect((await S.bEntry!.post(`/api/annual/${recId}/unlock`, { reason: 'ขอแก้ไขตัวเลข (DEMO)' })).statusCode).toBe(404);
    const r = await S.aEntry!.post(`/api/annual/${recId}/unlock`, { reason: 'พบตัวเลขรายได้ผิด (DEMO)' });
    expect(r.statusCode).toBe(200);
    expect(r.json().record.status).toBe('draft');
    expect(r.json().record.approvedAt).toBeNull();
  });
  it('แก้แล้วยืนยันใหม่ได้ ประวัติครบทุกขั้น', async () => {
    const cur = (await S.aEntry!.get(`/api/equipment/${eqId['DEMO-002']}/annual/${FY}`)).json();
    expect((await put('aEntry', 'DEMO-002', FY, full({ actualHours: 1000, version: cur.record.version }))).statusCode).toBe(200);
    const r = await S.aEntry!.post(`/api/annual/${recId}/submit`, {});
    expect(r.json().record.status).toBe('approved');
    expect(r.json().reviews.map((x: { action: string }) => x.action)).toEqual(['approve', 'unlock', 'approve']);
  });
  it('ข้อสังเกต: Utilization เปลี่ยนมากจากปีก่อนต้องระบุเหตุผลก่อนยืนยัน', async () => {
    // ปีก่อน (ยืนยันแล้ว) ใช้ 980 ชม. → ปีนี้ 2,200 ชม.
    const prev = (await put('aEntry', 'DEMO-005', FY - 1, full())).json();
    expect((await S.aEntry!.post(`/api/annual/${prev.record.id}/submit`, {})).statusCode).toBe(200);
    const d = (await put('aEntry', 'DEMO-005', FY, full({ actualHours: 2200 }))).json();
    expect(d.evaluation.warnings.length).toBeGreaterThan(0);
    expect(d.evaluation.needsChangeReason).toBe(true);
    const r = await S.aEntry!.post(`/api/annual/${d.record.id}/submit`, {});
    expect(r.statusCode).toBe(422);
    expect(r.json().details[0].field).toBe('changeReason');
    await put('aEntry', 'DEMO-005', FY, full({ actualHours: 2200, changeReason: 'เปิดบริการนอกเวลาเพิ่ม (DEMO)', version: d.record.version }));
    expect((await S.aEntry!.post(`/api/annual/${d.record.id}/submit`, {})).statusCode).toBe(200);
  });
  it('ปีงบก่อนปีที่ซื้อ หรือปีในอนาคต บันทึกไม่ได้', async () => {
    expect((await put('aEntry', 'DEMO-003', 2566, full())).statusCode).toBe(400); // ซื้อ 2567
    expect((await put('aEntry', 'DEMO-003', FY + 2, full())).statusCode).toBe(400);
  });
  it('รพ. B บันทึกหรือยืนยันข้อมูลครุภัณฑ์ของ รพ. A ไม่ได้', async () => {
    expect((await put('bEntry', 'DEMO-002', FY, full())).statusCode).toBe(404);
    expect((await S.bEntry!.post(`/api/annual/${recId}/submit`, {})).statusCode).toBe(404);
  });
  it('รายการปีของครุภัณฑ์แสดงแยกแต่ละปี ไม่เขียนทับปีเก่า', async () => {
    const y = (await S.ca!.get(`/api/equipment/${eqId['DEMO-005']}/annual`)).json().years;
    const byYear = Object.fromEntries(y.map((x: { fiscalYear: number; status: string }) => [x.fiscalYear, x.status]));
    expect(byYear[FY - 1]).toBe('approved');
    expect(byYear[FY]).toBe('approved');
  });
  it('audit chain ยังถูกต้องหลังขั้นตอนทั้งหมด', async () => {
    const v = (await S.aEntry!.get('/api/audit/verify')).json();
    expect(v.broken).toEqual([]);
    expect(v.checked).toBeGreaterThan(10);
  });
});
