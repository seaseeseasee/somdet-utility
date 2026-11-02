/**
 * ทดสอบหน้ารายงานผู้บริหาร + ดาวน์โหลด PDF/Excel: node e2e/reports.cjs [baseUrl] [outDir]
 * ต้อง seed แบบมีข้อมูลรายปี: npm run db:seed -- --annual
 */
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || '.';

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
  await p.goto(`${base}/login`);
  await p.selectOption('#pid', 'PID-DEMO-A-EXEC');
  await p.click('text=เข้าสู่ระบบแบบจำลอง');
  await p.waitForURL('**/dashboard');
  await p.click('nav >> text=รายงานผู้บริหาร');
  await p.selectOption('#fy', '2568');
  const frame = p.frameLocator('iframe[title="ตัวอย่างรายงาน"]');
  await frame.locator('h2', { hasText: 'ตารางจัดอันดับและข้อเสนอแนะ' }).waitFor();
  ok(true, 'แสดงตัวอย่างรายงานก่อนพิมพ์');
  ok((await frame.locator('span.sc').count()) === 8, 'ตัวอย่างมีรายการที่มีคะแนน 8 รายการ');
  await p.fill('input[aria-label="ผู้จัดทำ"]', 'นางสาวตัวอย่าง (DEMO)');
  await frame.locator('.sig', { hasText: 'นางสาวตัวอย่าง (DEMO)' }).waitFor();
  ok(true, 'ชื่อผู้ลงนามแสดงในตัวอย่าง');
  await p.uncheck('text=กราฟ Utility Score รายครุภัณฑ์');
  await p.waitForFunction(() => !document.querySelector('iframe')?.srcdoc.includes('<svg'));
  ok(true, 'ยกเลิกส่วนกราฟแล้วตัวอย่างอัปเดต');
  await p.check('text=กราฟ Utility Score รายครุภัณฑ์');
  await frame.locator('svg').waitFor();
  await p.screenshot({ path: `${out}/s6-01-reports.png`, fullPage: true });

  const [pdf] = await Promise.all([p.waitForEvent('download'), p.click('text=ส่งออก PDF')]);
  const pdfPath = `${out}/report.pdf`;
  await pdf.saveAs(pdfPath);
  ok(fs.readFileSync(pdfPath).subarray(0, 5).toString() === '%PDF-' && /\.pdf$/.test(pdf.suggestedFilename()), `ดาวน์โหลด PDF (${pdf.suggestedFilename()})`);
  const [xl] = await Promise.all([p.waitForEvent('download'), p.click('text=ส่งออก Excel')]);
  const xlPath = `${out}/report.xlsx`;
  await xl.saveAs(xlPath);
  ok(fs.readFileSync(xlPath).subarray(0, 2).toString() === 'PK', `ดาวน์โหลด Excel (${xl.suggestedFilename()})`);
  await p.waitForFunction(() => document.body.innerText.includes('.xlsx') && document.body.innerText.includes('.pdf'), null, { timeout: 10000 });
  ok(true, 'รายการที่ส่งออกล่าสุดแสดงทั้ง PDF และ Excel');

  ok(errors.length === 0, `ไม่มี JavaScript error (${errors.join(' | ')})`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
