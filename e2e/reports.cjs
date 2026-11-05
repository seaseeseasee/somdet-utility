/**
 * ทดสอบหน้ารายงานผู้บริหาร + ดาวน์โหลด PDF/Excel: node e2e/reports.cjs [baseUrl] [outDir]
 * ต้อง seed แบบมีข้อมูลรายปี และ API ต้องมี Chromium (PDF_CHROMIUM_PATH) จึงจะส่งออก PDF ได้
 */
const fs = require('fs');
const { base, out, ok, start, run } = require('./lib.cjs');

run(async () => {
  const { page, finish } = await start();
  const p = await page('PID-DEMO-A-ENTRY', { downloads: true });
  await p.goto(`${base}/reports`);
  await p.selectOption('#fy', '2568');
  const frame = p.frameLocator('iframe[title="ตัวอย่างรายงาน"]');
  await frame.locator('h2', { hasText: 'ตารางจัดอันดับและข้อเสนอแนะ' }).waitFor();
  ok(true, 'แสดงตัวอย่างรายงานก่อนพิมพ์');
  ok((await frame.locator('span.sc').count()) === 8, 'ตัวอย่างมีรายการที่มีคะแนน 8 รายการ');

  await p.fill('input[aria-label="ผู้จัดทำ"]', 'นางสาวตัวอย่าง (DEMO)');
  await frame.locator('.sig', { hasText: 'นางสาวตัวอย่าง (DEMO)' }).waitFor();
  ok(true, 'ชื่อผู้ลงนามแสดงในตัวอย่าง');
  await p.fill('input[aria-label="วันที่ลงนาม ผู้จัดทำ"]', '2026-11-05');
  await frame.locator('.sig', { hasText: '2569' }).first().waitFor();
  ok(true, 'วันที่ลงนามแสดงเป็นปี พ.ศ.');

  await p.uncheck('text=กราฟ Utility Score รายครุภัณฑ์');
  await p.waitForFunction(() => !document.querySelector('iframe')?.srcdoc.includes('<svg'));
  ok(true, 'ยกเลิกส่วนกราฟแล้วตัวอย่างอัปเดต');
  await p.check('text=กราฟ Utility Score รายครุภัณฑ์');
  await frame.locator('svg').first().waitFor();
  await p.screenshot({ path: `${out}/s6-01-reports.png`, fullPage: true });

  const [pdf] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('text=ส่งออก PDF')]);
  const pdfPath = `${out}/report.pdf`;
  await pdf.saveAs(pdfPath);
  ok(fs.readFileSync(pdfPath).subarray(0, 5).toString() === '%PDF-' && /\.pdf$/.test(pdf.suggestedFilename()), `ดาวน์โหลด PDF (${pdf.suggestedFilename()})`);
  const [xl] = await Promise.all([p.waitForEvent('download'), p.click('text=ส่งออก Excel')]);
  const xlPath = `${out}/report.xlsx`;
  await xl.saveAs(xlPath);
  ok(fs.readFileSync(xlPath).subarray(0, 2).toString() === 'PK', `ดาวน์โหลด Excel (${xl.suggestedFilename()})`);
  await p.waitForFunction(() => document.body.innerText.includes('.xlsx') && document.body.innerText.includes('.pdf'), null, { timeout: 10000 });
  ok(true, 'รายการที่ส่งออกล่าสุดแสดงทั้ง PDF และ Excel');

  await finish();
});
