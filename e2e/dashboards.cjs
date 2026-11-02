/**
 * ทดสอบ Dashboard โรงพยาบาล / ภาพรวมเครือข่าย / กราฟรายครุภัณฑ์: node e2e/dashboards.cjs [baseUrl] [outDir]
 * ต้อง seed แบบมีข้อมูลรายปี: npm run db:seed -- --annual
 */
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || '.';

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const page = async (pid, w = 1440) => {
    const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // 401 จาก /api/auth/me ก่อนเข้าสู่ระบบเป็นพฤติกรรมปกติ
    p.on('console', (m) => m.type() === 'error' && !m.text().includes('status of 401') && errors.push(m.text()));
    await p.goto(`${base}/login`);
    await p.selectOption('#pid', pid);
    await p.click('text=เข้าสู่ระบบแบบจำลอง');
    await p.waitForURL((u) => /\/(dashboard|network)$/.test(u.pathname));
    return p;
  };
  const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
  const year = 2568; // ข้อมูล DEMO รายปีถึงปีงบ 2568

  // ผู้บริหาร รพ.
  const p = await page('PID-DEMO-A-EXEC');
  ok(p.url().endsWith('/dashboard'), 'ผู้บริหาร รพ. เข้าสู่ระบบแล้วไปที่ Dashboard โรงพยาบาล');
  await p.selectOption('#fy', String(year));
  await p.waitForSelector('text=จัดอันดับครุภัณฑ์ตาม Utility Score');
  await p.waitForFunction(() => document.querySelectorAll('canvas').length === 6);
  ok(true, 'แสดงกราฟครบ 6 กราฟ');
  const api = await p.evaluate(async (y) => (await fetch(`/api/dashboard/hospital?year=${y}`)).json(), year);
  const kpi = await p.locator('.kpi').first().innerText();
  ok(kpi.includes(String(api.kpis.equipment)), `KPI จำนวนครุภัณฑ์ตรงกับ API (${api.kpis.equipment})`);
  ok(await p.isVisible(`.kpi >> text=${api.kpis.averageScore.toFixed(1)}`), `KPI Score เฉลี่ยตรงกับ API (${api.kpis.averageScore.toFixed(1)})`);
  ok((await p.locator('tbody tr').count()) === 8, 'ตารางจัดอันดับ 8 รายการ');
  ok((await p.locator('tbody input[type=checkbox]:checked').count()) === 2, 'เลือกเปรียบเทียบเริ่มต้น 2 รายการ (สูงสุด/ต่ำสุด)');
  await p.screenshot({ path: `${out}/s5-01-dashboard.png`, fullPage: true });

  await p.selectOption('#lv', 'low');
  await p.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  ok((await p.locator('tbody tr').innerText()).includes('DEMO-008'), 'กรองระดับ < 40');
  await p.selectOption('#lv', '');
  await p.waitForFunction(() => document.querySelectorAll('tbody tr').length === 8);
  await p.selectOption('#pr', '5000000-20000000');
  await p.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1 && document.querySelector('tbody tr').innerText.includes('DEMO-006'));
  ok((await p.locator('tbody tr').innerText()).includes('DEMO-006'), 'กรองช่วงราคา 5–20 ล้านบาท');
  await p.selectOption('#pr', '');

  // กราฟรายครุภัณฑ์
  const ct = api.equipment.find((e) => e.code === 'DEMO-001');
  await p.goto(`${base}/equipment/${ct.id}`);
  await p.waitForSelector('text=Utilization และ Downtime');
  await p.waitForFunction(() => document.querySelectorAll('canvas').length === 4);
  ok(true, 'หน้ารายละเอียดมีกราฟแนวโน้ม 4 กราฟ');
  await p.screenshot({ path: `${out}/s5-02-detail.png`, fullPage: true });

  // ผู้บริหารส่วนกลาง
  const c = await page('PID-DEMO-CE');
  ok(c.url().endsWith('/network'), 'ผู้บริหารส่วนกลางเข้าสู่ระบบแล้วไปที่ภาพรวมเครือข่าย');
  await c.selectOption('#fy', String(year));
  await c.waitForSelector('text=แต่ละโรงพยาบาลมีครุภัณฑ์ประเภทใด');
  await c.waitForFunction(() => document.querySelectorAll('.tbl.compact tbody tr').length === 2);
  ok(true, 'สรุป 2 โรงพยาบาล');
  ok(await c.isVisible('text=ยังไม่เปิดรอบ'), 'แสดงโรงพยาบาลที่ยังไม่เปิดรอบ');
  ok(await c.isVisible('text=มีข้อมูลรายได้ตรงเพียง') || await c.isVisible('text=ยังไม่มีข้อมูลยืนยันปีงบ'), 'มีรายการที่ควรติดตาม');
  await c.screenshot({ path: `${out}/s5-03-network.png`, fullPage: true });
  await c.locator('.tbl.compact tbody tr', { hasText: 'โรงพยาบาลตัวอย่าง A' }).locator('text=เปิด Dashboard').click();
  await c.waitForURL('**/dashboard?hospitalId=*');
  await c.waitForFunction(() => document.querySelector('#hs')?.selectedOptions[0]?.textContent?.includes('โรงพยาบาลตัวอย่าง A'));
  ok(true, 'เปิด Dashboard ของโรงพยาบาลที่เลือก');

  // ผู้ใช้ รพ. เปิดภาพรวมเครือข่ายไม่ได้
  await p.goto(`${base}/network`);
  await p.waitForURL('**/dashboard');
  ok(true, 'ผู้ใช้ รพ. ถูกส่งกลับไป Dashboard โรงพยาบาล');

  // มือถือ
  const m = await page('PID-DEMO-A-EXEC', 390);
  await m.selectOption('#fy', String(year));
  await m.waitForFunction(() => document.querySelectorAll('canvas').length === 6);
  const sw = await m.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `Dashboard บนมือถือไม่เลื่อนแนวนอน (scrollWidth=${sw})`);
  await m.screenshot({ path: `${out}/s5-04-mobile.png`, fullPage: true });

  ok(errors.length === 0, `ไม่มี JavaScript error (${errors.join(' | ')})`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
