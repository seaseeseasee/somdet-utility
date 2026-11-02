/**
 * ทดสอบขั้นตอนรอบประเมิน + ข้อมูลรายปีผ่านเบราว์เซอร์: node e2e/annual.cjs [baseUrl] [outDir]
 * ต้องเปิด API + Web และ seed ข้อมูล DEMO ใหม่ก่อน (ยังไม่มีรอบประเมิน)
 */
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || '.';

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const page = async (pid) => {
    const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    await p.goto(`${base}/login`);
    await p.selectOption('#pid', pid);
    await p.click('text=เข้าสู่ระบบแบบจำลอง');
    await p.waitForURL((u) => !u.pathname.startsWith('/login'));
    await p.goto(`${base}/equipment`);
    return p;
  };
  const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
  const status = (p) => p.locator('.card.hrow .chip').first().innerText();

  // 1) ผู้ดูแล รพ. เปิดรอบ และมอบหมายงาน
  const admin = await page('PID-DEMO-A-ADMIN');
  await admin.click('nav >> text=ครบกำหนดประเมิน');
  const openBtn = admin.locator('button', { hasText: 'เปิดรอบประเมินปีงบ' });
  await openBtn.waitFor();
  const fyText = await openBtn.innerText();
  const FY = Number(fyText.match(/\d{4}/)[0]);
  await openBtn.click();
  await admin.waitForSelector('text=เปิดรอบประเมินปีงบ ' + FY + ' แล้ว');
  await admin.waitForFunction(() => document.querySelectorAll('tbody tr').length === 7, null, { timeout: 10000 });
  ok(true, `เปิดรอบปีงบ ${FY} สร้างรายการครบกำหนด 7 รายการ`);
  await admin.selectOption('select[aria-label="ผู้รับผิดชอบ DEMO-002"]', { label: 'เจ้าหน้าที่ตัวอย่าง A' });
  await admin.waitForSelector('text=มอบหมาย DEMO-002 แล้ว');
  ok(true, 'มอบหมาย DEMO-002 ให้เจ้าหน้าที่');

  // 2) เจ้าหน้าที่บันทึกข้อมูล
  const entry = await page('PID-DEMO-A-ENTRY');
  await entry.click('nav >> text=ครบกำหนดประเมิน');
  await entry.waitForSelector('tbody tr');
  await entry.check('text=เฉพาะงานที่มอบหมายให้ฉัน');
  await entry.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  ok(true, 'เจ้าหน้าที่เห็นงานที่มอบหมาย 1 รายการ');
  await entry.screenshot({ path: `${out}/s3-01-due.png`, fullPage: true });
  await entry.click('text=เริ่มตรวจ/บันทึก');
  await entry.waitForSelector('#availableDays');
  const fill = async (o) => { for (const [k, v] of Object.entries(o)) await entry.fill('#' + k, String(v)); };
  await fill({ availableDays: 245, actualDays: 260, maxAvailableHours: 2450, actualHours: 980 });
  await entry.click('button:has-text("บันทึกร่าง")');
  await entry.waitForSelector('text=บันทึกร่างแล้ว');
  ok(await entry.isVisible('text=วันใช้งานจริงต้องไม่เกินวันพร้อมใช้งาน'), 'ตรวจพบวันใช้จริง > วันพร้อมใช้');
  await entry.click('button:has-text("ส่งให้ผู้ตรวจสอบ")');
  await entry.waitForSelector('text=ยังส่งตรวจไม่ได้');
  ok(true, 'ส่งตรวจขณะข้อมูลไม่ครบไม่ได้');
  await fill({
    actualDays: 200, useCount: 1120, caseCount: 1050, repairCost: 42000, partsCost: 18500, pmCost: 30000, calibrationCost: 12000,
    otherCost: 2500, revenue: 388000, repairDays: 21, breakdownCount: 3, downtimeHours: 245,
    clinicalRating: 3, satisfactionRating: 3, strategicRating: 3, ratingRationale: 'จากแบบสอบถามผู้ใช้ (DEMO)',
    inspectedAt: `${FY - 543}-10-05`, rationale: 'ผู้รับบริการลดลง เสนอจัดสรรร่วมกับ OPD (DEMO)',
  });
  for (const [k, v] of Object.entries({ condition: 'good', clinicalNecessity: 'high', safetyEvent: 'no', recallStatus: 'none', unitRecommendation: 'increase_use' }))
    await entry.selectOption('#' + k, v);
  ok((await entry.inputValue('#maintTotal')) === '105,000', 'รวมค่าบำรุงรักษาอัตโนมัติ = 105,000');
  await entry.click('button:has-text("บันทึกร่าง")');
  await entry.waitForSelector('text=ข้อมูลครบ พร้อมส่งให้ผู้ตรวจสอบ');
  ok(await entry.isVisible('.calc-line >> text=40.0%'), 'Utilization Rate = 40.0%');
  await entry.fill('#mxDate', `${FY - 544}-12-12`);
  await entry.fill('#mxDetail', 'เปลี่ยน Probe (DEMO)');
  await entry.fill('#mxCost', '28000');
  await entry.click('button:has-text("+ เพิ่ม")');
  await entry.waitForSelector('text=เพิ่มประวัติซ่อมบำรุงแล้ว');
  ok(await entry.isVisible('td >> text=เปลี่ยน Probe (DEMO)'), 'เพิ่มประวัติซ่อมบำรุง');
  await entry.screenshot({ path: `${out}/s3-02-form.png`, fullPage: true });
  await entry.click('button:has-text("ส่งให้ผู้ตรวจสอบ")');
  await entry.waitForSelector('text=ส่งให้ผู้ตรวจสอบแล้ว');
  ok((await status(entry)) === 'รอตรวจสอบ', 'สถานะเป็น "รอตรวจสอบ"');
  ok(await entry.isDisabled('#actualHours'), 'ส่งแล้วแก้ไขไม่ได้');

  // 3) ผู้ตรวจสอบตีกลับ
  const rev = await page('PID-DEMO-A-REVIEW');
  await rev.click('nav >> text=รอตรวจสอบ');
  await rev.waitForSelector('tbody tr');
  await rev.screenshot({ path: `${out}/s3-03-review-queue.png`, fullPage: true });
  await rev.click('text=ตรวจสอบ >> nth=-1');
  await rev.click('button:has-text("ตีกลับให้แก้ไข")');
  await rev.fill('#reason', 'ชั่วโมงใช้งานไม่ตรงกับสถิติ RIS (DEMO)');
  await rev.click('button:has-text("ยืนยันตีกลับ")');
  await rev.waitForSelector('text=ตีกลับแล้ว');
  ok((await status(rev)) === 'ร่าง', 'ตีกลับแล้วสถานะกลับเป็นร่าง');

  // 4) เจ้าหน้าที่เห็นเหตุผล แก้ แล้วส่งใหม่
  await entry.click('nav >> text=ครบกำหนดประเมิน');
  await entry.waitForSelector('text=ตีกลับโดย ผู้ตรวจตัวอย่าง A');
  ok(await entry.isVisible('text=ชั่วโมงใช้งานไม่ตรงกับสถิติ RIS'), 'เจ้าหน้าที่เห็นเหตุผลที่ถูกตีกลับ');
  await entry.click('text=บันทึกต่อ');
  await entry.waitForSelector('#actualHours');
  await entry.fill('#actualHours', '1000');
  await entry.click('button:has-text("ส่งให้ผู้ตรวจสอบ")');
  await entry.waitForSelector('text=ส่งให้ผู้ตรวจสอบแล้ว');

  // 5) ผู้ตรวจสอบยืนยัน
  await rev.reload();
  await rev.click('button:has-text("ยืนยันข้อมูล")');
  await rev.waitForSelector('text=ยืนยันข้อมูลแล้ว');
  ok((await status(rev)) === 'ยืนยันแล้ว', 'ผู้ตรวจสอบยืนยันข้อมูล');
  ok(await rev.isVisible('.tl >> text=ตีกลับ'), 'ประวัติการตรวจสอบแสดงการตีกลับ');
  await rev.screenshot({ path: `${out}/s3-04-approved.png`, fullPage: true });

  // 6) ผู้ดูแลปิดรอบ
  await admin.reload();
  await admin.waitForSelector('tbody tr');
  await admin.click('button:has-text("ปิดรอบประเมิน")');
  await admin.click('button:has-text("ยืนยันปิดรอบ")');
  await admin.waitForSelector('text=ปิดรอบประเมินแล้ว');
  await admin.waitForSelector('.chip >> text=ปิดรอบแล้ว');
  ok(true, 'ปิดรอบประเมินแล้ว');
  await admin.goto(rev.url());
  await admin.waitForSelector('#actualHours');
  ok((await status(admin)) === 'ล็อกแล้ว', 'ข้อมูลที่ยืนยันแล้วถูกล็อกเมื่อปิดรอบ');
  ok(await admin.isVisible('text=ปลดล็อกให้แก้ไข'), 'ผู้ดูแลเห็นปุ่มปลดล็อก');

  // 7) รพ. B มองไม่เห็นงานของ รพ. A
  const bEntry = await page('PID-DEMO-B-ENTRY');
  await bEntry.click('nav >> text=ครบกำหนดประเมิน');
  await bEntry.waitForSelector('text=ยังไม่มีรอบประเมิน');
  ok(true, 'รพ. B ไม่เห็นรอบประเมินของ รพ. A');

  ok(errors.length === 0, `ไม่มี JavaScript error (${errors.join(' | ')})`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
