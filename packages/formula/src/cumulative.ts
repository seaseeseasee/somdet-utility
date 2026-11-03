/** Utility Score จากข้อมูลสะสม — ตรงกับสูตร Excel คอลัมน์ E, N–X และอันดับ (W) */
import { FORMULA_SET_V1, type FormulaSet } from './formula-set.js';
import { fmt, isNum } from './util.js';

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
  /** จำนวนปีงบที่มีข้อมูลซึ่งรวมเป็นค่าสะสม (ใช้กับชุดสูตร v1.1) */
  dataYears?: number;
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
  /** ตัวหารรายได้ที่ใช้คำนวณ Payback จริง */
  paybackDivisorYears: number;
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
  const divisor =
    fs.paybackDivisor === 'min_age_data_years' && input.dataYears && input.dataYears > 0
      ? Math.min(ageYears, input.dataYears)
      : ageYears;
  const paybackYears = input.revenue > 0 ? input.purchasePrice / (input.revenue / divisor) : null;
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
      : `Payback = ${fmt(input.purchasePrice)} ÷ (${fmt(input.revenue)} ÷ ${divisor}${divisor !== ageYears ? ` [MIN(อายุ ${ageYears}, ข้อมูล ${input.dataYears} ปี)]` : ''}) = ${fmt(paybackYears)} ปี → Financial = MIN(100, MAX(0, 100 − ${fmt(paybackYears)} × ${fs.paybackPenalty})) = ${fmt(financial)}`,
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
    paybackDivisorYears: divisor,
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

/** W: RANK(V, ช่วง, 0) — คะแนนเท่ากันได้อันดับเดียวกัน และข้ามอันดับถัดไป */
export function rankScores(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}
