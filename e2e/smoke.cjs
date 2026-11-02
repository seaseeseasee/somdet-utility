/**
 * Smoke test ผ่านเบราว์เซอร์ (Playwright): node e2e/smoke.cjs [baseUrl] [outDir]
 * ต้องเปิด API + Web และ seed ข้อมูล DEMO ไว้ก่อน
 */
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || '.';

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctx = async (w = 1440) => {
    const c = await b.newContext({ viewport: { width: w, height: 900 } });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const login = async (p, pid) => {
    await p.goto(`${base}/login`);
    await p.selectOption('#pid', pid);
    await p.click('text=เข้าสู่ระบบแบบจำลอง');
    await p.waitForURL((u) => !u.pathname.startsWith('/login'));
    await p.goto(`${base}/equipment`);
    await p.waitForSelector('tbody tr');
  };
  const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

  let p = await ctx();
  await p.goto(`${base}/login`);
  await p.waitForSelector('text=โหมดพัฒนา');
  await p.screenshot({ path: `${out}/e2e-01-login.png` });
  await login(p, 'PID-DEMO-A-ENTRY');
  assert((await p.locator('tbody tr').count()) === 8, 'รพ. A เห็นครุภัณฑ์ 8 รายการ');
  await p.screenshot({ path: `${out}/e2e-02-registry.png`, fullPage: true });

  await p.fill('input[aria-label="ค้นหา"]', 'ultra');
  await p.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  assert(true, 'ค้นหา "ultra" เหลือ 1 รายการ');
  await p.fill('input[aria-label="ค้นหา"]', '');

  await p.click('text=+ เพิ่มครุภัณฑ์');
  await p.click('text=ลงทะเบียนครุภัณฑ์');
  assert(await p.isVisible('text=กรุณากรอกรหัสครุภัณฑ์'), 'ฟอร์มว่างแสดงข้อผิดพลาดภาษาไทย');
  await p.fill('#code', 'DEMO-E2E-01');
  await p.fill('#name', 'เครื่องทดสอบ E2E (DEMO)');
  await p.selectOption('#typeId', { label: 'รังสีวินิจฉัย' });
  await p.selectOption('#departmentId', { label: 'กลุ่มงานรังสีวิทยา' });
  await p.fill('#serialNo', 'SN-E2E-01');
  await p.fill('#brand', 'DemoBrand');
  await p.fill('#model', 'E2E');
  await p.fill('#purchaseYearBe', '2567');
  await p.fill('#purchasePrice', '1250000');
  await p.fill('#receivedDate', '2024-03-01');
  await p.fill('#startDate', '2024-02-01');
  assert(await p.inputValue('#age') === '2', 'อายุคำนวณอัตโนมัติ = 2 ปี');
  await p.click('text=ลงทะเบียนครุภัณฑ์');
  assert(await p.isVisible('text=วันที่เริ่มใช้งานต้องไม่ก่อนวันที่รับเข้า'), 'ตรวจวันที่เริ่มใช้ก่อนวันรับเข้า');
  await p.fill('#startDate', '2024-03-05');
  await p.screenshot({ path: `${out}/e2e-03-form.png`, fullPage: true });
  await p.click('text=ลงทะเบียนครุภัณฑ์');
  await p.waitForSelector('text=ประวัติการแก้ไข');
  await p.waitForSelector('text=ลงทะเบียนครุภัณฑ์');
  assert(await p.isVisible('text=เครื่องทดสอบ E2E (DEMO)'), 'บันทึกแล้วเปิดหน้ารายละเอียด');

  await p.click('text=แก้ไข');
  await p.fill('#name', 'เครื่องทดสอบ E2E แก้ไข (DEMO)');
  assert(await p.getAttribute('#code', 'readonly') !== null, 'เจ้าหน้าที่แก้รหัสไม่ได้');
  await p.click('text=บันทึกการแก้ไข');
  await p.waitForSelector('.diff');
  assert(await p.isVisible('text=เครื่องทดสอบ E2E แก้ไข (DEMO)'), 'แก้ไขสำเร็จ');
  assert((await p.locator('.diff').first().innerText()).includes('ชื่อ'), 'ประวัติแสดงค่าก่อน/หลัง');
  await p.screenshot({ path: `${out}/e2e-04-detail.png`, fullPage: true });

  const pb = await ctx();
  await login(pb, 'PID-DEMO-B-ENTRY');
  assert((await pb.locator('tbody tr').count()) === 2, 'รพ. B เห็นเฉพาะ 2 รายการของตน');
  await pb.goto(p.url().replace(/\/edit$/, ''));
  await pb.waitForSelector('text=ไม่พบครุภัณฑ์');
  assert(true, 'รพ. B เปิดลิงก์ครุภัณฑ์ของ รพ. A ไม่ได้');

  const pa = await ctx();
  await login(pa, 'PID-DEMO-A-ADMIN');
  await pa.click('text=ผู้ใช้งานและสิทธิ์');
  await pa.waitForSelector('text=PID-DEMO-A-PENDING');
  await pa.screenshot({ path: `${out}/e2e-05-users.png`, fullPage: true });
  assert(!(await pa.isVisible('text=PID-DEMO-B-ENTRY')), 'ผู้ดูแล รพ. A ไม่เห็นผู้ใช้ รพ. B');

  const pc = await ctx();
  await login(pc, 'PID-DEMO-CE');
  assert((await pc.locator('tbody tr').count()) === 11, 'ผู้บริหารส่วนกลางเห็นทุกโรงพยาบาล (11 รายการ)');
  assert(!(await pc.isVisible('text=+ เพิ่มครุภัณฑ์')), 'ผู้บริหารส่วนกลางไม่มีปุ่มเพิ่ม');

  const pm = await ctx(390);
  await login(pm, 'PID-DEMO-A-ENTRY');
  const sw = await pm.evaluate(() => document.documentElement.scrollWidth);
  assert(sw <= 390, `มือถือไม่มีการเลื่อนแนวนอนทั้งหน้า (scrollWidth=${sw})`);
  await pm.screenshot({ path: `${out}/e2e-06-mobile.png`, fullPage: true });

  assert(errors.length === 0, `ไม่มี JavaScript error (${errors.join(' | ')})`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
