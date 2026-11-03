import type { FastifyInstance } from 'fastify';
import { maintenanceCostOf, recommendationOf } from '@mu/formula';
import { z } from 'zod';
import { Uuid, YearBe } from '../validation.js';
import { fiscalYearOf, rowToBody } from '../annual.js';
import { requirePerm } from '../auth.js';
import { withTx } from '../db.js';
import { HttpError } from '../errors.js';
import { currentFormulaSet, scoreAll, toAnnualInput, utilizationFor, WINDOW_YEARS } from '../scoring.js';
import type { AppDeps } from '../app.js';

const CONFIRMED = ['approved', 'locked'];
const range = (y: number) => Array.from({ length: WINDOW_YEARS }, (_, i) => y - WINDOW_YEARS + 1 + i);

type Rec = Record<string, unknown> & { equipment_id: string; fiscal_year_be: number; status: string; hospital_id: string };

/** สรุปรายปีของกลุ่มข้อมูลที่ยืนยันแล้ว: Utilization/Downtime ถ่วงน้ำหนักด้วยชั่วโมง ค่าใช้จ่าย/รายได้เป็นผลรวม */
function yearly(recs: Rec[], years: number[]) {
  return years.map((fy) => {
    const rs = recs.filter((r) => r.fiscal_year_be === fy && CONFIRMED.includes(r.status)).map(toAnnualInput);
    const avail = rs.reduce((s, r) => s + (r.maxAvailableHours ?? 0), 0);
    return {
      fiscalYear: fy,
      records: rs.length,
      utilizationPct: avail > 0 ? (rs.reduce((s, r) => s + (r.actualHours ?? 0), 0) / avail) * 100 : null,
      downtimePct: avail > 0 ? (rs.reduce((s, r) => s + (r.downtimeHours ?? 0), 0) / avail) * 100 : null,
      maintenanceCost: rs.length ? rs.reduce((s, r) => s + maintenanceCostOf(r), 0) : null,
      revenue: rs.length ? rs.reduce((s, r) => s + (r.revenue ?? 0), 0) : null,
    };
  });
}

export async function dashboardRoutes(app: FastifyInstance, { pool }: AppDeps) {
  /** Dashboard ของโรงพยาบาล (ผู้ใช้ส่วนกลางระบุ hospitalId หรือดูรวม) */
  app.get('/api/dashboard/hospital', async (req) => {
    const u = requirePerm(req, 'dashboard.view');
    const q = z
      .object({
        year: YearBe.optional(), hospitalId: Uuid.optional(), departmentId: Uuid.optional(), typeId: Uuid.optional(),
        q: z.string().trim().max(100).optional(), minPrice: z.coerce.number().min(0).optional(), maxPrice: z.coerce.number().min(0).optional(),
        level: z.enum(['high', 'good', 'medium', 'low', 'none']).optional(),
      })
      .parse(req.query);
    const year = q.year ?? fiscalYearOf(new Date()) - 1;
    return withTx(pool, u.scope, async (db) => {
      const f = await currentFormulaSet(db);
      let rows = await scoreAll(db, year, f.fs, { hospitalId: q.hospitalId, departmentId: q.departmentId });
      const extra = (
        await db.query('SELECT id, type_id FROM equipment WHERE id = ANY($1)', [rows.map((r) => r.equipment.id)])
      ).rows as { id: string; type_id: string }[];
      const typeOf = new Map(extra.map((e) => [e.id, e.type_id]));
      rows = rows.filter((r) => {
        const e = r.equipment;
        if (q.typeId && typeOf.get(e.id) !== q.typeId) return false;
        if (q.q && !`${e.code} ${e.name}`.toLowerCase().includes(q.q.toLowerCase())) return false;
        if (q.minPrice !== undefined && e.purchase_price < q.minPrice) return false;
        if (q.maxPrice !== undefined && e.purchase_price > q.maxPrice) return false;
        if (q.level === 'none') return r.outcome.status !== 'scored';
        if (q.level) return r.outcome.status === 'scored' && r.outcome.breakdown.recommendation === q.level;
        return true;
      });
      const ids = rows.map((r) => r.equipment.id);
      const years = range(year);
      const recs = (
        ids.length ? (await db.query('SELECT * FROM annual_record WHERE equipment_id = ANY($1) AND fiscal_year_be BETWEEN $2 AND $3', [ids, years[0], year])).rows : []
      ) as Rec[];
      const scored = rows.filter((r) => r.outcome.status === 'scored') as (typeof rows[number] & { outcome: { status: 'scored'; breakdown: { utilityScore: number; recommendation: string; recommendationText: string; scores: Record<string, number>; warning: boolean } } })[];
      const maint = recs.filter((r) => CONFIRMED.includes(r.status)).reduce((s, r) => s + maintenanceCostOf(toAnnualInput(r)), 0);
      return {
        year,
        window: { from: years[0], to: year },
        formula: { version: f.version },
        kpis: {
          equipment: rows.length,
          totalValue: rows.reduce((s, r) => s + r.equipment.purchase_price, 0),
          scored: scored.length,
          averageScore: scored.length ? scored.reduce((s, r) => s + r.outcome.breakdown.utilityScore, 0) / scored.length : null,
          high: scored.filter((r) => r.outcome.breakdown.recommendation === 'high').length,
          replace: scored.filter((r) => r.outcome.breakdown.recommendation === 'low').length,
          warning: scored.filter((r) => r.outcome.breakdown.warning).length,
          maintenanceTotal: maint,
        },
        totals: yearly(recs, years),
        equipment: rows
          .map((r) => ({
            id: r.equipment.id, code: r.equipment.code, name: r.equipment.name, hospitalName: r.equipment.hospital_name,
            department: r.equipment.department_name, purchasePrice: r.equipment.purchase_price, rank: r.rank,
            status: r.outcome.status,
            utilityScore: r.outcome.status === 'scored' ? r.outcome.breakdown.utilityScore : null,
            recommendation: r.outcome.status === 'scored' ? r.outcome.breakdown.recommendation : null,
            recommendationText: r.outcome.status === 'scored' ? r.outcome.breakdown.recommendationText : null,
            warning: r.outcome.status === 'scored' ? r.outcome.breakdown.warning : false,
            utilization: r.outcome.status === 'scored' ? utilizationFor(r.equipment, r.outcome.inputs.utilizationPct) : null,
            source: r.outcome.status === 'scored' ? r.outcome.source : null,
            scores: r.outcome.status === 'scored' ? r.outcome.breakdown.scores : null,
            series: yearly(recs.filter((x) => x.equipment_id === r.equipment.id), years).map(({ records: _r, ...s }) => s),
          }))
          .sort((a, b) => (b.utilityScore ?? -1) - (a.utilityScore ?? -1)),
      };
    });
  });

  /** Dashboard ภาพรวมเครือข่าย — เฉพาะผู้ใช้ส่วนกลาง (N-01) */
  app.get('/api/dashboard/network', async (req) => {
    const u = requirePerm(req, 'dashboard.view');
    if (u.scope.scope !== 'all') throw new HttpError(403, 'Dashboard ภาพรวมเครือข่ายสำหรับผู้ใช้ส่วนกลางเท่านั้น');
    const q = z.object({ year: YearBe.optional(), province: z.string().trim().max(100).optional(), typeId: Uuid.optional() }).parse(req.query);
    const year = q.year ?? fiscalYearOf(new Date()) - 1;
    const years = range(year);
    return withTx(pool, u.scope, async (db) => {
      const f = await currentFormulaSet(db);
      const hospitals = (
        await db.query("SELECT id, hcode, name, province FROM hospital WHERE status = 'active' AND ($1::text IS NULL OR province = $1) ORDER BY name", [q.province ?? null])
      ).rows as { id: string; hcode: string; name: string; province: string | null }[];
      const types = (await db.query('SELECT id, name FROM equipment_type ORDER BY name')).rows as { id: string; name: string }[];
      const eq = (
        await db.query(
          `SELECT id, hospital_id, type_id, purchase_year_be, purchase_price, status FROM equipment
            WHERE status <> 'disposed' AND hospital_id = ANY($1) AND ($2::uuid IS NULL OR type_id = $2)`,
          [hospitals.map((h) => h.id), q.typeId ?? null],
        )
      ).rows as { id: string; hospital_id: string; type_id: string; purchase_year_be: number; purchase_price: number; status: string }[];
      const recs = (
        eq.length ? (await db.query('SELECT * FROM annual_record WHERE equipment_id = ANY($1) AND fiscal_year_be BETWEEN $2 AND $3', [eq.map((e) => e.id), years[0], year])).rows : []
      ) as Rec[];
      const scores = await scoreAll(db, year, f.fs);
      const eqIds = new Set(eq.map((e) => e.id));

      const groups: [string, (b: ReturnType<typeof rowToBody>) => boolean][] = [
        ['ชั่วโมงใช้งาน', (b) => b.maxAvailableHours != null && b.actualHours != null],
        ['มีรายได้ตรง', (b) => (b.revenue ?? 0) > 0],
        ['ค่าบำรุงรักษา', (b) => [b.repairCost, b.partsCost, b.pmCost, b.calibrationCost].every((v) => v != null)],
        ['Downtime', (b) => b.downtimeHours != null],
        ['คะแนน 1–5', (b) => [b.clinicalRating, b.satisfactionRating, b.strategicRating].every((v) => v != null)],
        ['ตรวจสภาพเครื่อง', (b) => b.condition != null && b.inspectedAt != null],
      ];
      const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

      const rows = hospitals.map((h) => {
        const hEq = eq.filter((e) => e.hospital_id === h.id);
        const eligible = (fy: number) => hEq.filter((e) => e.purchase_year_be <= fy && e.status !== 'pending_disposal');
        const hRecs = recs.filter((r) => r.hospital_id === h.id && eqIds.has(r.equipment_id));
        const hScores = scores.filter((s) => s.equipment.hospital_id === h.id && eqIds.has(s.equipment.id));
        const scored = hScores.filter((s) => s.outcome.status === 'scored').map((s) => (s.outcome as { breakdown: { utilityScore: number } }).breakdown.utilityScore);
        const dist = { high: 0, good: 0, medium: 0, low: 0 };
        for (const v of scored) dist[recommendationOf(v, f.fs)]++;
        // ความคืบหน้าปีนี้: ครุภัณฑ์ที่ต้องมีข้อมูลปีนี้ เทียบกับสถานะข้อมูลรายปี (ไม่มีรอบประเมิน กรอกได้ตลอดปี)
        const statusOf = new Map(hRecs.filter((r) => r.fiscal_year_be === year).map((r) => [r.equipment_id, r.status]));
        const due = eligible(year).filter((e) => ['ready', 'in_use', 'repair'].includes(e.status)).map((e) => statusOf.get(e.id));
        const progress = {
          approved: due.filter((s) => s && CONFIRMED.includes(s)).length,
          inProgress: due.filter((s) => s === 'draft').length,
          notStarted: due.filter((s) => !s).length,
          total: due.length,
        };
        const yearRecs = hRecs.filter((r) => r.fiscal_year_be === year).map(rowToBody);
        const denom = eligible(year).length;
        const completeness = Object.fromEntries(groups.map(([g, fn]) => [g, pct(yearRecs.filter(fn).length, denom)]));
        const coverage = years.map((fy) => {
          const el = eligible(fy);
          const confirmed = new Set(hRecs.filter((r) => r.fiscal_year_be === fy && CONFIRMED.includes(r.status)).map((r) => r.equipment_id));
          return { fiscalYear: fy, pct: el.length ? pct(el.filter((e) => confirmed.has(e.id)).length, el.length) : null };
        });
        const confirmedThisYear = new Set(hRecs.filter((r) => r.fiscal_year_be === year && CONFIRMED.includes(r.status)).map((r) => r.equipment_id)).size;

        const followUps: { level: 'red' | 'warn'; text: string }[] = [];
        if (progress.total && progress.approved < progress.total)
          followUps.push({ level: progress.approved / progress.total < 0.5 ? 'red' : 'warn', text: `ข้อมูลปี ${year} ยืนยันแล้ว ${progress.approved} จาก ${progress.total} รายการ` });
        if (denom && !yearRecs.length) followUps.push({ level: 'red', text: `ยังไม่มีการบันทึกข้อมูลปีงบ ${year} เลย (${denom} รายการที่ต้องบันทึก)` });
        else for (const [g, v] of Object.entries(completeness))
          if (denom && v < 50) followUps.push({ level: 'warn', text: g === 'มีรายได้ตรง' ? `มีข้อมูลรายได้ตรงเพียง ${v}% (Financial Score ส่วนใหญ่จะเป็น 50)` : `หมวด "${g}" กรอกเพียง ${v}%` });
        const missing = coverage.filter((c) => c.pct === 0).map((c) => c.fiscalYear);
        if (missing.length) followUps.push({ level: 'warn', text: `ยังไม่มีข้อมูลยืนยันปีงบ ${missing.join(', ')} จึงวิเคราะห์ย้อนหลังครบ 5 ปีไม่ได้` });

        return {
          hospital: h,
          equipment: hEq.length,
          totalValue: hEq.reduce((s, e) => s + e.purchase_price, 0),
          confirmedThisYear,
          progress,
          averageScore: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
          scoredCount: scored.length,
          distribution: dist,
          notScored: hEq.length - scored.length,
          types: Object.fromEntries(types.map((t) => [t.id, hEq.filter((e) => e.type_id === t.id).length])),
          completeness,
          coverage,
          followUps,
        };
      });

      const allScored = rows.reduce((s, r) => s + r.scoredCount, 0);
      return {
        year,
        window: { from: years[0], to: year },
        formula: { version: f.version },
        types,
        completenessGroups: groups.map(([g]) => g),
        provinces: [...new Set((await db.query('SELECT DISTINCT province FROM hospital WHERE province IS NOT NULL ORDER BY province')).rows.map((r) => r.province))],
        kpis: {
          hospitals: rows.length,
          hospitalsReporting: rows.filter((r) => r.confirmedThisYear > 0).length,
          equipment: rows.reduce((s, r) => s + r.equipment, 0),
          totalValue: rows.reduce((s, r) => s + r.totalValue, 0),
          confirmedPct: pct(rows.reduce((s, r) => s + r.confirmedThisYear, 0), rows.reduce((s, r) => s + r.equipment, 0)),
          confirmedThisYear: rows.reduce((s, r) => s + r.confirmedThisYear, 0),
          averageScore: allScored ? rows.reduce((s, r) => s + (r.averageScore ?? 0) * r.scoredCount, 0) / allScored : null,
          scored: allScored,
          replace: rows.reduce((s, r) => s + r.distribution.low, 0),
        },
        hospitals: rows,
      };
    });
  });
}
