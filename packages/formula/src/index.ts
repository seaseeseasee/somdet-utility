/**
 * ชุดสูตร Utility Score v1.0
 *
 * ที่มา: ชีต "ข้อมูลครุภัณฑ์" ของ Utility_Analysis_ครุภัณฑ์การแพทย์.xlsx (คอลัมน์ E, N–X และชีต "สมมติฐาน")
 * ร่วมกับการตัดสินใจ D-01 ถึง D-15 และ N-06 ใน docs/Phase1-Analysis-Design.md ข้อ 1.10
 *
 * ห้ามแก้สูตร น้ำหนัก หรือเกณฑ์ในไฟล์นี้โดยไม่ได้รับอนุมัติ หากต้องเปลี่ยน ให้สร้างชุดสูตรเวอร์ชันใหม่
 * ทุกฟังก์ชันเป็น Pure Function เพื่อให้ทดสอบเทียบกับค่าใน Excel ได้
 */

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
  /** Financial Score เมื่อไม่มีรายได้ตรง (IFERROR(...,50)) — ใช้เฉพาะกรณีระบุว่าไม่มีรายได้ตรง (D-05) */
  noRevenueFinancialScore: number;
  /** ตัวคูณแปลงคะแนน 1–5 เป็น 0–100 */
  ratingMultiplier: number;
  /** เกณฑ์ข้อเสนอแนะ (คอลัมน์ X) */
  thresholds: { high: number; good: number; medium: number };
  /** ธงเตือน D-12: Utilization < x% หรือ Score < y */
  warning: { utilizationBelow: number; scoreBelow: number };
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
  noRevenueFinancialScore: 50,
  ratingMultiplier: 20,
  thresholds: Object.freeze({ high: 80, good: 60, medium: 40 }),
  warning: Object.freeze({ utilizationBelow: 40, scoreBelow: 50 }),
}) as FormulaSet;

export type RecommendationLevel = 'high' | 'good' | 'medium' | 'low';

export const RECOMMENDATION_TEXT: Record<RecommendationLevel, string> = {
  high: 'ซื้อเพิ่ม/อัปเกรดรุ่นใหม่',
  good: 'คงสภาพ ติดตามต่อเนื่อง',
  medium: 'ทบทวนแผนการใช้งาน/เพิ่ม Utilization',
  low: 'พิจารณาทดแทนหรือไม่จัดซื้อเพิ่ม',
};

/** ข้อมูลแบบสะสม (ตรงกับแถวในชีต Excel) */
export interface CumulativeInput {
  /** C: ปีที่ซื้อ (พ.ศ.) */
  purchaseYear: number;
  /** D: ราคาซื้อ (บาท) */
  purchasePrice: number;
  /** ปีที่วิเคราะห์ (พ.ศ.) แทน สมมติฐาน!B11 (D-11) */
  analysisYear: number;
  /** F: Utilization (%) */
  utilizationPct: number;
  /** G: จำนวนเคสสะสม */
  cases: number;
  /** H: ค่าบำรุงรักษาสะสม (บาท) */
  maintenanceCost: number;
  /** I: Downtime สะสม (%) */
  downtimePct: number;
  /** J: รายได้สะสม (บาท) */
  revenue: number;
  /** ระบุว่าไม่มีรายได้ตรง (D-05) — ต้องเป็น true เมื่อ revenue = 0 จึงจะได้ Financial Score = 50 */
  noDirectRevenue: boolean;
  /** K, L, M: คะแนน 1–5 */
  clinicalRating: number;
  satisfactionRating: number;
  strategicRating: number;
  /** ใช้แทนสูตรอายุ E เฉพาะการคำนวณ Score รายปี */
  ageYearsOverride?: number;
}

export interface FactorScores {
  utilization: number;
  clinical: number;
  financial: number;
  reliability: number;
  satisfaction: number;
  strategic: number;
}

export interface ScoreBreakdown {
  formulaVersion: string;
  /** E: ปีที่ใช้งานแล้ว */
  ageYears: number;
  /** N: ต้นทุนต่อเคส (null = "N/A") */
  costPerCase: number | null;
  /** O: Payback Period (null = "N/A" เพราะไม่มีรายได้ตรง) */
  paybackYears: number | null;
  /** P–U */
  scores: FactorScores;
  /** คะแนน × น้ำหนัก ของแต่ละปัจจัย */
  weighted: FactorScores;
  /** V */
  utilityScore: number;
  /** X */
  recommendation: RecommendationLevel;
  recommendationText: string;
  /** D-12 */
  warning: boolean;
  /** คำอธิบายวิธีคำนวณทีละบรรทัด สำหรับแสดง "ที่มาของคะแนน" */
  explanation: string[];
}

export class IncompleteDataError extends Error {
  constructor(public readonly problems: string[]) {
    super(`ข้อมูลไม่ครบหรือไม่ถูกต้อง: ${problems.join('; ')}`);
    this.name = 'IncompleteDataError';
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** ตรวจความครบถ้วนก่อนคำนวณ (D-05, D-08, D-13) */
export function validateCumulative(i: CumulativeInput): string[] {
  const p: string[] = [];
  const need = (name: string, v: unknown, min?: number, max?: number) => {
    if (!isNum(v)) return p.push(`${name}: ไม่มีค่า`);
    if (min !== undefined && v < min) p.push(`${name}: ต้องไม่น้อยกว่า ${min}`);
    if (max !== undefined && v > max) p.push(`${name}: ต้องไม่เกิน ${max}`);
  };
  need('ปีที่ซื้อ', i.purchaseYear, 2400, 2700);
  need('ปีที่วิเคราะห์', i.analysisYear, 2400, 2700);
  need('ราคาซื้อ', i.purchasePrice, 0.01);
  need('Utilization (%)', i.utilizationPct, 0, 100);
  need('จำนวนเคส', i.cases, 0);
  need('ค่าบำรุงรักษา', i.maintenanceCost, 0);
  need('Downtime (%)', i.downtimePct, 0, 100);
  need('รายได้', i.revenue, 0);
  for (const [n, v] of [
    ['คะแนน Clinical', i.clinicalRating],
    ['คะแนน Satisfaction', i.satisfactionRating],
    ['คะแนน Strategic', i.strategicRating],
  ] as const) {
    need(n, v, 1, 5);
    if (isNum(v) && Math.abs(Math.round(v * 10) - v * 10) > 1e-9)
      p.push(`${n}: ทศนิยมได้ไม่เกิน 1 ตำแหน่ง`);
  }
  if (isNum(i.revenue) && i.revenue === 0 && !i.noDirectRevenue)
    p.push('รายได้ = 0: ต้องระบุว่า "ไม่มีรายได้ตรง" หรือกรอกรายได้');
  if (isNum(i.revenue) && i.revenue > 0 && i.noDirectRevenue)
    p.push('ระบุ "ไม่มีรายได้ตรง" แต่กรอกรายได้มากกว่า 0');
  return p;
}

export function recommendationOf(score: number, fs: FormulaSet = FORMULA_SET_V1): RecommendationLevel {
  if (score >= fs.thresholds.high) return 'high';
  if (score >= fs.thresholds.good) return 'good';
  if (score >= fs.thresholds.medium) return 'medium';
  return 'low';
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** คำนวณ Utility Score จากข้อมูลสะสม — ตรงกับสูตร Excel คอลัมน์ E, N–X */
export function computeScore(input: CumulativeInput, fs: FormulaSet = FORMULA_SET_V1): ScoreBreakdown {
  const problems = validateCumulative(input);
  if (problems.length) throw new IncompleteDataError(problems);
  const w = fs.weights;

  // E = MAX(สมมติฐาน!B11 − C, 1)
  const ageYears = input.ageYearsOverride ?? Math.max(input.analysisYear - input.purchaseYear, 1);
  // N = IFERROR((D + H) / G, "N/A")
  const costPerCase = input.cases > 0 ? (input.purchasePrice + input.maintenanceCost) / input.cases : null;
  // O = IFERROR(D / (J / E), "N/A")
  const paybackYears = input.revenue > 0 ? input.purchasePrice / (input.revenue / ageYears) : null;
  // Q = IFERROR(MIN(100, MAX(0, 100 − O × B10)), 50)
  const financial =
    paybackYears === null
      ? fs.noRevenueFinancialScore
      : Math.min(100, Math.max(0, 100 - paybackYears * fs.paybackPenalty));

  const scores: FactorScores = {
    utilization: input.utilizationPct, // P = F
    clinical: input.clinicalRating * fs.ratingMultiplier, // S = K × 20
    financial,
    reliability: 100 - input.downtimePct, // R = 100 − I
    satisfaction: input.satisfactionRating * fs.ratingMultiplier, // T = L × 20
    strategic: input.strategicRating * fs.ratingMultiplier, // U = M × 20
  };
  // V — ลำดับการบวกตรงกับ Excel: P·B4 + S·B5 + Q·B6 + R·B7 + T·B8 + U·B9
  const weighted: FactorScores = {
    utilization: scores.utilization * w.utilization,
    clinical: scores.clinical * w.clinical,
    financial: scores.financial * w.financial,
    reliability: scores.reliability * w.reliability,
    satisfaction: scores.satisfaction * w.satisfaction,
    strategic: scores.strategic * w.strategic,
  };
  const utilityScore =
    weighted.utilization +
    weighted.clinical +
    weighted.financial +
    weighted.reliability +
    weighted.satisfaction +
    weighted.strategic;

  const recommendation = recommendationOf(utilityScore, fs);
  const warning = input.utilizationPct < fs.warning.utilizationBelow || utilityScore < fs.warning.scoreBelow;

  const explanation = [
    input.ageYearsOverride !== undefined
      ? `อายุใช้งาน = ${ageYears} ปี (Score รายปี)`
      : `อายุใช้งาน = MAX(${input.analysisYear} − ${input.purchaseYear}, 1) = ${ageYears} ปี`,
    costPerCase === null
      ? 'ต้นทุนต่อเคส = N/A (จำนวนเคส = 0)'
      : `ต้นทุนต่อเคส = (${fmt(input.purchasePrice)} + ${fmt(input.maintenanceCost)}) ÷ ${fmt(input.cases, 0)} = ${fmt(costPerCase)} บาท`,
    paybackYears === null
      ? `Payback = N/A (ไม่มีรายได้ตรง) → Financial Score = ${fs.noRevenueFinancialScore}`
      : `Payback = ${fmt(input.purchasePrice)} ÷ (${fmt(input.revenue)} ÷ ${ageYears}) = ${fmt(paybackYears)} ปี → Financial = MIN(100, MAX(0, 100 − ${fmt(paybackYears)} × ${fs.paybackPenalty})) = ${fmt(financial)}`,
    `Utilization Score = ${fmt(scores.utilization)} × ${w.utilization} = ${fmt(weighted.utilization)}`,
    `Clinical Score = ${input.clinicalRating} × ${fs.ratingMultiplier} = ${fmt(scores.clinical)} × ${w.clinical} = ${fmt(weighted.clinical)}`,
    `Financial Score = ${fmt(scores.financial)} × ${w.financial} = ${fmt(weighted.financial)}`,
    `Reliability Score = 100 − ${fmt(input.downtimePct)} = ${fmt(scores.reliability)} × ${w.reliability} = ${fmt(weighted.reliability)}`,
    `Satisfaction Score = ${input.satisfactionRating} × ${fs.ratingMultiplier} = ${fmt(scores.satisfaction)} × ${w.satisfaction} = ${fmt(weighted.satisfaction)}`,
    `Strategic Score = ${input.strategicRating} × ${fs.ratingMultiplier} = ${fmt(scores.strategic)} × ${w.strategic} = ${fmt(weighted.strategic)}`,
    `Utility Score = ${fmt(utilityScore)} → ${RECOMMENDATION_TEXT[recommendation]}`,
  ];

  return {
    formulaVersion: fs.version,
    ageYears,
    costPerCase,
    paybackYears,
    scores,
    weighted,
    utilityScore,
    recommendation,
    recommendationText: RECOMMENDATION_TEXT[recommendation],
    warning,
    explanation,
  };
}

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

/** W: RANK(V, ช่วง, 0) — คะแนนเท่ากันได้อันดับเดียวกัน และข้ามอันดับถัดไป */
export function rankScores(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

export function validateFormulaSet(fs: FormulaSet): string[] {
  const p: string[] = [];
  const sum = Object.values(fs.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) p.push(`ผลรวมน้ำหนักต้องเท่ากับ 1.00 (ปัจจุบัน ${sum})`);
  if (!(fs.thresholds.high > fs.thresholds.good && fs.thresholds.good > fs.thresholds.medium))
    p.push('เกณฑ์ต้องเรียง high > good > medium');
  return p;
}
