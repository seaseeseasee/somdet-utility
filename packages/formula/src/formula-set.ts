/** ชุดสูตร (น้ำหนัก ตัวคูณ เกณฑ์) — เวอร์ชันในโปรแกรม (v1.0, v1.1) และสร้างจาก definition ในฐานข้อมูล */
import { isNum } from './util.js';

export interface FormulaSet {
  version: string;
  /** น้ำหนัก 6 ปัจจัย (สมมติฐาน!B4:B9) ผลรวมต้อง = 1 */
  weights: {
    utilization: number;
    clinical: number;
    financial: number;
    reliability: number;
    satisfaction: number;
    strategic: number;
  };
  /** ตัวคูณบทลงโทษ Payback (สมมติฐาน!B10) */
  paybackPenalty: number;
  /**
   * ตัวหารรายได้เฉลี่ยต่อปีของ Payback
   * - excel_age: อายุตามสูตร Excel (v1.0)
   * - min_age_data_years: MIN(อายุตามสูตร Excel, จำนวนปีที่มีข้อมูล) (v1.1, D-16)
   */
  paybackDivisor: 'excel_age' | 'min_age_data_years';
  /** Financial Score เมื่อไม่มีรายได้ตรง (IFERROR(...,50)) — ใช้เฉพาะกรณีระบุว่าไม่มีรายได้ตรง (D-05) */
  noRevenueFinancialScore: number;
  /** ตัวคูณแปลงคะแนน 1–5 เป็น 0–100 */
  ratingMultiplier: number;
  /** เกณฑ์ข้อเสนอแนะ (คอลัมน์ X) */
  thresholds: { high: number; good: number; medium: number };
  /** ธงเตือน D-12: Utilization < x% หรือ Score < y */
  warning: { utilizationBelow: number; scoreBelow: number };
  /**
   * สมมติฐาน!B11 ปีปัจจุบัน (พ.ศ.) — ใช้คิดอายุเครื่องของข้อมูลสะสมที่นำเข้าจาก Excel
   * null/ไม่ระบุ = ปีปัจจุบันตามวันที่ (ข้อมูลรายปีใช้ปีที่วิเคราะห์ที่ผู้ใช้เลือกแทน)
   */
  currentYearBe?: number | null;
}

export const FORMULA_SET_V1: Readonly<FormulaSet> = Object.freeze({
  version: '1.0',
  weights: Object.freeze({
    utilization: 0.25,
    clinical: 0.2,
    financial: 0.2,
    reliability: 0.15,
    satisfaction: 0.1,
    strategic: 0.1,
  }),
  paybackPenalty: 15,
  paybackDivisor: 'excel_age',
  noRevenueFinancialScore: 50,
  ratingMultiplier: 20,
  thresholds: Object.freeze({ high: 80, good: 60, medium: 40 }),
  warning: Object.freeze({ utilizationBelow: 40, scoreBelow: 50 }),
}) as FormulaSet;

/**
 * ชุดสูตร v1.1 (อนุมัติ 2 พ.ย. 2569, D-16): เหมือน v1.0 ทุกประการ ยกเว้นตัวหาร Payback
 * = MIN(อายุตามสูตร Excel, จำนวนปีที่มีข้อมูล) เพื่อไม่ให้เครื่องอายุเกิน 5 ปีได้ Payback สูงเกินจริง
 * เมื่อมีข้อมูลครบทุกปีตั้งแต่ซื้อ ผลเท่ากับ v1.0 (Excel)
 */
export const FORMULA_SET_V1_1: Readonly<FormulaSet> = Object.freeze({
  ...FORMULA_SET_V1,
  version: '1.1',
  paybackDivisor: 'min_age_data_years',
}) as FormulaSet;

export const FORMULA_SETS: Record<string, Readonly<FormulaSet>> = { '1.0': FORMULA_SET_V1, '1.1': FORMULA_SET_V1_1 };

/**
 * สร้างชุดสูตรจาก definition ที่เก็บในฐานข้อมูล (ตาราง formula_set) — ค่าที่ไม่มีใช้ค่าเดิมของ v1.0
 * ทำให้ผู้ดูแลระบบสร้างชุดสูตรเวอร์ชันใหม่ (ปรับน้ำหนัก/ตัวคูณ Payback/ปีปัจจุบัน) ได้โดยไม่ต้องแก้โปรแกรม
 */
export function formulaSetFromDefinition(version: string, def: Record<string, unknown>): FormulaSet {
  const d = def as Partial<FormulaSet>;
  const fs: FormulaSet = {
    ...FORMULA_SET_V1,
    version,
    weights: { ...FORMULA_SET_V1.weights, ...(d.weights ?? {}) },
    paybackPenalty: d.paybackPenalty ?? FORMULA_SET_V1.paybackPenalty,
    paybackDivisor: d.paybackDivisor ?? FORMULA_SET_V1.paybackDivisor,
    noRevenueFinancialScore: d.noRevenueFinancialScore ?? FORMULA_SET_V1.noRevenueFinancialScore,
    ratingMultiplier: d.ratingMultiplier ?? FORMULA_SET_V1.ratingMultiplier,
    thresholds: { ...FORMULA_SET_V1.thresholds, ...(d.thresholds ?? {}) },
    warning: { ...FORMULA_SET_V1.warning, ...(d.warning ?? {}) },
    currentYearBe: d.currentYearBe ?? null,
  };
  const problems = validateFormulaSet(fs);
  if (problems.length) throw new Error(`ชุดสูตร ${version} ไม่ถูกต้อง: ${problems.join('; ')}`);
  return fs;
}

export const WEIGHT_LABEL: Record<keyof FormulaSet['weights'], string> = {
  utilization: 'Utilization', clinical: 'Clinical Outcome', financial: 'Financial', reliability: 'Reliability',
  satisfaction: 'Satisfaction', strategic: 'Strategic Value',
};

/** ค่าที่ปรับได้ของชุดสูตร (ชีต "สมมติฐาน" B4:B11) */
export type FormulaAssumptions = Pick<FormulaSet, 'weights' | 'paybackPenalty' | 'currentYearBe'>;

/** ตรวจน้ำหนัก 6 ด้าน (≥ 0, ผลรวม = 1.00) ตัวคูณ Payback และปีปัจจุบัน — ใช้ทั้งชุดสูตรในระบบและค่าจากไฟล์ Excel */
export function validateAssumptions(a: FormulaAssumptions): string[] {
  const p: string[] = [];
  for (const [k, label] of Object.entries(WEIGHT_LABEL) as [keyof FormulaSet['weights'], string][]) {
    const v = a.weights[k];
    if (!isNum(v)) p.push(`น้ำหนัก ${label}: ไม่มีค่าหรือไม่ใช่ตัวเลข`);
    else if (v < 0) p.push(`น้ำหนัก ${label}: ต้องไม่ติดลบ`);
  }
  const sum = Object.values(a.weights).reduce((s, v) => s + (isNum(v) ? v : 0), 0);
  if (!p.length && Math.abs(sum - 1) > 1e-6) p.push(`ผลรวมน้ำหนัก 6 ด้านต้องเท่ากับ 1.00 (100%) ปัจจุบันรวมได้ ${Number(sum.toFixed(6))}`);
  if (!isNum(a.paybackPenalty) || a.paybackPenalty < 0) p.push('ตัวคูณ Payback ต้องเป็นตัวเลขที่ไม่ติดลบ');
  if (a.currentYearBe != null && (!Number.isInteger(a.currentYearBe) || a.currentYearBe < 2500 || a.currentYearBe > 2700))
    p.push('ปีปัจจุบัน (พ.ศ.) ต้องเป็นจำนวนเต็มระหว่าง 2500–2700');
  return p;
}

export function validateFormulaSet(fs: FormulaSet): string[] {
  const p = validateAssumptions({ weights: fs.weights, paybackPenalty: fs.paybackPenalty, currentYearBe: fs.currentYearBe ?? null });
  if (!(fs.thresholds.high > fs.thresholds.good && fs.thresholds.good > fs.thresholds.medium))
    p.push('เกณฑ์ต้องเรียง high > good > medium');
  return p;
}

/** ปีปัจจุบัน (พ.ศ.) ที่ใช้คิดอายุเครื่องของข้อมูลสะสมจาก Excel: ค่าในชุดสูตร หรือปีปัจจุบันตามวันที่ */
export const currentYearOf = (fs: Pick<FormulaSet, 'currentYearBe'>, now = new Date()) => fs.currentYearBe ?? now.getFullYear() + 543;
