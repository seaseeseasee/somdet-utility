/** ข้อมูลรายปี: ตัวชี้วัด การตรวจความถูกต้อง การรวมหลายปี (D-02) และ Score รายปี */
import { computeScore, IncompleteDataError, type CumulativeInput, type ScoreBreakdown } from './cumulative.js';
import { FORMULA_SET_V1, type FormulaSet } from './formula-set.js';
import { isNum } from './util.js';

/** ข้อมูลรายปี (1 ปีงบประมาณ) ที่ยืนยันแล้ว */
export interface AnnualInput {
  fiscalYear: number;
  availableDays: number;
  actualDays: number;
  maxAvailableHours: number;
  actualHours: number;
  useCount: number;
  caseCount: number;
  repairCost: number;
  partsCost: number;
  pmCost: number;
  calibrationCost: number;
  otherCost: number;
  revenue: number;
  noDirectRevenue: boolean;
  repairDays: number;
  breakdownCount: number;
  downtimeHours: number;
  clinicalRating: number;
  satisfactionRating: number;
  strategicRating: number;
}

/** D-03: Maintenance Cost = ซ่อม + อะไหล่ + PM + สอบเทียบ + อื่น ๆ */
export const maintenanceCostOf = (a: Pick<AnnualInput, 'repairCost' | 'partsCost' | 'pmCost' | 'calibrationCost' | 'otherCost'>) =>
  a.repairCost + a.partsCost + a.pmCost + a.calibrationCost + a.otherCost;

/** ตัวชี้วัดรายปีที่แสดงประกอบ (ไม่เข้าสูตร Score โดยตรง) */
export function annualMetrics(a: AnnualInput, purchasePrice?: number, usefulLifeYears?: number) {
  const maintenance = maintenanceCostOf(a);
  return {
    maintenanceCost: maintenance,
    /** D-01: ค่าหลัก */
    utilizationPctHours: a.maxAvailableHours > 0 ? (a.actualHours / a.maxAvailableHours) * 100 : null,
    /** D-01: แสดงประกอบ */
    utilizationPctDays: a.availableDays > 0 ? (a.actualDays / a.availableDays) * 100 : null,
    /** Form Questions #26 */
    availabilityPct: a.availableDays > 0 ? ((a.availableDays - a.repairDays) / a.availableDays) * 100 : null,
    /** D-06 */
    downtimePct: a.maxAvailableHours > 0 ? (a.downtimeHours / a.maxAvailableHours) * 100 : null,
    /** D-04: Cost per Use รายปี (เมื่อมีอายุตามเกณฑ์) */
    costPerUse:
      purchasePrice !== undefined && usefulLifeYears && usefulLifeYears > 0 && a.useCount > 0
        ? (purchasePrice / usefulLifeYears + maintenance) / a.useCount
        : null,
  };
}

/** ตรวจข้อมูลรายปีก่อนส่งตรวจ — คืน errors (ห้ามส่ง) และ warnings (ต้องระบุเหตุผล) */
export function validateAnnual(a: Partial<AnnualInput>, previous?: Partial<AnnualInput>) {
  const errors: { field: string; message: string }[] = [];
  const warnings: { field: string; message: string }[] = [];
  const num = (f: keyof AnnualInput, label: string, min = 0, max?: number) => {
    const v = a[f];
    if (!isNum(v)) return errors.push({ field: f, message: `${label}: กรุณากรอก` });
    if (v < min) errors.push({ field: f, message: `${label}: ต้องไม่น้อยกว่า ${min}` });
    if (max !== undefined && v > max) errors.push({ field: f, message: `${label}: ต้องไม่เกิน ${max}` });
  };
  num('availableDays', 'จำนวนวันพร้อมใช้งาน', 0, 366);
  num('actualDays', 'จำนวนวันใช้งานจริง', 0, 366);
  num('maxAvailableHours', 'ชั่วโมงพร้อมใช้งานสูงสุด', 0, 8784);
  num('actualHours', 'ชั่วโมงใช้งานจริง', 0, 8784);
  num('useCount', 'จำนวนครั้งใช้งาน');
  num('caseCount', 'จำนวนเคส/ผู้ป่วย');
  for (const [f, l] of [
    ['repairCost', 'ค่าซ่อม'],
    ['partsCost', 'ค่าอะไหล่'],
    ['pmCost', 'ค่า PM'],
    ['calibrationCost', 'ค่าสอบเทียบ'],
    ['otherCost', 'ค่าใช้จ่ายอื่น'],
    ['revenue', 'รายได้'],
  ] as const)
    num(f, l);
  num('repairDays', 'จำนวนวันหยุดซ่อม', 0, 366);
  num('breakdownCount', 'จำนวนครั้งที่เสีย');
  num('downtimeHours', 'ชั่วโมง Downtime', 0, 8784);
  num('clinicalRating', 'Clinical Outcome', 1, 5);
  num('satisfactionRating', 'Satisfaction', 1, 5);
  num('strategicRating', 'Strategic Value', 1, 5);

  const gt = (x: keyof AnnualInput, y: keyof AnnualInput, msg: string) => {
    const vx = a[x], vy = a[y];
    if (isNum(vx) && isNum(vy) && vx > vy) errors.push({ field: x, message: msg });
  };
  gt('actualDays', 'availableDays', 'วันใช้งานจริงต้องไม่เกินวันพร้อมใช้งาน');
  gt('actualHours', 'maxAvailableHours', 'ชั่วโมงใช้งานจริงต้องไม่เกินชั่วโมงพร้อมใช้งาน');
  gt('downtimeHours', 'maxAvailableHours', 'ชั่วโมง Downtime ต้องไม่เกินชั่วโมงพร้อมใช้งาน');
  gt('repairDays', 'availableDays', 'วันหยุดซ่อมต้องไม่เกินวันพร้อมใช้งาน');
  if (isNum(a.revenue) && a.revenue === 0 && !a.noDirectRevenue)
    errors.push({ field: 'revenue', message: 'รายได้ = 0: กรุณาเลือก "ไม่มีรายได้ตรง" หรือกรอกรายได้' });
  if (isNum(a.revenue) && a.revenue > 0 && a.noDirectRevenue)
    errors.push({ field: 'revenue', message: 'เลือก "ไม่มีรายได้ตรง" แต่กรอกรายได้มากกว่า 0' });

  if (previous && isNum(a.actualHours) && isNum(a.maxAvailableHours) && a.maxAvailableHours > 0) {
    const p = previous;
    if (isNum(p.actualHours) && isNum(p.maxAvailableHours) && p.maxAvailableHours > 0) {
      const now = (a.actualHours / a.maxAvailableHours) * 100;
      const prev = (p.actualHours / p.maxAvailableHours) * 100;
      if (Math.abs(now - prev) >= 30)
        warnings.push({
          field: 'actualHours',
          message: `Utilization เปลี่ยนจากปีก่อน ${prev.toFixed(1)}% → ${now.toFixed(1)}% กรุณาระบุเหตุผล`,
        });
    }
    const m = (x: Partial<AnnualInput>) =>
      [x.repairCost, x.partsCost, x.pmCost, x.calibrationCost, x.otherCost].every(isNum)
        ? maintenanceCostOf(x as AnnualInput)
        : null;
    const mNow = m(a), mPrev = m(p);
    if (mNow !== null && mPrev !== null && mPrev > 0 && Math.abs(mNow - mPrev) / mPrev >= 0.3)
      warnings.push({ field: 'repairCost', message: 'ค่าบำรุงรักษาเปลี่ยนจากปีก่อนตั้งแต่ 30% ขึ้นไป กรุณาระบุเหตุผล' });
  }
  return { errors, warnings };
}

/**
 * D-02: รวมข้อมูลรายปีที่ยืนยันแล้วเป็นข้อมูลสะสม แล้วใช้สูตร Excel
 * - เคส ค่าบำรุงรักษา รายได้ = ผลรวม
 * - Utilization = Σชม.ใช้จริง ÷ Σชม.พร้อมใช้ × 100, Downtime = Σชม.หยุด ÷ Σชม.พร้อมใช้ × 100
 * - คะแนน 1–5 = ของปีล่าสุด (N-06)
 * - ไม่มีรายได้ตรง = รายได้รวม 0 และทุกปีเลือก "ไม่มีรายได้ตรง"
 */
export function aggregateYears(
  years: AnnualInput[],
  equipment: { purchaseYear: number; purchasePrice: number },
  analysisYear: number,
): CumulativeInput {
  if (!years.length) throw new IncompleteDataError(['ยังไม่มีข้อมูลรายปีที่ยืนยันแล้ว']);
  const ys = [...years].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const sum = (f: (y: AnnualInput) => number) => ys.reduce((s, y) => s + f(y), 0);
  const avail = sum((y) => y.maxAvailableHours);
  if (avail <= 0) throw new IncompleteDataError(['ชั่วโมงพร้อมใช้งานรวมเป็น 0']);
  const latest = ys[ys.length - 1]!;
  const revenue = sum((y) => y.revenue);
  return {
    purchaseYear: equipment.purchaseYear,
    purchasePrice: equipment.purchasePrice,
    analysisYear,
    utilizationPct: (sum((y) => y.actualHours) / avail) * 100,
    cases: sum((y) => y.caseCount),
    maintenanceCost: sum(maintenanceCostOf),
    downtimePct: (sum((y) => y.downtimeHours) / avail) * 100,
    revenue,
    noDirectRevenue: revenue === 0 && ys.every((y) => y.noDirectRevenue),
    clinicalRating: latest.clinicalRating,
    satisfactionRating: latest.satisfactionRating,
    strategicRating: latest.strategicRating,
    dataYears: ys.length,
  };
}

/** D-02 (2): Score รายปี — ใช้ข้อมูลปีเดียว และถือว่าอายุ = 1 ปี (Payback = ราคาซื้อ ÷ รายได้ปีนั้น) เพื่อดูแนวโน้ม */
export function computeAnnualScore(
  y: AnnualInput,
  equipment: { purchaseYear: number; purchasePrice: number },
  fs: FormulaSet = FORMULA_SET_V1,
): ScoreBreakdown {
  return computeScore({ ...aggregateYears([y], equipment, y.fiscalYear), ageYearsOverride: 1 }, fs);
}
