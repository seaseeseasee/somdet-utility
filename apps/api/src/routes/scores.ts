import type { FastifyInstance } from 'fastify';
import { ADVICE_DISCLAIMER, assessValue, RECOMMENDATION_TEXT, UTILIZATION_LEVELS, type UtilizationAdvice, type ValueAssessment } from '@mu/formula';
import { z } from 'zod';
import { fiscalYearOf } from '../annual.js';
import { requirePerm } from '../auth.js';
import { withTx } from '../db.js';
import { HttpError } from '../errors.js';
import { annualSeries, currentFormulaSet, EQ_SELECT, scoreAll, scoreFromRecords, utilizationFor, WINDOW_YEARS, type EquipmentLite, type ScoreOutcome } from '../scoring.js';
import type { AppDeps } from '../app.js';

const Year = z.coerce.number().int().min(2500).max(2700);
const defaultYear = () => fiscalYearOf(new Date()) - 1;

interface ScoreRow {
  equipment: Record<string, unknown>; status: string; dataYears: number[]; rank: number | null;
  utilityScore?: number; scores?: unknown; paybackYears?: number | null; costPerCase?: number | null;
  recommendation?: string; recommendationText?: string; warning?: boolean; utilizationPct?: number; problems?: string[];
  source?: 'annual' | 'excel'; utilization?: UtilizationAdvice | null; assessment?: ValueAssessment;
}

export async function scoreRoutes(app: FastifyInstance, { pool }: AppDeps) {
  /** ผลวิเคราะห์ Utility Score ของทุกครุภัณฑ์ที่มองเห็น ณ ปีวิเคราะห์ */
  app.get('/api/scores', async (req) => {
    const u = requirePerm(req, 'dashboard.view');
    const q = z
      .object({ year: Year.optional(), hospitalId: z.string().uuid().optional(), departmentId: z.string().uuid().optional() })
      .parse(req.query);
    const year = q.year ?? defaultYear();
    return withTx(pool, u.scope, async (db) => {
      const f = await currentFormulaSet(db);
      const rows = await scoreAll(db, year, f.fs, { hospitalId: q.hospitalId, departmentId: q.departmentId });
      const out: ScoreRow[] = rows.map(({ equipment: e, outcome: o, rank }) => ({
        equipment: { id: e.id, code: e.code, name: e.name, hospitalId: e.hospital_id, hospitalName: e.hospital_name, department: e.department_name, type: e.type_name, purchaseYear: e.purchase_year_be, purchasePrice: e.purchase_price, status: e.status },
        status: o.status,
        dataYears: o.years,
        rank,
        ...(o.status === 'scored'
          ? {
              utilityScore: o.breakdown.utilityScore, scores: o.breakdown.scores, paybackYears: o.breakdown.paybackYears,
              costPerCase: o.breakdown.costPerCase, recommendation: o.breakdown.recommendation, recommendationText: o.breakdown.recommendationText,
              warning: o.breakdown.warning, utilizationPct: o.inputs.utilizationPct, source: o.source,
              utilization: utilizationFor(e, o.inputs.utilizationPct),
              assessment: assessValue(o.breakdown, { usefulLifeYears: e.useful_life_years }),
            }
          : { problems: o.problems }),
      }));
      const scored = out.filter((r) => r.status === 'scored');
      const count = (lvl: string) => scored.filter((r) => r.recommendation === lvl).length;
      return {
        year,
        window: { from: year - WINDOW_YEARS + 1, to: year },
        formula: { version: f.version },
        summary: {
          total: out.length, scored: scored.length, notScored: out.length - scored.length,
          average: scored.length ? scored.reduce((s, r) => s + (r.utilityScore ?? 0), 0) / scored.length : null,
          high: count('high'), good: count('good'), medium: count('medium'), low: count('low'),
          warning: scored.filter((r) => r.warning).length,
        },
        levels: RECOMMENDATION_TEXT,
        utilizationLevels: UTILIZATION_LEVELS,
        disclaimer: ADVICE_DISCLAIMER,
        rows: out.sort((a, b) => (b.utilityScore ?? -1) - (a.utilityScore ?? -1)),
      };
    });
  });

  /** ที่มาของคะแนนรายครุภัณฑ์ + ข้อมูลรายปี + ประวัติการประเมิน */
  app.get('/api/equipment/:id/score', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ year: Year.optional() }).parse(req.query);
    const year = q.year ?? defaultYear();
    return withTx(pool, u.scope, async (db) => {
      const e = (await db.query(`${EQ_SELECT} WHERE e.id = $1`, [id])).rows[0] as EquipmentLite | undefined;
      if (!e) throw new HttpError(404, 'ไม่พบครุภัณฑ์');
      const f = await currentFormulaSet(db);
      const recs = (await db.query('SELECT * FROM annual_record WHERE equipment_id = $1 ORDER BY fiscal_year_be', [id])).rows;
      // ใช้ scoreAll เพื่อให้ได้ผลเดียวกับหน้าผลวิเคราะห์ (รวมคะแนนจากไฟล์ Excel ที่นำเข้า) และอันดับในโรงพยาบาล
      const all = e.purchase_year_be > year ? [] : await scoreAll(db, year, f.fs, { hospitalId: e.hospital_id });
      const outcome: ScoreOutcome = e.purchase_year_be > year
        ? { status: 'no_data', problems: [`ซื้อหลังปีงบ ${year}`], years: [] }
        : (all.find((r) => r.equipment.id === id)?.outcome ?? scoreFromRecords(e, recs, year, f.fs));
      const ranked = outcome.status === 'scored' ? all.filter((r) => r.rank !== null) : [];
      const history = (
        await db.query(
          `SELECT s.analysis_year, s.utility_score, s.recommendation, s.warning, s.rank, s.computed_at, fs.version AS formula_version
             FROM score_result s JOIN formula_set fs ON fs.id = s.formula_set_id
            WHERE s.equipment_id = $1 AND s.basis = 'cumulative' ORDER BY s.computed_at DESC LIMIT 20`,
          [id],
        )
      ).rows;
      return {
        year,
        window: { from: year - WINDOW_YEARS + 1, to: year },
        formula: { version: f.version },
        outcome,
        utilization: outcome.status === 'scored' ? utilizationFor(e, outcome.inputs.utilizationPct) : null,
        assessment: outcome.status === 'scored' ? assessValue(outcome.breakdown, { usefulLifeYears: e.useful_life_years }) : null,
        rank: ranked.find((r) => r.equipment.id === id)?.rank ?? null,
        rankOf: ranked.length,
        annual: annualSeries(e, recs, f.fs),
        history,
      };
    });
  });
}
