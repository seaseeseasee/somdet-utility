import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fiscalYearOf } from '../src/annual.js';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const S: Record<string, ReturnType<typeof env.as>> = {};
const eqId: Record<string, string> = {};
const FY = fiscalYearOf(new Date()) - 1; // ปีงบที่เพิ่งสิ้นสุด (รอบประเมินปกติ)

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
  for (const [k, pid] of Object.entries({
    ce: 'PID-DEMO-CE', aAdmin: 'PID-DEMO-A-ADMIN', aEntry: 'PID-DEMO-A-ENTRY', aReview: 'PID-DEMO-A-REVIEW',
    aExec: 'PID-DEMO-A-EXEC', bAdmin: 'PID-DEMO-B-ADMIN', bEntry: 'PID-DEMO-B-ENTRY',
  }))
    S[k] = env.as((await env.login(pid)).cookie);
  for (const r of (await S.aEntry!.get('/api/equipment?pageSize=200')).json().rows) eqId[r.code] = r.id;
});
afterAll(async () => env?.teardown());

const put = (s: string, code: string, fy: number, body: unknown) => S[s]!.put(`/api/equipment/${eqId[code]}/annual/${fy}`, body);

describe('รอบการประเมินและรายการครบกำหนด', () => {
  let cycleId: string;
  it('เฉพาะผู้ดูแล รพ. เปิดรอบได้ และสร้างรายการครบกำหนดอัตโนมัติ', async () => {
    expect((await S.aEntry!.post('/api/cycles', { fiscalYearBe: FY })).statusCode).toBe(403);
    expect((await S.aAdmin!.post('/api/cycles', { fiscalYearBe: FY + 5 })).statusCode).toBe(400);
    const r = await S.aAdmin!.post('/api/cycles', { fiscalYearBe: FY });
    expect(r.statusCode).toBe(201);
    cycleId = r.json().id;
    // 8 เครื่องใน รพ. A ไม่นับ DEMO-008 (งดใช้) → 7
    expect(r.json().tasksCreated).toBe(7);
    expect(r.json().opens_at).toBe(`${FY - 543}-10-01`);
    expect(r.json().closes_at).toBe(`${FY - 543}-10-31`);
    expect((await S.aAdmin!.post('/api/cycles', { fiscalYearBe: FY })).statusCode).toBe(409);
  });
  it('เหตุที่ครบกำหนด: ครบอายุใช้งานตามเกณฑ์', async () => {
    const e = (await S.aAdmin!.get(`/api/equipment/${eqId['DEMO-007']}`)).json();
    await S.aAdmin!.put(`/api/equipment/${e.id}`, {
      code: e.code, name: e.name, typeId: e.type_id, departmentId: e.department_id, brand: e.brand, model: e.model, serialNo: e.serial_no,
      purchaseYearBe: e.purchase_year_be, purchasePrice: e.purchase_price, receivedDate: e.received_date, startDate: e.start_date,
      status: e.status, maintenancePlan: e.maintenance_plan, usefulLifeYears: 3, version: e.version,
    });
    // เพิ่มเครื่องที่รับเข้าปีนี้ แล้วสร้างรายการเพิ่ม
    await S.aEntry!.post('/api/equipment', {
      code: 'DEMO-NEW', name: 'เครื่องรับเข้าใหม่ (DEMO)', typeId: env.seed.types['ช่วยชีวิต'], departmentId: env.seed.dep['DEMOA/หอผู้ป่วยวิกฤต'],
      brand: 'Demo', model: 'N', serialNo: 'SN-NEW', purchaseYearBe: FY, purchasePrice: 1100000, receivedDate: `${FY - 544}-12-01`,
      startDate: `${FY - 544}-12-01`, status: 'in_use',
    });
    expect((await S.aAdmin!.post(`/api/cycles/${cycleId}/regenerate`, {})).json().tasksCreated).toBe(1);
    const t = (await S.aAdmin!.get(`/api/cycles/${cycleId}/tasks`)).json();
    expect(t.summary.total).toBe(8);
    expect(t.tasks.find((x: { equipment: { code: string } }) => x.equipment.code === 'DEMO-NEW').reasons.map((r: { code: string }) => r.code)).toEqual(['annual', 'new']);
    // ปีงบ − ปีซื้อ (2563) ≥ อายุตามเกณฑ์ 3 ปี
    expect(t.tasks.find((x: { equipment: { code: string } }) => x.equipment.code === 'DEMO-007').reasons.map((r: { code: string }) => r.code)).toContain('end_of_life');
    expect(t.tasks.every((x: { status: string }) => x.status === 'not_started')).toBe(true);
  });
  it('รพ. อื่นเห็นรอบนี้ไม่ได้ ส่วนกลางเห็นได้แต่แก้ไม่ได้', async () => {
    expect((await S.bAdmin!.get(`/api/cycles/${cycleId}/tasks`)).statusCode).toBe(404);
    expect((await S.bAdmin!.get('/api/cycles')).json().cycles.length).toBe(0);
    expect((await S.ce!.get(`/api/cycles/${cycleId}/tasks`)).statusCode).toBe(200);
    expect((await S.ce!.post(`/api/cycles/${cycleId}/close`, {})).statusCode).toBe(403);
  });
  it('มอบหมายได้เฉพาะเจ้าหน้าที่บันทึกข้อมูลของ รพ. เดียวกัน', async () => {
    const t = (await S.aAdmin!.get(`/api/cycles/${cycleId}/tasks`)).json().tasks[0];
    const people = (await S.aAdmin!.get('/api/assignees')).json();
    const entry = people.find((p: { name: string }) => p.name === 'เจ้าหน้าที่ตัวอย่าง A');
    expect(entry).toBeTruthy();
    expect((await S.aAdmin!.put(`/api/tasks/${t.id}`, { assigneeId: entry.id })).statusCode).toBe(200);
    const reviewer = (await S.aAdmin!.get('/api/users')).json().find((u: { provider_id: string }) => u.provider_id === 'PID-DEMO-A-REVIEW');
    expect((await S.aAdmin!.put(`/api/tasks/${t.id}`, { assigneeId: reviewer.id })).statusCode).toBe(400);
    const mine = (await S.aEntry!.get(`/api/cycles/${cycleId}/tasks?mine=1`)).json();
    expect(mine.tasks.length).toBe(1);
  });
});

describe('บันทึกข้อมูลรายปี', () => {
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
  it('ส่งตรวจขณะข้อมูลไม่ครบไม่ได้ (422 พร้อมรายการ)', async () => {
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
  it('ส่งตรวจแล้วแก้ไขไม่ได้ และเจ้าหน้าที่ยืนยันเองไม่ได้', async () => {
    const r = await S.aEntry!.post(`/api/annual/${recId}/submit`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().record.status).toBe('submitted');
    expect((await put('aEntry', 'DEMO-002', FY, full())).statusCode).toBe(409);
    expect((await S.aEntry!.post(`/api/annual/${recId}/maintenance`, { eventDate: `${FY - 544}-12-13`, kind: 'pm', detail: 'x', cost: 1 })).statusCode).toBe(409);
    expect((await S.aEntry!.post(`/api/annual/${recId}/approve`, {})).statusCode).toBe(403);
  });
  it('คิวรอตรวจสอบแสดงรายการ และ รพ. อื่นไม่เห็น', async () => {
    const q = (await S.aReview!.get('/api/review-queue')).json();
    expect(q.map((x: { code: string }) => x.code)).toEqual(['DEMO-002']);
    expect(q[0].canApprove).toBe(true);
    expect((await S.bAdmin!.get('/api/review-queue')).json()).toEqual([]);
  });
  it('ตีกลับต้องมีเหตุผล แล้วสถานะในรายการครบกำหนดเป็น "ถูกตีกลับ"', async () => {
    expect((await S.aReview!.post(`/api/annual/${recId}/reject`, { reason: '' })).statusCode).toBe(400);
    const r = await S.aReview!.post(`/api/annual/${recId}/reject`, { reason: 'ชั่วโมงใช้งานไม่ตรงกับสถิติ RIS (DEMO)' });
    expect(r.json().record.status).toBe('draft');
    const cycles = (await S.aEntry!.get('/api/cycles')).json().cycles;
    const t = (await S.aEntry!.get(`/api/cycles/${cycles[0].id}/tasks`)).json().tasks.find((x: { equipment: { code: string } }) => x.equipment.code === 'DEMO-002');
    expect(t.status).toBe('rejected');
    expect(t.rejection.reason).toMatch(/RIS/);
    expect(t.rejection.by).toBe('ผู้ตรวจตัวอย่าง A');
  });
  it('แก้แล้วส่งใหม่ ผู้ตรวจสอบยืนยันได้', async () => {
    await put('aEntry', 'DEMO-002', FY, full({ actualHours: 1000 }));
    expect((await S.aEntry!.post(`/api/annual/${recId}/submit`, {})).statusCode).toBe(200);
    const r = await S.aReview!.post(`/api/annual/${recId}/approve`, { note: 'ตรวจกับ RIS แล้ว (DEMO)' });
    expect(r.statusCode).toBe(200);
    expect(r.json().record.status).toBe('approved');
    expect(r.json().reviews.map((x: { action: string }) => x.action)).toEqual(['approve', 'submit', 'reject', 'submit']);
  });
  it('Segregation of Duties: ผู้ดูแลที่บันทึกเองยืนยันข้อมูลตนเองไม่ได้', async () => {
    const d = (await put('aAdmin', 'DEMO-001', FY, full())).json();
    await S.aAdmin!.post(`/api/annual/${d.record.id}/submit`, {});
    const r = await S.aAdmin!.post(`/api/annual/${d.record.id}/approve`, {});
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/ผู้บันทึก/);
    expect((await S.aAdmin!.get('/api/review-queue')).json().find((x: { code: string }) => x.code === 'DEMO-001').canApprove).toBe(false);
    expect((await S.aReview!.post(`/api/annual/${d.record.id}/approve`, {})).statusCode).toBe(200);
  });
  it('ข้อสังเกต: Utilization เปลี่ยนมากจากปีก่อนต้องระบุเหตุผลก่อนส่ง', async () => {
    // ปีก่อน (ยืนยันแล้ว) ใช้ 980 ชม. → ปีนี้ 2,200 ชม.
    const prev = (await put('aEntry', 'DEMO-005', FY - 1, full())).json();
    await S.aEntry!.post(`/api/annual/${prev.record.id}/submit`, {});
    await S.aReview!.post(`/api/annual/${prev.record.id}/approve`, {});
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
  it('รพ. B บันทึกข้อมูลครุภัณฑ์ของ รพ. A ไม่ได้', async () => {
    expect((await put('bEntry', 'DEMO-002', FY, full())).statusCode).toBe(404);
    expect((await S.bEntry!.post(`/api/annual/${recId}/submit`, {})).statusCode).toBe(404);
  });
  it('รายการปีของครุภัณฑ์แสดงแยกแต่ละปี ไม่เขียนทับปีเก่า', async () => {
    const y = (await S.aExec!.get(`/api/equipment/${eqId['DEMO-005']}/annual`)).json().years;
    const byYear = Object.fromEntries(y.map((x: { fiscalYear: number; status: string }) => [x.fiscalYear, x.status]));
    expect(byYear[FY - 1]).toBe('approved');
    expect(byYear[FY]).toBe('submitted');
  });
});

describe('ปลดล็อกและปิดรอบ', () => {
  it('ปลดล็อกได้เฉพาะผู้ดูแล รพ. พร้อมเหตุผล', async () => {
    const d = (await S.aExec!.get(`/api/equipment/${eqId['DEMO-002']}/annual/${FY}`)).json();
    expect((await S.aEntry!.post(`/api/annual/${d.record.id}/unlock`, { reason: 'ขอแก้ไขตัวเลข' })).statusCode).toBe(403);
    expect((await S.aAdmin!.post(`/api/annual/${d.record.id}/unlock`, { reason: 'สั้น' })).statusCode).toBe(400);
    const r = await S.aAdmin!.post(`/api/annual/${d.record.id}/unlock`, { reason: 'พบตัวเลขรายได้ผิด (DEMO)' });
    expect(r.json().record.status).toBe('draft');
    await S.aEntry!.post(`/api/annual/${d.record.id}/submit`, {});
    await S.aReview!.post(`/api/annual/${d.record.id}/approve`, {});
  });
  it('ปิดรอบ: ล็อกข้อมูลที่ยืนยันแล้ว ข้อมูลปีก่อนไม่ถูกแตะ', async () => {
    const cycles = (await S.aAdmin!.get('/api/cycles')).json().cycles;
    const r = await S.aAdmin!.post(`/api/cycles/${cycles[0].id}/close`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().locked).toBe(2); // DEMO-001, DEMO-002 (DEMO-005 ยังรอตรวจ)
    expect(r.json().notApproved).toBe(6);
    const d = (await S.aExec!.get(`/api/equipment/${eqId['DEMO-002']}/annual/${FY}`)).json();
    expect(d.record.status).toBe('locked');
    expect((await put('aEntry', 'DEMO-002', FY, full())).statusCode).toBe(409);
    const prev = (await S.aExec!.get(`/api/equipment/${eqId['DEMO-005']}/annual/${FY - 1}`)).json();
    expect(prev.record.status).toBe('approved');
    expect((await S.aAdmin!.post(`/api/cycles/${cycles[0].id}/close`, {})).statusCode).toBe(409);
  });
  it('audit chain ยังถูกต้องหลังขั้นตอนทั้งหมด', async () => {
    const v = (await S.aAdmin!.get('/api/audit/verify')).json();
    expect(v.broken).toEqual([]);
    expect(v.checked).toBeGreaterThan(20);
  });
});
