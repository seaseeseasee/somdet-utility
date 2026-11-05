/**
 * ทดสอบข้อมูลรายปีผ่านเบราว์เซอร์: บันทึกร่าง → ตรวจข้อผิดพลาด → ยืนยัน → ปลดล็อกโดยเจ้าหน้าที่เอง
 * node e2e/annual.cjs [baseUrl] [outDir] — ต้อง seed แบบมีข้อมูลรายปี (ปี 2565–2568) ปีงบ 2569 ยังว่าง
 */
const { base, out, ok, start, run, equipmentId } = require('./lib.cjs');

const FY = 2569; // ปีงบ 2569 = 1 ต.ค. 2568 – 30 ก.ย. 2569

run(async () => {
  const { page, finish } = await start();
  const entry = await page('PID-DEMO-A-ENTRY');
  const id = await equipmentId(entry, 'DEMO-002');
  ok(Boolean(id), 'พบครุภัณฑ์ DEMO-002');
  const url = `${base}/equipment/${id}/annual/${FY}`;
  const status = () => entry.locator('.card.hrow .chip').first().innerText();
  const fill = async (o) => { for (const [k, v] of Object.entries(o)) await entry.fill('#' + k, String(v)); };

  await entry.goto(url);
  await entry.waitForSelector('#availableDays');
  ok((await status()) === 'ยังไม่บันทึก', `ปีงบ ${FY} ยังไม่มีข้อมูล`);
  ok(await entry.isVisible('text=ชุดสูตร v'), 'แสดงเวอร์ชันชุดสูตร');

  // ข้อมูลผิด: วันใช้จริงมากกว่าวันพร้อมใช้
  await fill({ availableDays: 245, actualDays: 260, maxAvailableHours: 2450, actualHours: 980 });
  await entry.click('button:has-text("บันทึกร่าง")');
  await entry.waitForSelector('text=บันทึกร่างแล้ว');
  ok((await status()) === 'ร่าง', 'บันทึกร่างแล้วสถานะเป็น "ร่าง"');
  ok(await entry.isVisible('text=วันใช้งานจริงต้องไม่เกินวันพร้อมใช้งาน'), 'ตรวจพบวันใช้จริง > วันพร้อมใช้');
  await entry.click('button:has-text("ยืนยันข้อมูล")');
  await entry.waitForSelector('text=ยังยืนยันไม่ได้');
  ok(true, 'ยืนยันขณะข้อมูลไม่ครบไม่ได้');

  // กรอกให้ครบ
  await fill({
    actualDays: 200, useCount: 1120, caseCount: 1050, repairCost: 42000, partsCost: 18500, pmCost: 30000, calibrationCost: 12000,
    otherCost: 2500, revenue: 388000, repairDays: 21, breakdownCount: 3, downtimeHours: 245,
    clinicalRating: 3, satisfactionRating: 3, strategicRating: 3, ratingRationale: 'จากแบบสอบถามผู้ใช้ (DEMO)',
    inspectedAt: '2026-09-05', rationale: 'ผู้รับบริการลดลง เสนอจัดสรรร่วมกับ OPD (DEMO)',
  });
  for (const [k, v] of Object.entries({ condition: 'good', clinicalNecessity: 'high', safetyEvent: 'no', recallStatus: 'none', unitRecommendation: 'increase_use' }))
    await entry.selectOption('#' + k, v);
  ok((await entry.inputValue('#maintTotal')) === '105,000', 'รวมค่าบำรุงรักษาอัตโนมัติ = 105,000');
  await entry.click('button:has-text("บันทึกร่าง")');
  await entry.waitForSelector('text=ข้อมูลครบ พร้อมยืนยัน');
  ok(await entry.isVisible('.calc-line >> text=40.0%'), 'Utilization Rate = 980 ÷ 2,450 = 40.0%');

  // ประวัติซ่อมบำรุง
  await entry.fill('#mxDate', '2025-12-12');
  await entry.fill('#mxDetail', 'เปลี่ยน Probe (DEMO)');
  await entry.fill('#mxCost', '28000');
  await entry.click('button:has-text("+ เพิ่ม")');
  await entry.waitForSelector('text=เพิ่มประวัติซ่อมบำรุงแล้ว');
  ok(await entry.isVisible('td >> text=เปลี่ยน Probe (DEMO)'), 'เพิ่มประวัติซ่อมบำรุง');
  await entry.screenshot({ path: `${out}/s3-01-form.png`, fullPage: true });

  // ยืนยัน
  await entry.click('button:has-text("ยืนยันข้อมูล")');
  await entry.waitForSelector('text=ยืนยันข้อมูลแล้ว');
  ok((await status()) === 'ยืนยันแล้ว', 'สถานะเป็น "ยืนยันแล้ว"');
  ok(await entry.isDisabled('#actualHours'), 'ยืนยันแล้วแก้ไขไม่ได้');
  await entry.screenshot({ path: `${out}/s3-02-approved.png`, fullPage: true });

  // เจ้าหน้าที่ปลดล็อกเอง (ต้องมีเหตุผล)
  await entry.click('button:has-text("ปลดล็อกเพื่อแก้ไข")');
  await entry.fill('#reason', 'แก้');
  ok(await entry.isDisabled('button:has-text("ยืนยันปลดล็อก")'), 'เหตุผลสั้นกว่า 5 ตัวอักษรปลดล็อกไม่ได้');
  await entry.fill('#reason', 'ชั่วโมงใช้งานไม่ตรงกับสถิติ RIS (DEMO)');
  await entry.click('button:has-text("ยืนยันปลดล็อก")');
  await entry.waitForSelector('text=ปลดล็อกแล้ว ข้อมูลกลับเป็นร่าง');
  ok((await status()) === 'ร่าง', 'ปลดล็อกแล้วกลับเป็นร่าง');
  ok(await entry.isEnabled('#actualHours'), 'แก้ไขได้อีกครั้ง');
  ok(await entry.isVisible('.tl >> text=ชั่วโมงใช้งานไม่ตรงกับสถิติ RIS'), 'ประวัติแสดงเหตุผลการปลดล็อก');

  // แก้แล้วยืนยันใหม่
  await entry.fill('#actualHours', '1000');
  await entry.click('button:has-text("ยืนยันข้อมูล")');
  await entry.waitForSelector('text=ยืนยันข้อมูลแล้ว');
  ok((await status()) === 'ยืนยันแล้ว', 'แก้ไขแล้วยืนยันใหม่ได้');

  // รพ. B เปิดข้อมูลของ รพ. A ไม่ได้
  const b = await page('PID-DEMO-B-ENTRY');
  await b.goto(url);
  await b.waitForSelector('text=ไม่พบครุภัณฑ์');
  ok(true, 'รพ. B เปิดข้อมูลรายปีของ รพ. A ไม่ได้');

  await finish();
});
