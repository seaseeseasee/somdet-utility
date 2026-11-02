/**
 * ทดสอบหน้าผลวิเคราะห์ Utility Score: node e2e/scores.cjs [baseUrl] [outDir]
 * ต้อง seed ข้อมูลแบบมีข้อมูลรายปี: npm run db:seed -- --annual
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
    await p.goto(`${base}/login`);
    await p.selectOption('#pid', pid);
    await p.click('text=เข้าสู่ระบบแบบจำลอง');
    await p.waitForURL('**/equipment');
    return p;
  };
  const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };

  const p = await page('PID-DEMO-A-EXEC');
  await p.click('nav >> text=ผลวิเคราะห์ Utility Score');
  await p.waitForFunction(() => document.querySelectorAll('tbody tr.click').length >= 8, null, { timeout: 10000 });
  ok(true, 'รพ. A มีครุภัณฑ์ที่มีคะแนน 8 รายการ');
  const api = await p.evaluate(async () => (await fetch('/api/scores')).json());
  ok(api.formula.version === '1.1', 'ใช้ชุดสูตร v1.1');
  const top = api.rows[0];
  const firstRow = await p.locator('tbody tr.click').first().innerText();
  ok(firstRow.includes(top.equipment.name) && firstRow.includes(top.utilityScore.toFixed(1)), `อันดับ 1 ตรงกับ API (${top.equipment.code} = ${top.utilityScore.toFixed(2)})`);
  await p.waitForSelector('text=วิธีคำนวณ');
  ok(await p.isVisible('text=Payback ='), 'แผงที่มาของคะแนนแสดงสูตร Payback');
  ok(await p.isVisible('text=ข้อมูลที่ใช้: ปีงบ'), 'แสดงปีงบที่ใช้คำนวณ');
  await p.screenshot({ path: `${out}/s4-01-scores.png`, fullPage: true });

  await p.selectOption('#lv', 'low');
  await p.waitForFunction(() => document.querySelectorAll('tbody tr.click').length === 1);
  ok((await p.locator('tbody tr.click').first().innerText()).includes('DEMO-008'), 'กรองระดับ < 40 เหลือ DEMO-008');
  await p.selectOption('#lv', '');

  const id = api.rows.find((r) => r.equipment.code === 'DEMO-001').equipment.id;
  await p.goto(`${base}/equipment/${id}`);
  await p.waitForSelector('text=แนวโน้มรายปี');
  ok(await p.isVisible('text=Utility Score ปีงบ'), 'หน้ารายละเอียดแสดง Utility Score');
  ok((await p.locator('text=แนวโน้มรายปี >> xpath=../../..').locator('tbody tr').count()) >= 3, 'ตารางแนวโน้มรายปีมีอย่างน้อย 3 ปี');
  await p.screenshot({ path: `${out}/s4-02-detail.png`, fullPage: true });

  const c = await page('PID-DEMO-CE');
  await c.click('nav >> text=ผลวิเคราะห์ Utility Score');
  await c.waitForSelector('#hs');
  await c.waitForSelector('text=ยังคำนวณคะแนนไม่ได้');
  ok(await c.isVisible('td >> text=โรงพยาบาลตัวอย่าง B (DEMO)'), 'ส่วนกลางเห็นรายการ รพ. B ที่ยังไม่มีคะแนน');

  ok(errors.length === 0, `ไม่มี JavaScript error (${errors.join(' | ')})`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
