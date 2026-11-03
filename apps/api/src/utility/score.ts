import { computeScore, currentYearOf, IncompleteDataError, rankScores, validateAssumptions, type FormulaAssumptions, type FormulaSet, type ScoreBreakdown } from '@mu/formula';

/**
 * คำนวณ Utility Score ของข้อมูลที่นำเข้าจากไฟล์ Excel — Pure Function
 * ใช้ชุดสูตรเดียวกับทั้งระบบ (packages/formula: คอลัมน์ E, N–X ของไฟล์ต้นแบบ) อายุเครื่องคิดจากปีปัจจุบันของชุดสูตร
 */

/** ค่าในชีต "สมมติฐาน" ของไฟล์ (B4:B9 น้ำหนัก, B10 ตัวคูณ Payback, B11 ปีปัจจุบัน) */
export type ScoringSettings = FormulaAssumptions;

/** ตรวจค่าในชีต "สมมติฐาน" ด้วยกฎเดียวกับชุดสูตรของระบบ */
export const settingsProblems = (s: ScoringSettings) => validateAssumptions(s);

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
export function scoreUtility(r: UtilityInput, fs: FormulaSet, now = new Date()): ScoreBreakdown {
  const missing = missingFields(r);
  if (missing.length) throw new IncompleteDataError(missing.map((m) => `${m}: ไม่มีค่า`));
  const revenue = r.revenueTotal ?? 0;
  return computeScore(
    {
      purchaseYear: r.purchaseYearBe!,
      purchasePrice: r.purchasePrice!,
      analysisYear: currentYearOf(fs, now),
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
    fs,
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
export function scoreDataset<T extends UtilityInput>(rows: T[], fs: FormulaSet, now = new Date()): ScoredRow<T>[] {
  const out: ScoredRow<T>[] = rows.map((row) => {
    try {
      return { row, score: scoreUtility(row, fs, now), rank: null, problems: [] };
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
