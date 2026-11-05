/**
 * Smoke test ผ่านเบราว์เซอร์: node e2e/smoke.cjs [baseUrl] [outDir]
 * ต้องเปิด API + Web และ seed ข้อมูล DEMO ใหม่ (รพ. A 8 รายการ, รพ. B 2 รายการ)
 */
const { base, out, ok, start, run } = require('./lib.cjs');

run(async () => {
  const { page, finish } = await start();

  // หน้าเข้าสู่ระบบ
  const p0 = await page(null);
  await p0.goto(`${base}/login`);
  await p0.waitForSelector('text=เข้าสู่ระบบแบบจำลอง');
  ok(await p0.isVisible('#pid'), 'หน้าเข้าสู่ระบบมีตัวเลือกบัญชีจำลอง');
  await p0.screenshot({ path: `${out}/e2e-01-login.png` });

  // เจ้าหน้าที่ รพ. A: ทะเบียน ค้นหา ลงทะเบียน แก้ไข
  const p = await page('PID-DEMO-A-ENTRY');
  await p.goto(`${base}/equipment`);
  await p.waitForSelector('tbody tr');
  ok((await p.locator('tbody tr').count()) === 8, 'รพ. A เห็นครุภัณฑ์ 8 รายการ');
  await p.fill('input[aria-label="ค้นหา"]', 'Ultrasound');
  await p.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  ok(true, 'ค้นหา "Ultrasound" เหลือ 1 รายการ');
  await p.fill('input[aria-label="ค้นหา"]', '');
  await p.screenshot({ path: `${out}/e2e-02-registry.png`, fullPage: true });

  await p.click('text=+ เพิ่มครุภัณฑ์');
  await p.click('button:has-text("ลงทะเบียนครุภัณฑ์")');
  await p.waitForSelector('text=กรุณากรอกรหัสครุภัณฑ์');
  ok(true, 'ฟอร์มว่างแสดงข้อผิดพลาดภาษาไทย');
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
  ok(/^\d+$/.test(await p.inputValue('#age')), 'อายุคำนวณอัตโนมัติ');
  await p.click('button:has-text("ลงทะเบียนครุภัณฑ์")');
  await p.waitForSelector('text=วันที่เริ่มใช้งานต้องไม่ก่อนวันที่รับเข้า');
  ok(true, 'ตรวจวันที่เริ่มใช้ก่อนวันรับเข้า');
  await p.fill('#startDate', '2024-03-05');
  await p.screenshot({ path: `${out}/e2e-03-form.png`, fullPage: true });
  await p.click('button:has-text("ลงทะเบียนครุภัณฑ์")');
  await p.waitForSelector('text=ประวัติการแก้ไข');
  ok(await p.isVisible('text=เครื่องทดสอบ E2E (DEMO)'), 'บันทึกแล้วเปิดหน้ารายละเอียด');
  const detailUrl = p.url();

  await p.click('main a:has-text("แก้ไข") >> nth=0');
  await p.waitForSelector('#name');
  // แต่ละโรงพยาบาลมีเจ้าหน้าที่คนเดียว จึงแก้รหัสครุภัณฑ์ได้เอง (สิทธิ์ equipment.code.change)
  ok((await p.getAttribute('#code', 'readonly')) === null, 'เจ้าหน้าที่แก้รหัสครุภัณฑ์ได้');
  await p.fill('#name', 'เครื่องทดสอบ E2E แก้ไข (DEMO)');
  await p.click('button:has-text("บันทึกการแก้ไข")');
  await p.waitForSelector('.diff');
  ok(await p.isVisible('text=เครื่องทดสอบ E2E แก้ไข (DEMO)'), 'แก้ไขสำเร็จ');
  ok((await p.locator('.diff').first().innerText()).includes('ชื่อ'), 'ประวัติแสดงค่าก่อน/หลัง');
  await p.screenshot({ path: `${out}/e2e-04-detail.png`, fullPage: true });

  // รพ. B เห็นเฉพาะของตัวเอง
  const pb = await page('PID-DEMO-B-ENTRY');
  await pb.goto(`${base}/equipment`);
  await pb.waitForSelector('tbody tr');
  ok((await pb.locator('tbody tr').count()) === 2, 'รพ. B เห็นเฉพาะ 2 รายการของตน');
  await pb.goto(detailUrl);
  await pb.waitForSelector('text=ไม่พบครุภัณฑ์');
  ok(true, 'รพ. B เปิดลิงก์ครุภัณฑ์ของ รพ. A ไม่ได้');

  // ผู้ดูแลระบบส่วนกลาง: เห็นทุกโรงพยาบาลและจัดการผู้ใช้
  const pc = await page('PID-DEMO-CA');
  await pc.goto(`${base}/equipment`);
  await pc.waitForSelector('tbody tr');
  ok((await pc.locator('tbody tr').count()) === 11, 'ส่วนกลางเห็นครุภัณฑ์ทุกโรงพยาบาล (11 รายการ)');
  await pc.goto(`${base}/users`);
  await pc.waitForSelector('text=PID-DEMO-B-ENTRY');
  ok(await pc.isVisible('text=PID-DEMO-A-ENTRY'), 'ส่วนกลางเห็นผู้ใช้ทุกโรงพยาบาล');
  await pc.screenshot({ path: `${out}/e2e-05-users.png`, fullPage: true });

  // มือถือ
  const pm = await page('PID-DEMO-A-ENTRY', { width: 390 });
  await pm.goto(`${base}/equipment`);
  await pm.waitForSelector('tbody tr');
  const sw = await pm.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `มือถือไม่มีการเลื่อนแนวนอนทั้งหน้า (scrollWidth=${sw})`);
  await pm.screenshot({ path: `${out}/e2e-06-mobile.png`, fullPage: true });

  await finish();
});
