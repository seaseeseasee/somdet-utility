import {
  aggregateYears,
  annualMetrics,
  computeAnnualScore,
  computeScore,
  FORMULA_SETS,
  IncompleteDataError,
  rankScores,
  type AnnualInput,
  type FormulaSet,
  type ScoreBreakdown,
} from '@mu/formula';
import { rowToBody } from './annual.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { currentYearOf, formulaSetOf } from './utility/score.js';
import { activeSettings } from './utility/settings.js';

/** ช่วงวิเคราะห์ย้อนหลัง (ปีงบ) */
export const WINDOW_YEARS = 5;

export async function currentFormulaSet(db: Db): Promise<{ id: string; version: string; fs: FormulaSet }> {
  const r = (await db.query("SELECT id, version FROM formula_set WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 1")).rows[0];
  if (!r) throw new HttpError(500, 'ยังไม่มีชุดสูตรที่อนุมัติ');
  const fs = FORMULA_SETS[r.version];
  if (!fs) throw new HttpError(500, `ชุดสูตร ${r.version} ยังไม่มีในโปรแกรมคำนวณ`);
  return { id: r.id, version: r.version, fs };
}

export function toAnnualInput(row: Record<string, unknown>): AnnualInput {
  const b = rowToBody(row) as unknown as Record<string, unknown>;
  return { ...(b as unknown as AnnualInput), fiscalYear: row.fiscal_year_be as number, otherCost: (b.otherCost as number) ?? 0 };
}

export interface EquipmentLite {
  id: string; hospital_id: string; hospital_name?: string; code: string; name: string; department_name?: string; type_name?: string;
  purchase_year_be: number; purchase_price: number; useful_life_years: number | null; status: string;
}

export type ScoreOutcome =
  | {
      status: 'scored'; breakdown: ScoreBreakdown; inputs: ReturnType<typeof aggregateYears>; years: number[];
      /** annual = ข้อมูลรายปีที่ยืนยันแล้ว, excel = ข้อมูลสะสมจากไฟล์ Excel ที่นำเข้า (ใช้จนกว่าจะมีข้อมูลรายปี) */
      source: 'annual' | 'excel';
      imported?: { filename: string; uploadedAt: string; sheet: string; sourceRow: number };
    }
  | { status: 'no_data' | 'incomplete'; problems: string[]; years: number[] };

/** D-02 + D-08: ใช้เฉพาะข้อมูลที่ยืนยัน/ล็อกแล้ว ในช่วง 5 ปีงบสิ้นสุดที่ปีวิเคราะห์ */
export function scoreFromRecords(e: EquipmentLite, rows: Record<string, unknown>[], year: number, fs: FormulaSet): ScoreOutcome {
  const used = rows
    .filter((r) => ['approved', 'locked'].includes(r.status as string))
    .filter((r) => (r.fiscal_year_be as number) <= year && (r.fiscal_year_be as number) > year - WINDOW_YEARS)
    .sort((a, b) => (a.fiscal_year_be as number) - (b.fiscal_year_be as number));
  const years = used.map((r) => r.fiscal_year_be as number);
  if (!used.length) return { status: 'no_data', problems: [`ยังไม่มีข้อมูลที่ยืนยันแล้วในปีงบ ${year - WINDOW_YEARS + 1}–${year}`], years };
  try {
    const inputs = aggregateYears(used.map(toAnnualInput), { purchaseYear: e.purchase_year_be, purchasePrice: e.purchase_price }, year);
    return { status: 'scored', breakdown: computeScore(inputs, fs), inputs, years, source: 'annual' };
  } catch (err) {
    if (err instanceof IncompleteDataError) return { status: 'incomplete', problems: err.problems, years };
    throw err;
  }
}

/** ตัวชี้วัดและ Score รายปี (ดูแนวโน้ม) */
export function annualSeries(e: EquipmentLite, rows: Record<string, unknown>[], fs: FormulaSet) {
  return rows
    .slice()
    .sort((a, b) => (a.fiscal_year_be as number) - (b.fiscal_year_be as number))
    .map((r) => {
      const y = toAnnualInput(r);
      const confirmed = ['approved', 'locked'].includes(r.status as string);
      let score: number | null = null;
      if (confirmed)
        try {
          score = computeAnnualScore(y, { purchaseYear: e.purchase_year_be, purchasePrice: e.purchase_price }, fs).utilityScore;
        } catch {
          score = null;
        }
      const complete = [y.maxAvailableHours, y.actualHours, y.downtimeHours, y.repairCost, y.partsCost, y.pmCost, y.calibrationCost].every((v) => v !== null && v !== undefined);
      return {
        fiscalYear: y.fiscalYear,
        status: r.status as string,
        confirmed,
        metrics: complete ? annualMetrics(y, e.purchase_price, e.useful_life_years ?? undefined) : null,
        revenue: y.revenue ?? null,
        caseCount: y.caseCount ?? null,
        annualScore: score,
      };
    });
}

export const EQ_SELECT = `SELECT e.id, e.hospital_id, h.name AS hospital_name, e.code, e.name, d.name AS department_name, t.name AS type_name,
    e.purchase_year_be, e.purchase_price, e.useful_life_years, e.status, e.department_id, e.type_id
  FROM equipment e JOIN hospital h ON h.id = e.hospital_id JOIN department d ON d.id = e.department_id JOIN equipment_type t ON t.id = e.type_id`;

/**
 * ครุภัณฑ์ที่ยังไม่มีข้อมูลรายปีที่ยืนยันแล้ว แต่มีข้อมูลสะสมจากไฟล์ Excel (ข้อมูลครบ) → ใช้คะแนนจากไฟล์
 * คำนวณด้วยชุดน้ำหนักของข้อมูลนำเข้า (scoring_settings) เหมือนหน้าผลนำเข้า
 */
async function applyImported(db: Db, rows: { equipment: EquipmentLite; outcome: ScoreOutcome }[]) {
  const ids = rows.filter((r) => r.outcome.status === 'no_data').map((r) => r.equipment.id);
  if (!ids.length) return;
  const imported = (
    await db.query(
      `SELECT DISTINCT ON (r.equipment_id) r.*, b.filename, b.uploaded_at FROM utility_record r JOIN utility_import_batch b ON b.id = r.batch_id
        WHERE r.equipment_id = ANY($1) AND r.deleted_at IS NULL AND r.data_status = 'complete'
        ORDER BY r.equipment_id, b.uploaded_at DESC`,
      [ids],
    )
  ).rows;
  if (!imported.length) return;
  const settings = await activeSettings(db);
  const fs = formulaSetOf(settings);
  const year = currentYearOf(settings);
  for (const row of rows) {
    const x = imported.find((i) => i.equipment_id === row.equipment.id);
    if (!x) continue;
    const input = {
      purchaseYear: x.purchase_year_be, purchasePrice: x.purchase_price, analysisYear: year, utilizationPct: x.utilization_pct,
      cases: x.total_cases ?? 0, maintenanceCost: x.maintenance_cost_total ?? 0, downtimePct: x.downtime_pct, revenue: x.revenue_total ?? 0,
      noDirectRevenue: !(x.revenue_total > 0), clinicalRating: x.clinical_rating, satisfactionRating: x.satisfaction_rating, strategicRating: x.strategic_rating,
    };
    try {
      const breakdown = computeScore(input, fs);
      breakdown.explanation.unshift(`ข้อมูลสะสมจากไฟล์ Excel "${x.filename}" ชีต "${x.source_sheet}" แถว ${x.source_row} (ใช้จนกว่าจะมีข้อมูลรายปีที่ยืนยันแล้ว)`);
      row.outcome = {
        status: 'scored', breakdown, inputs: input as ReturnType<typeof aggregateYears>, years: [], source: 'excel',
        imported: { filename: x.filename, uploadedAt: x.uploaded_at, sheet: x.source_sheet, sourceRow: x.source_row },
      };
    } catch (err) {
      if (!(err instanceof IncompleteDataError)) throw err;
    }
  }
}

/** คำนวณทุกครุภัณฑ์ที่มองเห็น (RLS) และจัดอันดับภายในแต่ละโรงพยาบาล (W: RANK) */
export async function scoreAll(db: Db, year: number, fs: FormulaSet, f: { hospitalId?: string; departmentId?: string; equipmentIds?: string[] } = {}) {
  const eq = (
    await db.query(
      `${EQ_SELECT} WHERE e.status <> 'disposed' AND e.purchase_year_be <= $1
         AND ($2::uuid IS NULL OR e.hospital_id = $2) AND ($3::uuid IS NULL OR e.department_id = $3)
         AND ($4::uuid[] IS NULL OR e.id = ANY($4)) ORDER BY h.name, e.code`,
      [year, f.hospitalId ?? null, f.departmentId ?? null, f.equipmentIds ?? null],
    )
  ).rows as EquipmentLite[];
  const recs = eq.length
    ? (await db.query('SELECT * FROM annual_record WHERE equipment_id = ANY($1) AND fiscal_year_be BETWEEN $2 AND $3', [eq.map((e) => e.id), year - WINDOW_YEARS + 1, year])).rows
    : [];
  const rows = eq.map((e) => ({ equipment: e, outcome: scoreFromRecords(e, recs.filter((r) => r.equipment_id === e.id), year, fs) }));
  await applyImported(db, rows);
  const byHospital = new Map<string, typeof rows>();
  for (const r of rows) if (r.outcome.status === 'scored') byHospital.set(r.equipment.hospital_id, [...(byHospital.get(r.equipment.hospital_id) ?? []), r]);
  const rank = new Map<string, number>();
  for (const list of byHospital.values()) {
    const ranks = rankScores(list.map((r) => (r.outcome as { breakdown: ScoreBreakdown }).breakdown.utilityScore));
    list.forEach((r, i) => rank.set(r.equipment.id, ranks[i]!));
  }
  return rows.map((r) => ({ ...r, rank: rank.get(r.equipment.id) ?? null }));
}
