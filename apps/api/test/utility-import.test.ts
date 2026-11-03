import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const C: Record<string, string> = {};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADS = ['ลำดับ', 'รายการครุภัณฑ์', 'ปีที่ซื้อ (พ.ศ.)', 'ราคาซื้อ (บาท)', 'ปีที่ใช้งานแล้ว (ปี)', 'อัตราการใช้งาน\nUtilization (%)',
  'จำนวนเคสสะสม\n(ตั้งแต่ซื้อ)', 'ค่าบำรุงรักษา\nสะสม (บาท)', 'Downtime\nสะสม (%)', 'รายได้สะสม\n(บาท)', 'คะแนนผลลัพธ์\nทางคลินิก (1-5)',
  'คะแนนความพึงพอใจ\nผู้ใช้งาน/ผู้ป่วย (1-5)', 'คะแนนมูลค่า\nเชิงกลยุทธ์ (1-5)', 'ต้นทุนต่อเคส\n(บาท)', 'Payback\nPeriod (ปี)', 'Utilization\nScore',
  'Financial\nScore', 'Reliability\nScore', 'Clinical\nScore', 'Satisfaction\nScore', 'Strategic\nScore', 'Utility Score\nรวม (0-100)', 'อันดับ', 'ข้อเสนอแนะ'];
type Cell = ExcelJS.CellValue;
/** แถวข้อมูล B–M (+ ค่า V ที่สูตรในไฟล์คำนวณไว้) */
type Row = { b: Cell; c?: Cell; d?: Cell; f?: Cell; g?: Cell; h?: Cell; i?: Cell; j?: Cell; k?: Cell; l?: Cell; m?: Cell; v?: number };

function dataSheet(wb: ExcelJS.Workbook, name: string, title: string, rows: Row[], tail: 'blank' | 'note' = 'note') {
  const ws = wb.addWorksheet(name);
  ws.getCell('A1').value = title;
  ws.getRow(3).values = HEADS;
  rows.forEach((x, n) => {
    const r = ws.getRow(4 + n);
    // A เป็นสูตรแบบในไฟล์ต้นแบบ — ไม่ใช้
    r.getCell('A').value = { formula: `IF(B${4 + n}="","",${n + 1})`, result: n + 1 };
    for (const col of 'bcdfghijklm') {
      const v = x[col as keyof Row];
      if (v !== undefined) r.getCell(col.toUpperCase()).value = v as Cell;
    }
    if (x.v !== undefined) r.getCell('V').value = { formula: 'P1', result: x.v };
  });
  const after = 4 + rows.length + (tail === 'blank' ? 1 : 0);
  ws.getCell(`A${after}`).value = 'หมายเหตุ: กรุณาแก้ไขเป็นข้อมูลจริง';
  ws.mergeCells(`A${after}:X${after}`);
  // แถวหลังหมายเหตุต้องไม่ถูกอ่าน
  ws.getRow(after + 1).values = [null, 'ไม่ควรถูกอ่าน', 2569, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  return ws;
}

const full = (b: string, c: Cell, d: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, v?: number): Row =>
  ({ b, c, d, f, g, h, i, j, k, l, m, v });

/** ไฟล์จำลองรูปแบบเดียวกับ Utility_Analysis_...xlsx (ค่าจากไฟล์ต้นแบบ) */
async function workbook(o: { weightUtil?: number; extra?: Row[]; dropPresentRobot?: boolean } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('คำแนะนำ').getCell('B2').value = 'เครื่องมือวิเคราะห์ Utility';
  const st = wb.addWorksheet('สมมติฐาน');
  st.getRow(3).values = ['รายการ', 'ค่า', 'หมายเหตุ'];
  [o.weightUtil ?? 0.25, 0.2, 0.2, 0.15, 0.1, 0.1, 15, 2569].forEach((v, n) => (st.getCell(`B${4 + n}`).value = v));
  dataSheet(wb, 'ตัวอย่างการลงข้อมูลครุภัณฑ์ ', 'ตารางวิเคราะห์ Utility ครุภัณฑ์ทางการแพทย์ (ย้อนหลัง 3 ปี)', [
    full('เครื่อง CT Scan', 2566, 25000000, 78, 9600, 1200000, 3, 21400000, 4, 4, 4),
  ], 'blank');
  dataSheet(wb, 'ข้อมูลครุภัณฑ์ 67-69', 'ตารางวิเคราะห์ Utility ครุภัณฑ์ทางการแพทย์ (ย้อนหลัง 3 ปี)', [
    full('เครื่องให้การรักษาด้วยคลื่นวิทยุ', 2567, 1190000, 15, 1062, 0, 0, 276120, 4, 4, 4, 50.75),
    full('เครื่องถ่ายภาพรังสีกระดูกขากรรไกรและกะโหลกศรีษะ', 2567, 2370000, 12, 225, 0, 0, 99200, 5, 5, 5, 68),
    full('เครื่องเอกซเรย์เคลื่อนที่ดิจิตอล', 2569, 3786666.67, 20, 38, 0, 0, 9800, 4.5, 4.8, 5),
    full('เครื่องเอกซเรย์เคลื่อนที่ดิจิตอล', 2569, 3786666.67, 20, 36, 0, 0, 9800, 4.5, 4.8, 5),
    full('เครื่องเอกซเรย์เคลื่อนที่ดิจิตอล', 2569, 3786666.67, 20, 30, 0, 0, 9800, 4.5, 4.8, 5),
    { b: 'เครื่องกระตุ้นไฟฟ้า Somatics\nthymatron  system IV', c: '2569' },
    full('หุ่นยนต์ตรวจสอบซองยาแบบอัตโนมัติ', 2566, 3960000, 65, 11447, 0, 30, 0, 3, 3, 3),
    full('เครื่องจัดยาอัตโนมัติ กลุ่มงานเภสัชกรรม(ยาใน)', 2566, 6200000, 95, 22894, 360000, 15, 0, 4, 4, 4),
    full('เครื่องตรวจวิเคราะห์สารอิเลคโตรไลท์ลิเทียม', 2565, 764800, 2, 75, 0, 0, 2800, 1, 1, 1),
    { ...full('แถวที่ราคาเป็นสูตร', 2565, 1, 2, 75, 0, 0, 2800, 1, 1, 1), d: { formula: '1000+1', result: 1001 } },
    { ...full('แถวที่ Downtime ผิดพลาด', 2565, 1000, 2, 75, 0, 0, 2800, 1, 1, 1), i: { error: '#REF!' } as Cell },
    ...(o.extra ?? []),
  ]);
  dataSheet(wb, 'นำเสนอ กรมสุขภาพจิต', 'ตารางวิเคราะห์ Utility สถาบันตัวอย่าง (ย้อนหลัง 5 ปี)', [
    full('เครื่องรักษาอาการปวดฯ peripheral magnetic stimulation', 2566, 970000, 75, 6351, 0, 10, 1651260, 4, 4, 4),
    ...(o.dropPresentRobot ? [] : [full('หุ่นยนต์ตรวจสอบซองยาแบบอัตโนมัติ', 2566, 3960000, 50, 11447, 0, 30, 0, 3, 3, 3)]),
  ]);
  wb.addWorksheet('สรุปผลข้อมูลครุภัณฑ์ 67-69').getRow(3).values = ['ลำดับ', 'รายการครุภัณฑ์', 'Utility Score'];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const upload = (who: string, buf: Buffer, filename = 'Utility_Analysis_ทดสอบ.xlsx', q = '') =>
  env.app.inject({
    method: 'POST', url: `/api/utility/import/preview${q}`, payload: buf,
    headers: { cookie: C[who]!, 'x-mu-csrf': '1', 'content-type': XLSX, 'x-filename': encodeURIComponent(filename) },
  });
const as = (who: string) => env.as(C[who]!);

beforeAll(async () => {
  env = await setupTestEnv();
  for (const [k, pid] of Object.entries({ ca: 'PID-DEMO-CA', aEntry: 'PID-DEMO-A-ENTRY', bEntry: 'PID-DEMO-B-ENTRY' })) C[k] = (await env.login(pid)).cookie;
});
afterAll(async () => env?.teardown());

type PRow = { sourceRow: number; name: string; status: string; utilityScore: number | null; rank: number | null; warnings: string[]; errors: string[]; missing: string[]; input: Record<string, unknown> };
type PSheet = { sheet: string; isExample: boolean; selected: boolean; rows: PRow[]; summary: Record<string, number> };
const sheetOf = (p: { sheets: PSheet[] }, name: string) => p.sheets.find((s) => s.sheet === name)!;
const rowOf = (s: PSheet, name: string) => s.rows.find((r) => r.name.startsWith(name))!;

describe('Preview การนำเข้า', () => {
  let p: { previewToken: string; sheets: PSheet[]; ignoredSheets: string[]; notices: string[]; duplicateOf: unknown[]; settings: { fromFile: { problems: string[] } } };
  it('พบชีตข้อมูล 3 ชีต (ตรวจจากหัวตารางแถว 3) ชีตอื่นไม่นำเข้า ชีตตัวอย่างไม่ถูกเลือกโดยค่าเริ่มต้น', async () => {
    const r = await upload('aEntry', await workbook());
    expect(r.statusCode).toBe(200);
    p = r.json();
    expect(p.sheets.map((s) => s.sheet)).toEqual(['ตัวอย่างการลงข้อมูลครุภัณฑ์ ', 'ข้อมูลครุภัณฑ์ 67-69', 'นำเสนอ กรมสุขภาพจิต']);
    expect(p.ignoredSheets).toEqual(['คำแนะนำ', 'สรุปผลข้อมูลครุภัณฑ์ 67-69']);
    expect(p.sheets.map((s) => s.selected)).toEqual([false, true, true]);
    expect(p.duplicateOf).toEqual([]);
    expect(p.settings.fromFile.problems).toEqual([]);
  });
  it('อ่านจนถึงแถวหมายเหตุ / แถวว่าง และไม่อ่านแถวหลังจากนั้น', () => {
    const s = sheetOf(p, 'ข้อมูลครุภัณฑ์ 67-69');
    expect(s.rows).toHaveLength(11);
    expect(s.rows.some((r) => r.name === 'ไม่ควรถูกอ่าน')).toBe(false);
    expect(sheetOf(p, 'ตัวอย่างการลงข้อมูลครุภัณฑ์ ').rows).toHaveLength(1);
  });
  it('คะแนนคำนวณใหม่ฝั่ง server และเตือนเมื่อสูตรในไฟล์ผิด (ไฟล์ 68 → ถูกต้อง 58)', () => {
    const s = sheetOf(p, 'ข้อมูลครุภัณฑ์ 67-69');
    expect(rowOf(s, 'เครื่องให้การรักษาด้วยคลื่นวิทยุ').utilityScore).toBeCloseTo(50.75, 9);
    expect(rowOf(s, 'เครื่องให้การรักษาด้วยคลื่นวิทยุ').status).toBe('ok');
    const jaw = rowOf(s, 'เครื่องถ่ายภาพรังสีกระดูกขากรรไกร');
    expect(jaw.utilityScore).toBeCloseTo(58, 9);
    expect(jaw.warnings.join()).toMatch(/สูตรในไฟล์ผิดปกติ: ไฟล์คำนวณได้ 68\.00 แต่ค่าที่ถูกต้อง = 58\.00/);
  });
  it('ชื่อ+ปี+ราคาซ้ำ → เตือน ไม่รวมแถว คะแนนและอันดับเท่ากัน', () => {
    const xs = sheetOf(p, 'ข้อมูลครุภัณฑ์ 67-69').rows.filter((r) => r.name === 'เครื่องเอกซเรย์เคลื่อนที่ดิจิตอล');
    expect(xs).toHaveLength(3);
    expect(xs.map((r) => r.input.totalCases)).toEqual([38, 36, 30]);
    for (const r of xs) {
      expect(r.utilityScore).toBeCloseTo(57.6, 9);
      expect(r.warnings.join()).toMatch(/ชื่อ\+ปี\+ราคาซ้ำ/);
    }
    expect(new Set(xs.map((r) => r.rank)).size).toBe(1);
  });
  it('แถวขาดช่องจำเป็น → ข้อมูลไม่ครบ ไม่มีคะแนน ไม่ติดอันดับ; ปีเป็นข้อความ "2569" อ่านได้; ชื่อรวมช่องว่าง/ขึ้นบรรทัด', () => {
    const t = rowOf(sheetOf(p, 'ข้อมูลครุภัณฑ์ 67-69'), 'เครื่องกระตุ้นไฟฟ้า');
    expect(t.name).toBe('เครื่องกระตุ้นไฟฟ้า Somatics thymatron system IV');
    expect(t.status).toBe('incomplete');
    expect(t.input.purchaseYearBe).toBe(2569);
    expect(t.utilityScore).toBeNull();
    expect(t.rank).toBeNull();
    expect(t.missing).toContain('ราคาซื้อ');
  });
  it('ช่องกรอกที่เป็นสูตรหรือ #REF! → error ของแถวนั้น', () => {
    const s = sheetOf(p, 'ข้อมูลครุภัณฑ์ 67-69');
    expect(rowOf(s, 'แถวที่ราคาเป็นสูตร').status).toBe('error');
    expect(rowOf(s, 'แถวที่ราคาเป็นสูตร').errors.join()).toMatch(/ราคาซื้อ: เป็นสูตร/);
    expect(rowOf(s, 'แถวที่ Downtime ผิดพลาด').errors.join()).toMatch(/#REF!/);
    expect(s.summary).toEqual({ ok: 2, warning: 6, incomplete: 1, error: 2 });
  });
  it('ชื่อเดียวกันในหลายชีตแต่ค่าต่างกัน → เตือน', () => {
    const r = rowOf(sheetOf(p, 'ข้อมูลครุภัณฑ์ 67-69'), 'หุ่นยนต์ตรวจสอบซองยา');
    expect(r.warnings.join()).toMatch(/Utilization 65 ในชีตนี้ แต่ 50 ในชีต "นำเสนอ กรมสุขภาพจิต"/);
  });
  it('อันดับคิดแยกแต่ละชีต (dataset)', () => {
    const s = sheetOf(p, 'นำเสนอ กรมสุขภาพจิต');
    expect(s.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rowOf(s, 'เครื่องรักษาอาการปวด').utilityScore).toBeCloseTo(78.96, 2);
  });
  it('น้ำหนักในชีตสมมติฐานรวมไม่เท่ากับ 1.00 → ไม่นำมาใช้ พร้อมข้อความชัดเจน', async () => {
    const r = (await upload('aEntry', await workbook({ weightUtil: 0.3 }))).json();
    expect(r.settings.fromFile.values).toBeNull();
    expect(r.notices.join()).toMatch(/ผลรวมน้ำหนัก 6 ด้านต้องเท่ากับ 1\.00/);
  });
});

describe('ความปลอดภัยของไฟล์และสิทธิ์', () => {
  it('รับเฉพาะ .xlsx', async () => {
    const buf = await workbook();
    expect((await upload('aEntry', buf, 'x.xlsm')).statusCode).toBe(400);
    expect((await upload('aEntry', buf, 'x.xls')).statusCode).toBe(400);
    expect((await upload('aEntry', Buffer.from('not a zip file at all'))).json().error).toMatch(/ไม่ใช่ \.xlsx/);
    expect((await upload('aEntry', Buffer.concat([buf, Buffer.from('xl/vbaProject.bin')]))).json().error).toMatch(/มาโคร/);
  });
  it('จำกัดขนาดไฟล์ 5 MB', async () => {
    const big = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    expect((await upload('aEntry', big)).statusCode).toBe(413);
  });
  it('จำกัดจำนวนแถว 5,000', async () => {
    const extra = Array.from({ length: 5001 }, (_, n) => full(`เครื่อง ${n}`, 2565, 1000, 1, 1, 0, 0, 0, 1, 1, 1));
    expect((await upload('aEntry', await workbook({ extra }))).json().error).toMatch(/5000 แถว/);
  });
  it('ต้องเข้าสู่ระบบ; ส่วนกลางต้องเลือกโรงพยาบาล', async () => {
    const r = await env.app.inject({ method: 'POST', url: '/api/utility/import/preview', payload: await workbook(), headers: { 'x-mu-csrf': '1', 'content-type': XLSX, 'x-filename': 'a.xlsx' } });
    expect(r.statusCode).toBe(401);
    expect((await upload('ca', await workbook())).json().error).toMatch(/เลือกโรงพยาบาล/);
    expect((await upload('ca', await workbook(), 'a.xlsx', `?hospitalId=${env.seed.hid.DEMOB}`)).statusCode).toBe(200);
  });
  it('previewToken ใช้ได้เฉพาะผู้ที่อัปโหลด', async () => {
    const p = (await upload('aEntry', await workbook())).json();
    expect((await as('bEntry').post('/api/utility/import/commit', { previewToken: p.previewToken, selectedSheets: ['ข้อมูลครุภัณฑ์ 67-69'], mode: 'append' })).statusCode).toBe(410);
  });
});

describe('ยืนยันนำเข้าและแสดงผล', () => {
  type Rec = { name: string; dataset: string; utilityScore: number | null; rank: number | null; recommendationText: string | null; dataStatus: string; hospitalId: string };
  const records = async (who = 'aEntry', q = '') => (await as(who).get(`/api/utility/records${q}`)).json() as { rows: Rec[]; datasets: { dataset: string }[] };
  let file: Buffer;
  it('commit (append) เขียนเฉพาะชีตที่เลือก ไม่รวมแถว error', async () => {
    file = await workbook();
    const p = (await upload('aEntry', file)).json();
    const r = await as('aEntry').post('/api/utility/import/commit', { previewToken: p.previewToken, selectedSheets: ['ข้อมูลครุภัณฑ์ 67-69', 'นำเสนอ กรมสุขภาพจิต'], mode: 'append' });
    expect(r.statusCode).toBe(200);
    // Thymatron ไม่มีราคาซื้อ จึงไม่สร้างในทะเบียน: 67-69 สร้าง 8 + นำเสนอ 2
    expect(r.json()).toMatchObject({ inserted: 11, replaced: 0, skipped: 2, registered: 10 });
    // token ใช้ซ้ำไม่ได้
    expect((await as('aEntry').post('/api/utility/import/commit', { previewToken: p.previewToken, selectedSheets: ['นำเสนอ กรมสุขภาพจิต'], mode: 'append' })).statusCode).toBe(410);
  });
  it('หน้า records แสดงคะแนน อันดับ ข้อเสนอแนะ และแถวไม่ครบไม่มีอันดับ', async () => {
    const d = await records();
    expect(d.rows).toHaveLength(11);
    expect(d.datasets.map((x) => x.dataset).sort()).toEqual(['ข้อมูลครุภัณฑ์ 67-69', 'นำเสนอ กรมสุขภาพจิต']);
    const s = d.rows.filter((r) => r.dataset === 'ข้อมูลครุภัณฑ์ 67-69');
    const by = (n: string) => s.find((r) => r.name.startsWith(n))!;
    expect(by('เครื่องจัดยาอัตโนมัติ')).toMatchObject({ rank: 1, recommendationText: 'คงสภาพ ติดตามต่อเนื่อง' });
    expect(by('เครื่องจัดยาอัตโนมัติ').utilityScore).toBeCloseTo(78.5, 9);
    expect(by('เครื่องตรวจวิเคราะห์สารอิเลคโตรไลท์ลิเทียม').recommendationText).toBe('พิจารณาทดแทนหรือไม่จัดซื้อเพิ่ม');
    expect(by('เครื่องกระตุ้นไฟฟ้า')).toMatchObject({ dataStatus: 'incomplete', utilityScore: null, rank: null });
    expect((await records('aEntry', '?dataset=นำเสนอ กรมสุขภาพจิต')).rows).toHaveLength(2);
  });
  it('โรงพยาบาลอื่นไม่เห็นข้อมูล', async () => {
    expect((await records('bEntry')).rows.every((r) => r.hospitalId === env.seed.hid.DEMOB)).toBe(true);
  });
  it('สร้างเป็นครุภัณฑ์ใหม่ในทะเบียน ช่องที่ไฟล์ไม่มีเป็นค่าชั่วคราว และติดธงรอกรอกข้อมูลเพิ่ม', async () => {
    const reg = (await as('aEntry').get('/api/equipment?pending=1&pageSize=200')).json();
    expect(reg.total).toBe(10);
    const drug = reg.rows.find((e: { name: string }) => e.name.startsWith('เครื่องจัดยาอัตโนมัติ'));
    expect(drug.code).toMatch(/^IMP-\d{4}-\d{4}$/);
    expect(drug).toMatchObject({ serial_no: drug.code, department_name: 'ไม่ระบุหน่วยงาน', type_name: 'อื่น ๆ', brand: 'ไม่ระบุ', purchase_year_be: 2566, purchase_price: 6200000, details_pending: true });
    expect(new Set(reg.rows.map((e: { code: string }) => e.code)).size).toBe(10);
    // ครุภัณฑ์เดิมของ รพ. A ยังอยู่ (8) + ที่นำเข้า 10
    expect((await as('aEntry').get('/api/equipment')).json().total).toBe(18);
  });
  it('คะแนนในหน้าผลวิเคราะห์และรายงานผู้บริหารใช้ข้อมูลจากไฟล์ (ระบุว่าจากไฟล์ Excel)', async () => {
    const s = (await as('aEntry').get('/api/scores?year=2569')).json();
    const drug = s.rows.find((r: { equipment: { name: string } }) => r.equipment.name.startsWith('เครื่องจัดยาอัตโนมัติ'));
    expect(drug).toMatchObject({ status: 'scored', source: 'excel', recommendationText: 'คงสภาพ ติดตามต่อเนื่อง' });
    expect(drug.utilityScore).toBeCloseTo(78.5, 9);
    const jaw = s.rows.find((r: { equipment: { name: string } }) => r.equipment.name.startsWith('เครื่องถ่ายภาพรังสีกระดูกขากรรไกร'));
    expect(jaw.utilityScore).toBeCloseTo(58, 9);
    // อันดับรวมกับครุภัณฑ์อื่นทั้งโรงพยาบาล (เครื่องรักษาอาการปวดฯ 78.96 จากอีกชีตอยู่อันดับ 1)
    expect(drug.rank).toBe(2);
    const html = (await as('aEntry').get('/api/reports/executive/preview?year=2569')).body;
    expect(html).toContain('เครื่องจัดยาอัตโนมัติ');
    expect(html).toContain('ข้อมูลสะสมจากไฟล์ Excel');
    const x = await env.app.inject({ method: 'GET', url: '/api/reports/executive.xlsx?year=2569', headers: { cookie: C.aEntry! } });
    expect(x.statusCode).toBe(200);
  });
  it('เมื่อมีข้อมูลรายปีที่ยืนยันแล้ว เปลี่ยนไปใช้คะแนนจากข้อมูลรายปี', async () => {
    const reg = (await as('aEntry').get('/api/equipment?pending=1&pageSize=200')).json();
    const drug = reg.rows.find((e: { name: string }) => e.name.startsWith('เครื่องจัดยาอัตโนมัติ'));
    expect((await as('aEntry').get(`/api/equipment/${drug.id}/score?year=2569`)).json().outcome.source).toBe('excel');
    const annual = {
      availableDays: 245, actualDays: 200, maxAvailableHours: 2450, actualHours: 980, useCount: 1120, caseCount: 1050,
      repairCost: 42000, partsCost: 18500, pmCost: 30000, calibrationCost: 12000, otherCost: 2500, revenue: 388000,
      noDirectRevenue: false, repairDays: 21, breakdownCount: 3, downtimeHours: 245, clinicalRating: 3, satisfactionRating: 3, strategicRating: 3,
      ratingRationale: 'ทดสอบ (DEMO)', clinicalNecessity: 'high', condition: 'good', inspectedAt: '2026-10-05', safetyEvent: false,
      recallStatus: 'none', unitRecommendation: 'continue', rationale: 'ทดสอบ (DEMO)',
    };
    const d = (await as('aEntry').put(`/api/equipment/${drug.id}/annual/2569`, annual)).json();
    expect((await as('aEntry').post(`/api/annual/${d.record.id}/submit`, {})).statusCode).toBe(200);
    const sc = (await as('aEntry').get(`/api/equipment/${drug.id}/score?year=2569`)).json();
    expect(sc.outcome.source).toBe('annual');
    expect(sc.outcome.years).toEqual([2569]);
  });
  it('แก้ไขครุภัณฑ์แล้วธง "รอกรอกข้อมูลเพิ่ม" หายไป', async () => {
    const reg = (await as('aEntry').get('/api/equipment?pending=1&pageSize=200')).json();
    const e = reg.rows.find((x: { name: string }) => x.name.startsWith('เครื่องตรวจวิเคราะห์สารอิเลคโตรไลท์'));
    const r = await as('aEntry').put(`/api/equipment/${e.id}`, {
      code: 'EQM-LI-01', name: e.name, typeId: e.type_id, departmentId: e.department_id, brand: 'DemoLab', model: 'LI-1', serialNo: 'SN-LI-01',
      purchaseYearBe: e.purchase_year_be, purchasePrice: e.purchase_price, receivedDate: e.received_date, startDate: e.start_date,
      status: 'in_use', maintenancePlan: 'none', version: e.version,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().details_pending).toBe(false);
    expect((await as('aEntry').get('/api/equipment?pending=1')).json().total).toBe(9);
  });
  it('อัปโหลดไฟล์เดิมซ้ำ → Preview เตือน', async () => {
    const p = (await upload('aEntry', file)).json();
    expect(p.duplicateOf).toHaveLength(1);
    expect(p.notices.join()).toMatch(/ไฟล์นี้เคยนำเข้าแล้ว 1 ครั้ง/);
  });
  it('โหมดแทนที่: ซ่อนข้อมูลเดิมของชีตนั้น (soft delete) แล้วเขียนใหม่', async () => {
    const p = (await upload('aEntry', file)).json();
    const r = (await as('aEntry').post('/api/utility/import/commit', { previewToken: p.previewToken, selectedSheets: ['นำเสนอ กรมสุขภาพจิต'], mode: 'replace' })).json();
    // ชื่อ+ปี+ราคาตรงกัน → ใช้ครุภัณฑ์เดิม ไม่สร้างซ้ำในทะเบียน
    expect(r).toMatchObject({ inserted: 2, replaced: 2, registered: 0, reused: 2, removed: 0 });
    expect((await records('aEntry', '?dataset=นำเสนอ กรมสุขภาพจิต')).rows).toHaveLength(2);
    expect((await records()).rows).toHaveLength(11);
    expect((await as('aEntry').get('/api/equipment')).json().total).toBe(18);
  });
  it('โหมดแทนที่: เครื่องที่ไม่มีในไฟล์ใหม่ ลบเฉพาะครุภัณฑ์ชั่วคราวที่ยังไม่ได้แก้และไม่มีข้อมูลรายปี', async () => {
    const p = (await upload('aEntry', await workbook({ dropPresentRobot: true }))).json();
    const r = (await as('aEntry').post('/api/utility/import/commit', { previewToken: p.previewToken, selectedSheets: ['นำเสนอ กรมสุขภาพจิต'], mode: 'replace' })).json();
    expect(r).toMatchObject({ inserted: 1, replaced: 2, registered: 0, reused: 1, removed: 1 });
    expect((await as('aEntry').get('/api/equipment')).json().total).toBe(17);
  });
  it('ปรับน้ำหนักแล้วคะแนนเปลี่ยนทันที; เฉพาะส่วนกลางปรับได้ และน้ำหนักรวมต้อง = 1', async () => {
    const before = (await records()).rows.find((r) => r.name.startsWith('เครื่องจัดยาอัตโนมัติ'))!.utilityScore!;
    const body = { weights: { utilization: 0.5, clinical: 0.1, financial: 0.1, reliability: 0.1, satisfaction: 0.1, strategic: 0.1 }, paybackPenalty: 15, currentYearBe: 2569 };
    expect((await as('aEntry').post('/api/utility/settings', body)).statusCode).toBe(403);
    expect((await as('ca').post('/api/utility/settings', { ...body, weights: { ...body.weights, utilization: 0.6 } })).statusCode).toBe(400);
    expect((await as('ca').post('/api/utility/settings', body)).statusCode).toBe(201);
    const after = (await records()).rows.find((r) => r.name.startsWith('เครื่องจัดยาอัตโนมัติ'))!.utilityScore!;
    // 95×0.5 + 80×0.1 + 50×0.1 + 85×0.1 + 80×0.1 + 80×0.1
    expect(after).toBeCloseTo(85, 9);
    expect(after).not.toBeCloseTo(before, 3);
    const s = (await as('aEntry').get('/api/utility/settings')).json();
    expect(s.active.weights.utilization).toBe(0.5);
    expect(s.history.length).toBeGreaterThanOrEqual(2);
  });
  it('ดาวน์โหลดไฟล์แบบฟอร์มเปล่า (หัวตารางแถว 3) แล้วอ่านกลับได้', async () => {
    const r = await env.app.inject({ method: 'GET', url: '/api/utility/template', headers: { cookie: C.aEntry! } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const p = (await upload('aEntry', r.rawPayload, 'template.xlsx')).json();
    expect(p.sheets).toHaveLength(1);
    expect(p.sheets[0].rows).toEqual([]);
    expect(p.settings.fromFile.values.weights.utilization).toBe(0.5);
  });
  it('บันทึกการนำเข้าใน Audit Log และ hash chain ยังถูกต้อง', async () => {
    const v = (await as('aEntry').get('/api/audit/verify')).json();
    expect(v.broken).toEqual([]);
    const b = (await as('aEntry').get('/api/utility/batches')).json();
    expect(b.length).toBe(3);
    expect(b[0].mode).toBe('replace');
    expect(b.at(-1).registered_count).toBe(10);
  });
});
