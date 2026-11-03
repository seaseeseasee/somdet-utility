import ExcelJS from 'exceljs';
import { REC, thaiDate, type ReportData } from './data.js';

const FONT = 'Tahoma';
const HEAD: Partial<ExcelJS.Style> = {
  font: { name: FONT, bold: true, color: { argb: 'FF0A2E5C' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF4FB' } },
  alignment: { vertical: 'middle', wrapText: true },
  border: { bottom: { style: 'thin', color: { argb: 'FFC9D6E6' } } },
};
const BAND: Record<string, string> = { high: 'FFE5F5EC', good: 'FFE6F0FC', medium: 'FFFFF5D6', low: 'FFFDE9E7' };

function sheet(wb: ExcelJS.Workbook, name: string, cols: [string, number, string?][]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([header, width, numFmt]) => ({ header, width, style: { font: { name: FONT, size: 10 }, ...(numFmt ? { numFmt } : {}) } }));
  ws.getRow(1).eachCell((c) => Object.assign(c, { style: { ...c.style, ...HEAD } }));
  ws.getRow(1).height = 32;
  return ws;
}

/**
 * สมุดงาน Excel สำหรับผู้บริหารและผู้ตรวจสอบ
 * ชีต "คะแนน 6 ปัจจัย" มีคอลัมน์สูตร Excel คำนวณ Utility Score ซ้ำจากคะแนนและน้ำหนัก เพื่อตรวจสอบย้อนหลังได้
 */
export async function buildWorkbook(d: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Medical Equipment Utility Analysis';
  wb.created = d.generatedAt;
  const multi = d.multiHospital;

  // 1) สรุป
  const s = wb.addWorksheet('สรุป');
  s.columns = [{ width: 34 }, { width: 60 }];
  const info: [string, string | number | null][] = [
    [d.title, null], [d.subtitle, null], ['', null],
    ['หน่วยงาน', d.scopeLabel], ['ปีวิเคราะห์ (ปีงบ)', d.year], ['ข้อมูลที่ใช้', `ข้อมูลรายปีที่ยืนยันแล้ว ปีงบ ${d.window.from}–${d.window.to}`],
    ['ชุดสูตร', `v${d.formulaVersion}`], ['จัดทำเมื่อ', thaiDate(d.generatedAt, true)], ['จัดทำโดย', d.generatedBy], ['', null],
    ['ครุภัณฑ์ทั้งหมด (รายการ)', d.kpis.equipment], ['มีคะแนน (รายการ)', d.kpis.scored], ['มูลค่ารวม (บาท)', d.kpis.totalValue],
    ['Utility Score เฉลี่ย', d.kpis.averageScore], [`80–100 ${REC.high}`, d.kpis.high], [`60–79 ${REC.good}`, d.kpis.good],
    [`40–59 ${REC.medium}`, d.kpis.medium], [`< 40 ${REC.low}`, d.kpis.low], ['ธงเตือน (Utilization < 40% หรือ Score < 50)', d.kpis.warning],
  ];
  info.forEach(([a, b], i) => {
    const r = s.getRow(i + 1);
    r.getCell(1).value = a;
    if (b !== null) r.getCell(2).value = b;
    r.font = { name: FONT, size: i === 0 ? 14 : 10, bold: i === 0 };
  });
  s.getCell('B13').numFmt = '#,##0';
  s.getCell('B14').numFmt = '0.00';
  s.getCell('B2').font = { name: FONT, size: 10, color: { argb: 'FF4A5A72' } };

  // 2) จัดอันดับ
  const r = sheet(wb, 'จัดอันดับ', [
    ['อันดับ', 8], ['รหัส', 14], ['ชื่อครุภัณฑ์', 36], ...(multi ? [['โรงพยาบาล', 30] as [string, number]] : []), ['หน่วยงาน', 24], ['ประเภท', 18],
    ['ปีที่ซื้อ', 9], ['ราคาจัดซื้อ (บาท)', 16, '#,##0'], ['Utility Score', 12, '0.00'], ['ข้อเสนอแนะ', 34], ['ธงเตือน', 10],
  ]);
  for (const x of d.rows) {
    const row = r.addRow([x.rank, x.code, x.name, ...(multi ? [x.hospital] : []), x.department, x.type, x.purchaseYear, x.purchasePrice,
      x.breakdown.utilityScore, x.breakdown.recommendationText, x.breakdown.warning ? 'มี' : '']);
    row.getCell(multi ? 10 : 9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND[x.breakdown.recommendation] } };
  }
  r.autoFilter = { from: 'A1', to: { row: 1, column: r.columnCount } };

  // 3) คะแนน 6 ปัจจัย + สูตรตรวจสอบ
  const w = (d.formulaDefinition.weights ?? {}) as Record<string, number>;
  const f = sheet(wb, 'คะแนน 6 ปัจจัย', [
    ['รหัส', 14], ['ชื่อครุภัณฑ์', 32], ['Utilization', 11, '0.00'], ['Clinical', 10, '0.00'], ['Financial', 10, '0.00'], ['Reliability', 11, '0.00'],
    ['Satisfaction', 12, '0.00'], ['Strategic', 10, '0.00'], ['Utility Score (ระบบ)', 14, '0.000000'], ['ตรวจสอบด้วยสูตร Excel', 16, '0.000000'],
    ['ผลต่าง', 10, '0.000000'], ['อายุ (ปี)', 9], ['ตัวหาร Payback (ปี)', 12], ['Payback (ปี)', 11, '0.00'], ['ต้นทุนต่อเคส (บาท)', 14, '#,##0.00'], ['ปีงบที่ใช้', 26],
  ]);
  const wRow = f.addRow(['น้ำหนัก', '(ชุดสูตร v' + d.formulaVersion + ')', w.utilization, w.clinical, w.financial, w.reliability, w.satisfaction, w.strategic]);
  wRow.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF7A4B00' } };
  for (let c = 3; c <= 8; c++) { wRow.getCell(c).numFmt = '0.00'; wRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6E8' } }; }
  d.rows.forEach((x, i) => {
    const n = i + 3;
    const sc = x.breakdown.scores;
    f.addRow([
      x.code, x.name, sc.utilization, sc.clinical, sc.financial, sc.reliability, sc.satisfaction, sc.strategic, x.breakdown.utilityScore,
      { formula: `C${n}*C$2+D${n}*D$2+E${n}*E$2+F${n}*F$2+G${n}*G$2+H${n}*H$2`, result: x.breakdown.utilityScore },
      { formula: `ROUND(J${n}-I${n},6)`, result: 0 },
      x.breakdown.ageYears, x.breakdown.paybackDivisorYears, x.breakdown.paybackYears ?? 'N/A', x.breakdown.costPerCase ?? 'N/A', x.basis,
    ]);
  });

  // 4) ข้อมูลรายปีที่ใช้
  const a = sheet(wb, 'ข้อมูลรายปีที่ใช้', [
    ['รหัส', 14], ['ชื่อครุภัณฑ์', 28], ...(multi ? [['โรงพยาบาล', 26] as [string, number]] : []), ['ปีงบ', 8], ['สถานะ', 10],
    ['วันพร้อมใช้', 10], ['วันใช้จริง', 10], ['ชม.พร้อมใช้', 11, '#,##0'], ['ชม.ใช้จริง', 11, '#,##0'], ['ครั้งใช้งาน', 11, '#,##0'], ['เคส', 10, '#,##0'],
    ['ค่าซ่อม', 12, '#,##0'], ['ค่าอะไหล่', 12, '#,##0'], ['ค่า PM', 12, '#,##0'], ['ค่าสอบเทียบ', 12, '#,##0'], ['ค่าอื่น', 12, '#,##0'],
    ['รายได้', 14, '#,##0'], ['ไม่มีรายได้ตรง', 10], ['วันหยุดซ่อม', 10], ['ครั้งที่เสีย', 10], ['ชม. Downtime', 11, '#,##0'],
    ['Clinical (1–5)', 10], ['Satisfaction (1–5)', 11], ['Strategic (1–5)', 10],
  ]);
  for (const y of d.annual)
    a.addRow([y.code, y.equipmentName, ...(multi ? [y.hospital] : []), y.fiscalYear, y.status === 'locked' ? 'ล็อกแล้ว' : 'ยืนยันแล้ว',
      y.availableDays, y.actualDays, y.maxAvailableHours, y.actualHours, y.useCount, y.caseCount, y.repairCost, y.partsCost, y.pmCost,
      y.calibrationCost, y.otherCost, y.revenue, y.noDirectRevenue ? 'ใช่' : '', y.repairDays, y.breakdownCount, y.downtimeHours,
      y.clinicalRating, y.satisfactionRating, y.strategicRating] as ExcelJS.CellValue[]);

  // 5) วิธีคำนวณ
  const m = wb.addWorksheet('วิธีคำนวณ');
  m.columns = [{ width: 16 }, { width: 110 }];
  m.addRow([`ชุดสูตร v${d.formulaVersion}`]).font = { name: FONT, bold: true, size: 12 };
  for (const [k, v] of [
    ['Utility Score', `Utilization×${w.utilization} + Clinical×${w.clinical} + Financial×${w.financial} + Reliability×${w.reliability} + Satisfaction×${w.satisfaction} + Strategic×${w.strategic}`],
    ['Utilization', 'Σชั่วโมงใช้งานจริง ÷ Σชั่วโมงพร้อมใช้งาน × 100'],
    ['Reliability', '100 − Downtime % (Σชั่วโมงหยุด ÷ Σชั่วโมงพร้อมใช้ × 100)'],
    ['Clinical ฯลฯ', 'คะแนน 1–5 ของปีล่าสุด × 20'],
    ['Payback', 'ราคาซื้อ ÷ (รายได้รวม ÷ MIN(อายุตามสูตร Excel, จำนวนปีที่มีข้อมูล)) · อายุ = MAX(ปีวิเคราะห์ − ปีที่ซื้อ, 1)'],
    ['Financial', 'MIN(100, MAX(0, 100 − Payback × 15)) · ไม่มีรายได้ตรง = 50'],
    ['เกณฑ์', `80–100 ${REC.high} · 60–79 ${REC.good} · 40–59 ${REC.medium} · < 40 ${REC.low}`],
    ['ข้อมูล', `ใช้เฉพาะข้อมูลรายปีที่ยืนยันแล้ว ปีงบ ${d.window.from}–${d.window.to} · รายการที่ข้อมูลไม่ครบไม่ได้รับคะแนน`],
  ]) m.addRow([k, v]).font = { name: FONT, size: 10 };
  m.addRow([]);
  m.addRow(['ที่มาของคะแนนรายครุภัณฑ์']).font = { name: FONT, bold: true, size: 11 };
  for (const x of d.rows) {
    m.addRow([x.code, x.name]).font = { name: FONT, bold: true, size: 10 };
    for (const line of x.breakdown.explanation) m.addRow(['', line]).font = { name: FONT, size: 9.5, color: { argb: 'FF4A5A72' } };
  }

  // 6) ยังไม่มีคะแนน
  if (d.notScored.length) {
    const ns = sheet(wb, 'ยังไม่มีคะแนน', [['รหัส', 14], ['ชื่อครุภัณฑ์', 34], ...(multi ? [['โรงพยาบาล', 28] as [string, number]] : []), ['เหตุผล', 80]]);
    for (const x of d.notScored) ns.addRow([x.code, x.name, ...(multi ? [x.hospital] : []), x.reason]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
