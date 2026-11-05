/**
 * ทดสอบ Dashboard โรงพยาบาล และภาพรวมเครือข่าย: node e2e/dashboards.cjs [baseUrl] [outDir]
 * ต้อง seed แบบมีข้อมูลรายปี (ปี 2565–2568)
 */
const { base, out, ok, start, run } = require('./lib.cjs');

run(async () => {
  const { page, finish } = await start();
  const year = '2568';

  const p = await page('PID-DEMO-A-ENTRY');
  await p.goto(`${base}/dashboard`);
  await p.selectOption('#fy', year);
  await p.waitForSelector('text=จัดอันดับครุภัณฑ์ตาม Utility Score');
  const api = await p.evaluate(async (y) => (await fetch(`/api/dashboard/hospital?year=${y}`)).json(), year);
  const kpi = await p.locator('.kpi').first().innerText();
  ok(kpi.includes(String(api.kpis.equipment)), `KPI จำนวนครุภัณฑ์ = ${api.kpis.equipment} ตรงกับ API`);
  ok((await p.locator('main canvas').count()) >= 5, 'แสดงกราฟครบ (คะแนน เรดาร์ Utilization ค่าบำรุง Downtime รายได้)');
  const ranked = api.equipment.filter((e) => e.utilityScore !== null).length;
  ok((await p.locator('table.compact tbody tr').count()) === ranked, `ตารางจัดอันดับ ${ranked} รายการ`);
  await p.locator('table.compact tbody tr input[type=checkbox]').nth(1).check();
  ok((await p.locator('table.compact tbody input:checked').count()) >= 1, 'เลือกครุภัณฑ์เปรียบเทียบในกราฟได้');
  await p.screenshot({ path: `${out}/s5-01-dashboard.png`, fullPage: true });

  const m = await page('PID-DEMO-A-ENTRY', { width: 390 });
  await m.goto(`${base}/dashboard`);
  await m.waitForSelector('.kpi');
  const sw = await m.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `Dashboard บนมือถือไม่เลื่อนแนวนอน (scrollWidth=${sw})`);

  const c = await page('PID-DEMO-CA');
  await c.goto(`${base}/network`);
  await c.selectOption('#fy', year);
  await c.waitForSelector('text=สรุปรายโรงพยาบาล');
  ok(await c.isVisible('text=โรงพยาบาลตัวอย่าง A (DEMO)') && await c.isVisible('text=โรงพยาบาลตัวอย่าง B (DEMO)'), 'ภาพรวมเครือข่ายแสดงทุกโรงพยาบาล');
  await c.screenshot({ path: `${out}/s5-02-network.png`, fullPage: true });

  const b = await page('PID-DEMO-B-ENTRY');
  await b.goto(`${base}/network`);
  await b.waitForTimeout(800);
  ok(!(await b.isVisible('text=สรุปรายโรงพยาบาล')), 'เจ้าหน้าที่ รพ. เปิดภาพรวมเครือข่ายไม่ได้');

  await finish();
});
