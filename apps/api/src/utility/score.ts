import { computeScore, FORMULA_SET_V1, IncompleteDataError, rankScores, type FormulaSet, type ScoreBreakdown } from '@mu/formula';

/**
 * คำนวณ Utility Score ของข้อมูลที่นำเข้าจากไฟล์ Excel — Pure Function
 * ใช้สูตรเดียวกับ packages/formula (คอลัมน์ E, N–X ของไฟล์ต้นแบบ) โดยน้ำหนักและค่าคงที่มาจาก scoring_settings
 */

export interface ScoringSettings {
  /** สมมติฐาน!B4:B9 ผลรวมต้อง = 1.00 */
  weights: { utilization: number; clinical: number; financial: number; reliability: number; satisfaction: number; strategic: number };
  /** สมมติฐาน!B10 */
  paybackPenalty: number;
  /** สมมติฐาน!B11 — null = ปีปัจจุบัน (พ.ศ.) */
  currentYearBe: number | null;
}

export const WEIGHT_LABEL: Record<keyof ScoringSettings['weights'], string> = {
  utilization: 'Utilization', clinical: 'Clinical Outcome', financial: 'Financial', reliability: 'Reliability',
  satisfaction: 'Satisfaction', strategic: 'Strategic Value',
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** ตรวจชุดน้ำหนัก: แต่ละค่า ≥ 0 และผลรวม = 1.00 */
export function settingsProblems(s: ScoringSettings): string[] {
  const p: string[] = [];
  for (const [k, label] of Object.entries(WEIGHT_LABEL) as [keyof ScoringSettings['weights'], string][]) {
    const v = s.weights[k];
    if (!finite(v)) p.push(`น้ำหนัก ${label}: ไม่มีค่าหรือไม่ใช่ตัวเลข`);
    else if (v < 0) p.push(`น้ำหนัก ${label}: ต้องไม่ติดลบ`);
  }
  const sum = Object.values(s.weights).reduce((a, b) => a + (finite(b) ? b : 0), 0);
  if (!p.length && Math.abs(sum - 1) > 1e-6) p.push(`ผลรวมน้ำหนัก 6 ด้านต้องเท่ากับ 1.00 (ในไฟล์รวมได้ ${Number(sum.toFixed(6))})`);
  if (!finite(s.paybackPenalty) || s.paybackPenalty < 0) p.push('ตัวคูณ Payback ต้องเป็นตัวเลขที่ไม่ติดลบ');
  if (s.currentYearBe !== null && (!Number.isInteger(s.currentYearBe) || s.currentYearBe < 2500 || s.currentYearBe > 2700))
    p.push('ปีปัจจุบัน (พ.ศ.) ต้องเป็นจำนวนเต็มระหว่าง 2500–2700');
  return p;
}

export const currentYearOf = (s: ScoringSettings, now = new Date()) => s.currentYearBe ?? now.getFullYear() + 543;

export const formulaSetOf = (s: ScoringSettings): FormulaSet => ({
  ...FORMULA_SET_V1,
  version: 'นำเข้า',
  weights: { ...s.weights },
  paybackPenalty: s.paybackPenalty,
  paybackDivisor: 'excel_age',
});

/** ช่องที่กรอกในไฟล์ (B–D, F–M) */
export interface UtilityInput {
  purchaseYearBe: number | null;
  purchasePrice: number | null;
  utilizationPct: number | null;
  totalCases: number | null;
  maintenanceCostTotal: number | null;
  downtimePct: number | null;
  revenueTotal: number | null;
  clinicalRating: number | null;
  satisfactionRating: number | null;
  strategicRating: number | null;
}

/** ช่องจำเป็น (C, D, F, I, K, L, M) — ขาดช่องใด = ข้อมูลไม่ครบ ไม่คำนวณคะแนน */
export const REQUIRED_FIELDS: [keyof UtilityInput, string][] = [
  ['purchaseYearBe', 'ปีที่ซื้อ'],
  ['purchasePrice', 'ราคาซื้อ'],
  ['utilizationPct', 'Utilization (%)'],
  ['downtimePct', 'Downtime (%)'],
  ['clinicalRating', 'คะแนนผลลัพธ์ทางคลินิก'],
  ['satisfactionRating', 'คะแนนความพึงพอใจ'],
  ['strategicRating', 'คะแนนมูลค่าเชิงกลยุทธ์'],
];

export const missingFields = (r: UtilityInput) => REQUIRED_FIELDS.filter(([k]) => r[k] === null).map(([, l]) => l);

/**
 * คำนวณคะแนน 1 แถว (ต้องมีช่องจำเป็นครบ)
 * เคส/ค่าบำรุงรักษาว่าง = 0, รายได้ว่างหรือ 0 = ไม่มีข้อมูลรายได้ → Financial Score = 50
 */
export function scoreUtility(r: UtilityInput, s: ScoringSettings, now = new Date()): ScoreBreakdown {
  const missing = missingFields(r);
  if (missing.length) throw new IncompleteDataError(missing.map((m) => `${m}: ไม่มีค่า`));
  const revenue = r.revenueTotal ?? 0;
  return computeScore(
    {
      purchaseYear: r.purchaseYearBe!,
      purchasePrice: r.purchasePrice!,
      analysisYear: currentYearOf(s, now),
      utilizationPct: r.utilizationPct!,
      cases: r.totalCases ?? 0,
      maintenanceCost: r.maintenanceCostTotal ?? 0,
      downtimePct: r.downtimePct!,
      revenue,
      noDirectRevenue: revenue === 0,
      clinicalRating: r.clinicalRating!,
      satisfactionRating: r.satisfactionRating!,
      strategicRating: r.strategicRating!,
    },
    formulaSetOf(s),
  );
}

export interface ScoredRow<T> {
  row: T;
  score: ScoreBreakdown | null;
  /** อันดับแบบ competition ranking (คะแนนเท่ากันได้อันดับเดียวกัน แล้วข้ามอันดับ เช่น 5,5,5,8) — เฉพาะแถวที่มีคะแนน */
  rank: number | null;
  /** เหตุที่ไม่มีคะแนน */
  problems: string[];
}

/** คำนวณคะแนนทุกแถวของ dataset เดียวกันและจัดอันดับ */
export function scoreDataset<T extends UtilityInput>(rows: T[], s: ScoringSettings, now = new Date()): ScoredRow<T>[] {
  const out: ScoredRow<T>[] = rows.map((row) => {
    try {
      return { row, score: scoreUtility(row, s, now), rank: null, problems: [] };
    } catch (e) {
      if (e instanceof IncompleteDataError) return { row, score: null, rank: null, problems: e.problems };
      throw e;
    }
  });
  const scored = out.filter((x) => x.score);
  // ปัดเศษ floating point ก่อนเทียบ เพื่อให้คะแนนที่เท่ากันจริงได้อันดับเดียวกัน
  const ranks = rankScores(scored.map((x) => Math.round(x.score!.utilityScore * 1e9) / 1e9));
  scored.forEach((x, i) => (x.rank = ranks[i]!));
  return out;
}
