/**
 * ทดสอบหน้าผลวิเคราะห์ Utility Score: node e2e/scores.cjs [baseUrl] [outDir]
 * ต้อง seed แบบมีข้อมูลรายปี (รพ. A มีข้อมูลยืนยันแล้วปี 2565–2568)
 */
const { base, out, ok, start, run } = require('./lib.cjs');

run(async () => {
  const { page, finish } = await start();
  const p = await page('PID-DEMO-A-ENTRY');
  await p.goto(`${base}/scores`);
  await p.waitForFunction(() => document.querySelectorAll('tbody tr.click').length >= 8, null, { timeout: 15000 });
  ok(true, 'รพ. A มีครุภัณฑ์ที่มีคะแนน 8 รายการ');

  const api = await p.evaluate(async () => (await fetch('/api/scores')).json());
  const top = api.rows[0];
  const firstRow = await p.locator('tbody tr.click').first().innerText();
  ok(firstRow.includes(top.equipment.name) && firstRow.includes(top.utilityScore.toFixed(1)), `อันดับ 1 ตรงกับ API (${top.equipment.code} = ${top.utilityScore.toFixed(2)})`);
  ok(await p.isVisible(`text=v${api.formula.version}`), `แสดงชุดสูตร v${api.formula.version}`);
  await p.waitForSelector('text=วิธีคำนวณ');
  ok(await p.isVisible('text=Payback ='), 'แผงที่มาของคะแนนแสดงสูตร Payback');
  ok(await p.isVisible('text=ข้อมูลที่ใช้: ปีงบ'), 'แสดงปีงบที่ใช้คำนวณ');
  await p.screenshot({ path: `${out}/s4-01-scores.png`, fullPage: true });

  const low = api.rows.filter((r) => r.utilityScore !== null && r.recommendation === 'low').map((r) => r.equipment.code);
  await p.selectOption('#lv', 'low');
  await p.waitForFunction((n) => document.querySelectorAll('tbody tr.click').length === n, low.length);
  ok(low.length === 0 || (await p.locator('tbody tr.click').first().innerText()).includes(low[0]), `กรองระดับ < 40 เหลือ ${low.length} รายการ (${low.join(', ')})`);
  await p.selectOption('#lv', '');

  const id = api.rows.find((r) => r.equipment.code === 'DEMO-001').equipment.id;
  await p.goto(`${base}/equipment/${id}`);
  await p.waitForSelector('text=แนวโน้มรายปี');
  ok(await p.isVisible('text=Utility Score ปีงบ'), 'หน้ารายละเอียดแสดง Utility Score');
  ok((await p.locator('text=แนวโน้มรายปี >> xpath=../../..').locator('tbody tr').count()) >= 3, 'ตารางแนวโน้มรายปีมีอย่างน้อย 3 ปี');
  await p.screenshot({ path: `${out}/s4-02-detail.png`, fullPage: true });

  // ส่วนกลางเห็นรายการ รพ. B ที่ยังไม่มีคะแนน
  const c = await page('PID-DEMO-CA');
  await c.goto(`${base}/scores`);
  await c.waitForSelector('text=ยังคำนวณคะแนนไม่ได้');
  ok(await c.isVisible('td >> text=โรงพยาบาลตัวอย่าง B (DEMO)'), 'ส่วนกลางเห็นรายการ รพ. B ที่ยังไม่มีคะแนน');

  await finish();
});
