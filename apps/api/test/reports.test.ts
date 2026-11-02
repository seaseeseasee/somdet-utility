import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const S: Record<string, ReturnType<typeof env.as>> = {};
const Y = 2568;
const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();

beforeAll(async () => {
  env = await setupTestEnv({}, { annual: true });
  for (const [k, pid] of Object.entries({ ce: 'PID-DEMO-CE', aEntry: 'PID-DEMO-A-ENTRY', aExec: 'PID-DEMO-A-EXEC', bEntry: 'PID-DEMO-B-ENTRY' }))
    S[k] = env.as((await env.login(pid)).cookie);
  // ชื่อที่มี HTML ต้องถูก escape ในรายงาน
  await S.aEntry!.post('/api/equipment', {
    code: 'DEMO-XSS', name: '<img src=x onerror=alert(1)> เครื่องทดสอบ (DEMO)', typeId: env.seed.types['อื่น ๆ'],
    departmentId: env.seed.dep['DEMOA/กลุ่มงานรังสีวิทยา'], brand: 'Demo', model: 'X', serialNo: 'SN-XSS', purchaseYearBe: 2566,
    purchasePrice: 1200000, receivedDate: '2023-01-01', startDate: '2023-01-01', status: 'in_use',
  });
}, 120000);
afterAll(async () => env?.teardown());

describe('รายงานผู้บริหาร', () => {
  it('ตัวอย่าง HTML: ข้อมูลครบ และ escape ข้อความ', async () => {
    const r = await S.aExec!.get(`/api/reports/executive/preview?year=${Y}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    const h = r.body;
    expect(h).toContain('รายงานสรุปผลการวิเคราะห์ Utility Score');
    expect(h).toContain('โรงพยาบาลตัวอย่าง A (DEMO)');
    expect(h).toContain('ชุดสูตร v1.1');
    expect((h.match(/<span class="sc"/g) ?? []).length).toBe(8);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('รายการที่ยังไม่มีคะแนน (1)');
    expect(h).toMatch(/@font-face\{font-family:'Plex Thai'/);
  });
  it('เลือกส่วนที่แสดงได้', async () => {
    const h = (await S.aExec!.get(`/api/reports/executive/preview?year=${Y}&sections=kpi`)).body;
    expect(h).toContain('class="kpis"');
    expect(h).not.toContain('ตารางจัดอันดับและข้อเสนอแนะ</h2>');
    expect(h).not.toContain('<svg');
    const a = (await S.aExec!.get(`/api/reports/executive/preview?year=${Y}&sections=annual,ranking&preparedBy=${encodeURIComponent('นาย ทดสอบ (DEMO)')}`)).body;
    expect(a).toContain('ภาคผนวก: ข้อมูลรายปีที่ใช้คำนวณ');
    expect(a).toContain('นาย ทดสอบ (DEMO)');
  });
  it('รพ. B ได้รายงานเฉพาะของตน', async () => {
    const h = (await S.bEntry!.get(`/api/reports/executive/preview?year=${Y}`)).body;
    expect(h).toContain('โรงพยาบาลตัวอย่าง B (DEMO)');
    expect(h).not.toContain('DEMO-001');
  });
  it('ส่วนกลางรวมทุกโรงพยาบาล พร้อมคอลัมน์โรงพยาบาล', async () => {
    const h = (await S.ce!.get(`/api/reports/executive/preview?year=${Y}`)).body;
    expect(h).toContain('ทุกโรงพยาบาลในเครือข่าย');
    expect(h).toContain('<th>โรงพยาบาล</th>');
  });

  it('PDF ภาษาไทย ขนาด A4 มีเลขหน้า', async () => {
    const r = await S.aExec!.get(`/api/reports/executive.pdf?year=${Y}&sections=kpi,chart,ranking,factors,annual,method`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toMatch(/Utility_Report_2568_.*\.pdf/);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    if (hasPdftotext) {
      const dir = mkdtempSync(path.join(tmpdir(), 'mu-pdf-'));
      const f = path.join(dir, 'r.pdf');
      writeFileSync(f, r.rawPayload);
      const text = execFileSync('pdftotext', ['-layout', f, '-']).toString();
      expect(text).toContain('รายงานสรุปผลการวิเคราะห์');
      expect(text).toContain('ซื้อเพิ่ม/อัปเกรดรุ่นใหม่');
      expect(text).toMatch(/หน้า 1 \/ \d/);
      const info = execFileSync('pdfinfo', [f]).toString();
      expect(info).toMatch(/Page size:.*\(A4\)/);
    }
  }, 60000);

  it('Excel: 5–6 ชีต และสูตรตรวจสอบ Utility Score ตรงกับระบบ', async () => {
    const r = await S.aExec!.get(`/api/reports/executive.xlsx?year=${Y}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['สรุป', 'จัดอันดับ', 'คะแนน 6 ปัจจัย', 'ข้อมูลรายปีที่ใช้', 'วิธีคำนวณ', 'ยังไม่มีคะแนน']);
    expect(wb.getWorksheet('จัดอันดับ')!.rowCount).toBe(9);
    const f = wb.getWorksheet('คะแนน 6 ปัจจัย')!;
    expect(f.getRow(2).getCell(3).value).toBe(0.25);
    for (let n = 3; n <= 10; n++) {
      const row = f.getRow(n);
      const cell = row.getCell(10).value as { formula: string; result: number };
      expect(cell.formula).toBe(`C${n}*C$2+D${n}*D$2+E${n}*E$2+F${n}*F$2+G${n}*G$2+H${n}*H$2`);
      // คำนวณสูตรซ้ำจากค่าในชีต
      const recomputed = [3, 4, 5, 6, 7, 8].reduce((s, c) => s + (row.getCell(c).value as number) * (f.getRow(2).getCell(c).value as number), 0);
      expect(recomputed).toBeCloseTo(row.getCell(9).value as number, 9);
    }
    const annual = wb.getWorksheet('ข้อมูลรายปีที่ใช้')!;
    expect(annual.rowCount - 1).toBe(28); // ข้อมูล DEMO ที่ยืนยันแล้ว 28 แถว
  });

  it('บันทึกการส่งออกใน Audit และแสดงรายการล่าสุดเฉพาะในขอบเขต', async () => {
    const recent = (await S.aExec!.get('/api/reports/recent')).json();
    expect(recent.map((x: { after: { format: string } }) => x.after.format)).toEqual(['xlsx', 'pdf']);
    expect(recent[0].actor_name).toBe('ผู้บริหารตัวอย่าง A');
    expect((await S.bEntry!.get('/api/reports/recent')).json()).toEqual([]);
    expect((await env.app.inject({ method: 'GET', url: '/api/reports/executive.pdf' })).statusCode).toBe(401);
  });
});

describe('ตัดข้อความภาษาไทย', () => {
  it('ไม่ตัดสระหรือวรรณยุกต์ออกจากพยัญชนะ', async () => {
    const { truncate } = await import('../src/reports/html.js');
    const t = truncate('เครื่องวิเคราะห์ภูมิคุ้มกันอัตโนมัติ', 10);
    expect(t.endsWith('…')).toBe(true);
    expect([...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(t)].length).toBe(10);
    expect(t).toBe('เครื่องวิเคร…'); // เ ค รื่ อ ง วิ เ ค ร + …
    expect(truncate('สั้น', 10)).toBe('สั้น');
  });
});
