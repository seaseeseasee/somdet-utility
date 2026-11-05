/** ฟิลด์ของแบบฟอร์มข้อมูลรายปี และการแปลงค่าระหว่างฟอร์ม ↔ API */

export type Form = Record<string, string | boolean>;
export type NumField = [key: string, label: string, unit: string, req?: boolean, hint?: string];

export const USAGE: NumField[] = [
  ['availableDays', 'จำนวนวันพร้อมใช้งาน', 'วัน/ปี', true],
  ['actualDays', 'จำนวนวันใช้งานจริง', 'วัน/ปี', true],
  ['maxAvailableHours', 'ชั่วโมงพร้อมใช้งานสูงสุด', 'ชม./ปี', true, 'เช่น 10 ชม. × 245 วัน = 2,450'],
  ['actualHours', 'ชั่วโมงใช้งานจริง', 'ชม./ปี', true, 'จาก PACS/RIS/LIS หรือบันทึกในเครื่อง'],
  ['useCount', 'จำนวนครั้งใช้งาน', 'ครั้ง/ปี', true],
  ['caseCount', 'จำนวนเคส/ผู้ป่วย', 'ราย/ปี', true, 'จำนวนเท่านั้น ห้ามบันทึกข้อมูลระบุตัวผู้ป่วย'],
];
export const MONEY: NumField[] = [
  ['repairCost', 'ค่าซ่อม', 'บาท', true], ['partsCost', 'ค่าอะไหล่', 'บาท', true], ['pmCost', 'ค่า PM', 'บาท', true],
  ['calibrationCost', 'ค่าสอบเทียบ/ทดสอบ', 'บาท', true], ['otherCost', 'ค่าใช้จ่ายอื่น', 'บาท'],
];
export const RELIABILITY: NumField[] = [
  ['repairDays', 'จำนวนวันหยุดซ่อม', 'วัน/ปี', true], ['breakdownCount', 'จำนวนครั้งที่เสีย', 'ครั้ง/ปี', true],
  ['downtimeHours', 'ชั่วโมง Downtime', 'ชม./ปี', true, 'ชั่วโมงที่เครื่องเสีย หยุด หรือส่งซ่อม'],
];
export const RATINGS: [string, string, string][] = [
  ['clinicalRating', 'Clinical Outcome (1–5)', 'ผลลัพธ์ก่อน–หลังมีเครื่อง เช่น ความแม่นยำ, TAT'],
  ['satisfactionRating', 'Satisfaction (1–5)', 'จากแบบสอบถามผู้ใช้/ผู้ป่วย'],
  ['strategicRating', 'Strategic Value (1–5)', 'การรองรับ Service Plan/นโยบาย'],
];
/** ชื่อช่องภาษาไทย ใช้นำหน้าข้อผิดพลาดที่ API ส่งกลับ */
export const LABEL: Record<string, string> = Object.fromEntries([
  ...[...USAGE, ...MONEY, ...RELIABILITY, ...RATINGS].map((f) => [f[0], f[1]]),
  ['revenue', 'รายได้จากการให้บริการ'], ['cost', 'ค่าใช้จ่ายรายการบำรุงรักษา'],
]);
const NUMERIC = [...USAGE, ...MONEY, ['revenue'], ...RELIABILITY, ...RATINGS].map((f) => f[0] as string);
const TEXT = ['ratingRationale', 'clinicalNecessity', 'condition', 'inspectedAt', 'inspectionNote', 'safetyDetail', 'recallStatus', 'unitRecommendation', 'rationale', 'changeReason'];
export const UNIT_REC: Record<string, string> = { continue: 'ใช้ต่อ', increase_use: 'เพิ่มการใช้ประโยชน์', repair: 'ซ่อม', reallocate: 'ย้ายจัดสรร', replace: 'ทดแทน', decommission: 'จำหน่าย (Decommission)' };
export const KIND: Record<string, string> = { repair: 'ซ่อม', pm: 'PM', calibration: 'สอบเทียบ', other: 'อื่น ๆ' };
export const ACTION: Record<string, string> = { submit: 'ส่งตรวจสอบ', approve: 'ยืนยันข้อมูล', reject: 'ตีกลับ', unlock: 'ปลดล็อกเพื่อแก้ไข', lock: 'ล็อก (ปิดรอบ)' };
export const TONE: Record<string, string> = { draft: 'b', submitted: 'w', approved: 'g', locked: 'n' };

export const toForm = (d: Record<string, unknown> | null): Form => {
  const f: Form = { noDirectRevenue: false, safetyEvent: '' };
  for (const k of [...NUMERIC, ...TEXT]) f[k] = d?.[k] === null || d?.[k] === undefined ? '' : String(d[k]);
  if (d) {
    f.noDirectRevenue = Boolean(d.noDirectRevenue);
    f.safetyEvent = d.safetyEvent === null || d.safetyEvent === undefined ? '' : d.safetyEvent ? 'yes' : 'no';
  }
  if (!d) f.otherCost = '0';
  return f;
};
export const toBody = (f: Form, version?: number) => {
  const b: Record<string, unknown> = { version };
  for (const k of NUMERIC) b[k] = f[k] === '' ? null : Number(String(f[k]).replace(/,/g, ''));
  for (const k of TEXT) b[k] = f[k] === '' ? null : f[k];
  b.noDirectRevenue = Boolean(f.noDirectRevenue);
  b.safetyEvent = f.safetyEvent === '' ? null : f.safetyEvent === 'yes';
  return b;
};
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);
