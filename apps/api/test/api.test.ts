import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { withTx } from '../src/db.js';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const S: Record<string, ReturnType<typeof env.as>> = {};

beforeAll(async () => {
  env = await setupTestEnv();
  for (const [k, pid] of Object.entries({
    ca: 'PID-DEMO-CA', aEntry: 'PID-DEMO-A-ENTRY', bEntry: 'PID-DEMO-B-ENTRY',
  }))
    S[k] = env.as((await env.login(pid)).cookie);
});
afterAll(async () => env?.teardown());

const newEquipment = (o: Record<string, unknown> = {}) => ({
  code: 'DEMO-T01', name: 'เครื่องทดสอบ (DEMO)', typeId: env.seed.types['รังสีวินิจฉัย'],
  departmentId: env.seed.dep['DEMOA/กลุ่มงานรังสีวิทยา'], brand: 'DemoBrand', model: 'T-1', serialNo: 'SN-T01',
  purchaseYearBe: 2568, purchasePrice: 1500000, receivedDate: '2025-01-10', startDate: '2025-01-15', status: 'in_use', ...o,
});

describe('การเข้าสู่ระบบ', () => {
  it('ไม่พบผู้ใช้ → 404', async () => {
    const h = { 'x-mu-csrf': '1' };
    expect((await env.app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: h, payload: { providerId: 'PID-NOPE' } })).statusCode).toBe(404);
  });
  it('cookie เป็น HttpOnly + SameSite=Strict และ /me คืนบทบาทกับสิทธิ์', async () => {
    const { raw, cookie } = await env.login('PID-DEMO-A-ENTRY');
    expect(raw.httpOnly).toBe(true);
    expect(raw.sameSite).toBe('Strict');
    const me = (await env.as(cookie).get('/api/auth/me')).json();
    expect(me.hospital.hcode).toBe('DEMOA');
    expect(me.roles[0].role).toBe('data_entry');
    expect(me.permissions).toEqual(expect.arrayContaining(['equipment.write', 'equipment.code.change', 'annual.write', 'annual.unlock']));
    expect(me.permissions).not.toContain('users.manage');
  });
  it('ไม่ได้เข้าสู่ระบบ → 401', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/api/equipment' })).statusCode).toBe(401);
  });
  it('คำขอเปลี่ยนข้อมูลที่ไม่มี header CSRF → 403', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { providerId: 'PID-DEMO-CA' } });
    expect(r.statusCode).toBe(403);
  });
  it('production ห้ามใช้ AUTH_MODE=dev', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'x', AUTH_MODE: 'dev' })).toThrow(/production/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'x', AUTH_MODE: 'oidc' }).devLoginEnabled).toBe(false);
  });
  it('Provider ID ยังไม่เชื่อมต่อ → 501 พร้อมรายการค่าที่ต้องตั้ง', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(r.statusCode).toBe(501);
    expect(r.json().required).toContain('OIDC_CLIENT_ID');
  });
  it('logout แล้ว session ใช้ไม่ได้', async () => {
    const { cookie } = await env.login('PID-DEMO-A-ENTRY');
    await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-mu-csrf': '1' } });
    expect((await env.as(cookie).get('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('การแยกข้อมูลตามโรงพยาบาล', () => {
  it('ผู้ใช้ รพ. เห็นเฉพาะครุภัณฑ์ของตน ส่วนกลางเห็นทั้งหมด', async () => {
    expect((await S.aEntry!.get('/api/equipment')).json().total).toBe(8);
    expect((await S.bEntry!.get('/api/equipment')).json().total).toBe(2);
    expect((await S.ca!.get('/api/equipment')).json().total).toBe(10);
  });
  it('รพ. B เปิดครุภัณฑ์ของ รพ. A ไม่ได้ (404) และกรอง hospitalId ของคนอื่นไม่ได้', async () => {
    const aRow = (await S.aEntry!.get('/api/equipment?q=DEMO-001')).json().rows[0];
    expect((await S.bEntry!.get(`/api/equipment/${aRow.id}`)).statusCode).toBe(404);
    expect((await S.bEntry!.get(`/api/equipment?hospitalId=${env.seed.hid.DEMOA}`)).json().total).toBe(0);
    expect((await S.bEntry!.get(`/api/equipment/${aRow.id}/history`)).statusCode).toBe(404);
  });
  it('RLS ในฐานข้อมูลกันได้แม้ไม่ผ่าน API', async () => {
    const b = { scope: 'hospital' as const, hospitalId: env.seed.hid.DEMOB };
    const n = await withTx(env.pool, b, async (db) => (await db.query('SELECT count(*)::int n FROM equipment WHERE hospital_id = $1', [env.seed.hid.DEMOA])).rows[0].n);
    expect(n).toBe(0);
    await expect(
      withTx(env.pool, b, (db) => db.query("UPDATE department SET name = 'x' WHERE hospital_id = $1", [env.seed.hid.DEMOA]).then((r) => r.rowCount)),
    ).resolves.toBe(0);
    await expect(
      withTx(env.pool, b, (db) => db.query('INSERT INTO department (hospital_id, name) VALUES ($1, $2)', [env.seed.hid.DEMOA, 'แอบเพิ่ม'])),
    ).rejects.toThrow(/row-level security/);
    // ไม่ตั้ง scope = ไม่เห็นอะไรเลย
    const none = await withTx(env.pool, { scope: 'hospital', hospitalId: null }, async (db) => (await db.query('SELECT count(*)::int n FROM equipment')).rows[0].n);
    expect(none).toBe(0);
  });
  it('เลือกหน่วยงานของ รพ. อื่นไม่ได้', async () => {
    const r = await S.aEntry!.post('/api/equipment', newEquipment({ code: 'DEMO-X', serialNo: 'SN-X', departmentId: env.seed.dep['DEMOB/กลุ่มงานจิตเวช'] }));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/หน่วยงาน/);
  });
});

describe('ทะเบียนครุภัณฑ์', () => {
  let created: Record<string, unknown>;
  it('ตรวจความถูกต้องของข้อมูล (ภาษาไทย)', async () => {
    const r = await S.aEntry!.post('/api/equipment', newEquipment({ name: '', purchasePrice: 0, startDate: '2024-12-01', status: 'repair' }));
    expect(r.statusCode).toBe(400);
    const fields = r.json().issues.map((i: { field: string }) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'purchasePrice']));
    const r2 = await S.aEntry!.post('/api/equipment', newEquipment({ startDate: '2024-12-01', status: 'repair' }));
    expect(r2.json().issues.map((i: { field: string }) => i.field)).toEqual(expect.arrayContaining(['startDate', 'statusNote']));
  });
  it('เจ้าหน้าที่เพิ่มได้ และบันทึก audit', async () => {
    const r = await S.aEntry!.post('/api/equipment', newEquipment());
    expect(r.statusCode).toBe(201);
    created = r.json();
    expect(created.hospital_id).toBe(env.seed.hid.DEMOA);
    expect(created.version).toBe(1);
    expect(created.purchase_price).toBe(1500000);
  });
  it('รหัสหรือ Serial ซ้ำ → 409', async () => {
    const r = await S.aEntry!.post('/api/equipment', newEquipment({ serialNo: 'SN-OTHER' }));
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/รหัสครุภัณฑ์/);
    const r2 = await S.aEntry!.post('/api/equipment', newEquipment({ code: 'DEMO-T99' }));
    expect(r2.json().error).toMatch(/Serial/);
  });
  it('รหัสเดียวกันใช้ได้ในอีกโรงพยาบาล', async () => {
    const r = await S.bEntry!.post('/api/equipment', newEquipment({ departmentId: env.seed.dep['DEMOB/กลุ่มงานรังสีวิทยา'] }));
    expect(r.statusCode).toBe(201);
  });
  it('ส่วนกลางเพิ่มครุภัณฑ์ไม่ได้', async () => {
    for (const s of [S.ca!]) expect((await s.post('/api/equipment', newEquipment({ code: 'Z' }))).statusCode).toBe(403);
  });
  it('แก้ไขพร้อมกัน: version เก่า → 409', async () => {
    const id = created.id as string;
    const ok = await S.aEntry!.put(`/api/equipment/${id}`, { ...newEquipment({ name: 'แก้ชื่อ (DEMO)' }), version: 1 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    const stale = await S.aEntry!.put(`/api/equipment/${id}`, { ...newEquipment({ name: 'ชนกัน' }), version: 1 });
    expect(stale.statusCode).toBe(409);
  });
  it('เจ้าหน้าที่เปลี่ยนรหัสครุภัณฑ์ได้ (ไม่มีผู้ดูแล รพ.)', async () => {
    const id = created.id as string;
    expect((await S.aEntry!.put(`/api/equipment/${id}`, { ...newEquipment({ code: 'DEMO-T02' }), version: 2 })).statusCode).toBe(200);
  });
  it('ประวัติการแก้ไขแสดงผู้แก้และค่าก่อน/หลัง', async () => {
    const h = (await S.aEntry!.get(`/api/equipment/${created.id}/history`)).json();
    expect(h.map((x: { action: string }) => x.action)).toEqual(['update', 'update', 'create']);
    expect(h[1].before.name).toBe('เครื่องทดสอบ (DEMO)');
    expect(h[1].after.name).toBe('แก้ชื่อ (DEMO)');
    expect(h[0].actor_name).toBe('เจ้าหน้าที่ตัวอย่าง A');
  });
  it('ค้นหาและกรอง', async () => {
    expect((await S.aEntry!.get('/api/equipment?q=ultra')).json().rows.map((r: { code: string }) => r.code)).toEqual(['DEMO-002']);
    expect((await S.aEntry!.get('/api/equipment?status=repair')).json().total).toBe(1);
    expect((await S.aEntry!.get('/api/equipment?minPrice=10000000')).json().total).toBe(2);
  });
});

describe('Audit Log', () => {
  it('hash chain ถูกต้อง และแอปแก้/ลบ audit ไม่ได้', async () => {
    const v = (await S.aEntry!.get('/api/audit/verify')).json();
    expect(v.checked).toBeGreaterThan(3);
    expect(v.broken).toEqual([]);
    await expect(
      withTx(env.pool, { scope: 'hospital', hospitalId: env.seed.hid.DEMOA }, (db) => db.query("UPDATE audit_log SET action = 'x'")),
    ).rejects.toThrow(/permission denied|เพิ่มได้อย่างเดียว/);
  });
  it('ตรวจพบเมื่อมีการแก้ audit โดยตรงที่ฐานข้อมูล', async () => {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: env.adminUrl });
    await c.connect();
    await c.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update');
    await c.query(`UPDATE audit_log SET after = '{"tampered":true}' WHERE id = (SELECT min(id) FROM audit_log WHERE hospital_id = $1)`, [env.seed.hid.DEMOA]);
    await c.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update');
    await c.end();
    expect((await S.aEntry!.get('/api/audit/verify')).json().broken.length).toBeGreaterThan(0);
  });
});

describe('ผู้ใช้และสิทธิ์', () => {
  const users = async () => (await S.ca!.get('/api/users')).json() as { id: string; provider_id: string; status: string; hospital_id: string | null }[];
  it('เฉพาะผู้ดูแลระบบส่วนกลางจัดการผู้ใช้ได้', async () => {
    expect((await users()).length).toBe(3);
    expect((await S.aEntry!.get('/api/users')).statusCode).toBe(403);
    expect((await S.aEntry!.post('/api/users', { providerId: 'PID-DEMO-NEW1', name: 'x', roles: ['data_entry'] })).statusCode).toBe(403);
  });
  it('ผู้ใช้ของโรงพยาบาลมีได้เฉพาะบทบาทเจ้าหน้าที่ และบทบาทส่วนกลางต้องไม่ผูกโรงพยาบาล', async () => {
    for (const role of ['hospital_admin', 'reviewer', 'executive'])
      expect((await S.ca!.post('/api/users', { providerId: `PID-DEMO-R-${role}`, name: 'x', hospitalId: env.seed.hid.DEMOA, roles: [role] })).statusCode).toBe(400);
    expect((await S.ca!.post('/api/users', { providerId: 'PID-DEMO-R-CA', name: 'x', hospitalId: env.seed.hid.DEMOA, roles: ['central_admin'] })).statusCode).toBe(400);
    expect((await S.ca!.post('/api/users', { providerId: 'PID-DEMO-R-DE', name: 'x', roles: ['data_entry'] })).statusCode).toBe(400);
  });
  it('ส่วนกลางมีบทบาทเดียว: ผู้ดูแลระบบส่วนกลางมีสิทธิ์ของผู้บริหารส่วนกลางเดิมครบ', async () => {
    expect((await S.ca!.post('/api/users', { providerId: 'PID-DEMO-R-CE', name: 'x', roles: ['central_executive'] })).statusCode).toBe(400);
    const me = (await S.ca!.get('/api/auth/me')).json();
    expect(me.permissions).toEqual(expect.arrayContaining(['dashboard.view', 'report.export', 'equipment.read', 'audit.view', 'users.manage', 'hospital.manage']));
    expect((await S.ca!.get('/api/dashboard/network?year=2568')).statusCode).toBe(200);
  });
  it('แต่ละโรงพยาบาลมีเจ้าหน้าที่ได้ 1 คน', async () => {
    const r = await S.ca!.post('/api/users', { providerId: 'PID-DEMO-A-2', name: 'เจ้าหน้าที่คนที่สอง (DEMO)', hospitalId: env.seed.hid.DEMOA, roles: ['data_entry'] });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/มีเจ้าหน้าที่แล้ว/);
  });
  it('เปลี่ยนเจ้าหน้าที่: ระงับคนเดิมแล้ว session ใช้ไม่ได้ทันที เพิ่มคนใหม่ได้ เปิดคนเดิมซ้อนไม่ได้', async () => {
    const { cookie } = await env.login('PID-DEMO-B-ENTRY');
    const old = (await users()).find((u) => u.provider_id === 'PID-DEMO-B-ENTRY')!;
    expect((await S.ca!.put(`/api/users/${old.id}`, { status: 'suspended' })).statusCode).toBe(200);
    expect((await env.as(cookie).get('/api/auth/me')).statusCode).toBe(401);
    const n = await S.ca!.post('/api/users', { providerId: 'PID-DEMO-B-NEW', name: 'เจ้าหน้าที่ใหม่ B (DEMO)', hospitalId: env.seed.hid.DEMOB, roles: ['data_entry'] });
    expect(n.statusCode).toBe(201);
    expect(n.json().status).toBe('active');
    expect((await S.ca!.put(`/api/users/${old.id}`, { status: 'active' })).statusCode).toBe(409);
    expect((await S.ca!.put(`/api/users/${n.json().id}`, { status: 'suspended' })).statusCode).toBe(200);
    expect((await S.ca!.put(`/api/users/${old.id}`, { status: 'active' })).statusCode).toBe(200);
  });
  it('เข้าสู่ระบบครั้งแรกด้วย Provider ID: สร้างบัญชีเจ้าหน้าที่อัตโนมัติ และคนใหม่แทนคนเดิม', async () => {
    const h = { 'x-mu-csrf': '1' };
    const devLogin = (payload: object) => env.app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: h, payload });
    // ข้อมูลจาก Provider ID ไม่ครบ → ไม่สร้างบัญชี
    expect((await devLogin({ providerId: 'PID-DEMO-B-NEW2', name: 'x', hcode: 'DEMOB' })).statusCode).toBe(400);
    const { cookie: oldCookie } = await env.login('PID-DEMO-B-ENTRY');
    const r = await devLogin({ providerId: 'PID-DEMO-B-NEW2', name: 'เจ้าหน้าที่ใหม่ B2 (DEMO)', hcode: 'DEMOB', hospitalName: 'ชื่ออื่น' });
    expect(r.statusCode).toBe(200);
    const all = await users();
    const fresh = all.find((u) => u.provider_id === 'PID-DEMO-B-NEW2')!;
    expect(fresh.status).toBe('active');
    expect(fresh.hospital_id).toBe(env.seed.hid.DEMOB);
    expect(all.find((u) => u.provider_id === 'PID-DEMO-B-ENTRY')!.status).toBe('suspended');
    expect((await env.as(oldCookie).get('/api/auth/me')).statusCode).toBe(401);
    const me = (await env.as(`mu_session=${r.cookies.find((c) => c.name === 'mu_session')!.value}`).get('/api/auth/me')).json();
    expect(me.roles.map((x: { role: string }) => x.role)).toEqual(['data_entry']);
    // เข้าซ้ำใช้บัญชีเดิม ไม่สร้างใหม่
    expect((await devLogin({ providerId: 'PID-DEMO-B-NEW2', name: 'x', hcode: 'DEMOA', hospitalName: 'x' })).statusCode).toBe(200);
    expect((await users()).length).toBe(all.length);
    // ผู้ใช้ที่ถูกระงับยังเข้าไม่ได้
    expect((await devLogin({ providerId: 'PID-DEMO-B-ENTRY' })).statusCode).toBe(403);
  });
  it('โรงพยาบาลที่ยังไม่มีในระบบ สร้างจากข้อมูลของ Provider ID', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: { 'x-mu-csrf': '1' },
      payload: { providerId: 'PID-DEMO-Z-1', name: 'เจ้าหน้าที่ Z (DEMO)', hcode: 'DEMOZ', hospitalName: 'โรงพยาบาลตัวอย่าง Z (DEMO)' } });
    expect(r.statusCode).toBe(200);
    const hz = (await S.ca!.get('/api/hospitals')).json().find((x: { hcode: string }) => x.hcode === 'DEMOZ');
    expect(hz.name).toBe('โรงพยาบาลตัวอย่าง Z (DEMO)');
  });
  it('ผู้ใช้ที่ยังไม่มีบทบาทรออนุมัติ เข้าสู่ระบบไม่ได้จนกว่าจะกำหนดบทบาท', async () => {
    expect((await S.ca!.post('/api/hospitals', { hcode: 'DEMOC', name: 'รพ.ตัวอย่าง C (DEMO)' })).statusCode).toBe(201);
    const hc = (await S.ca!.get('/api/hospitals')).json().find((h: { hcode: string }) => h.hcode === 'DEMOC');
    const p = await S.ca!.post('/api/users', { providerId: 'PID-DEMO-C-ENTRY', name: 'เจ้าหน้าที่ C (DEMO)', hospitalId: hc.id, roles: [] });
    expect(p.json().status).toBe('pending');
    const r = await env.app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: { 'x-mu-csrf': '1' }, payload: { providerId: 'PID-DEMO-C-ENTRY' } });
    expect(r.statusCode).toBe(403);
    expect((await S.ca!.put(`/api/users/${p.json().id}`, { status: 'active', roles: ['data_entry'] })).statusCode).toBe(200);
    await expect(env.login('PID-DEMO-C-ENTRY')).resolves.toBeTruthy();
  });
  it('เฉพาะส่วนกลางเพิ่มโรงพยาบาลได้', async () => {
    expect((await S.aEntry!.post('/api/hospitals', { hcode: 'DEMOD', name: 'รพ.ตัวอย่าง D (DEMO)' })).statusCode).toBe(403);
    expect((await S.aEntry!.get('/api/hospitals')).json().length).toBe(1);
  });
});

describe('สูตรคำนวณผ่าน API', () => {
  it('preview คืนค่าตรงกับ Excel (CT Scan = 75.536)', async () => {
    const r = await S.aEntry!.post('/api/formula/preview', {
      purchaseYear: 2566, purchasePrice: 25000000, analysisYear: 2569, utilizationPct: 78, cases: 9600, maintenanceCost: 1200000,
      downtimePct: 3, revenue: 21400000, clinicalRating: 4, satisfactionRating: 4, strategicRating: 4,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().utilityScore).toBeCloseTo(75.53598131, 6);
    expect(r.json().explanation.length).toBeGreaterThan(5);
  });
  it('ข้อมูลไม่ครบ → 422 พร้อมเหตุผล', async () => {
    const r = await S.aEntry!.post('/api/formula/preview', {
      purchaseYear: 2567, purchasePrice: 1800000, analysisYear: 2569, utilizationPct: 30, cases: 800, maintenanceCost: 150000,
      downtimePct: 15, revenue: 0, clinicalRating: 3, satisfactionRating: 2, strategicRating: 3,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().problems[0]).toMatch(/ไม่มีรายได้ตรง/);
  });
  it('ชุดสูตรที่อนุมัติคือ v1.1 (D-16)', async () => {
    const r = (await S.aEntry!.get('/api/formula-sets/current')).json();
    expect(r.version).toBe('1.1');
    expect(r.definition.paybackDivisor).toBe('min_age_data_years');
    expect(r.definition.weights.utilization).toBe(0.25);
  });
});
