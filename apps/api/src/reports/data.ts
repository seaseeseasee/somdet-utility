import { FORMULA_SETS, RECOMMENDATION_TEXT, type ScoreBreakdown } from '@mu/formula';
import { z } from 'zod';
import { fiscalYearOf, rowToBody } from '../annual.js';
import type { CurrentUser } from '../auth.js';
import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import { currentFormulaSet, scoreAll, WINDOW_YEARS } from '../scoring.js';

export const SECTIONS = ['kpi', 'chart', 'ranking', 'factors', 'annual', 'method'] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = {
  kpi: 'สรุป KPI ภาพรวม', chart: 'กราฟ Utility Score รายครุภัณฑ์', ranking: 'ตารางจัดอันดับและข้อเสนอแนะ',
  factors: 'คะแนนแยก 6 ปัจจัย', annual: 'ข้อมูลรายปีที่ใช้คำนวณ (ภาคผนวก)', method: 'วิธีคำนวณและเวอร์ชันสูตร',
};

const name = z.string().trim().max(100).optional();
const signDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ YYYY-MM-DD').optional();
export const ReportQuery = z.object({
  year: z.coerce.number().int().min(2500).max(2700).optional(),
  hospitalId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  sort: z.enum(['score_desc', 'score_asc', 'code', 'department']).default('score_desc'),
  sections: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',').filter((s) => (SECTIONS as readonly string[]).includes(s)) as Section[]) : (['kpi', 'chart', 'ranking', 'factors', 'method'] as Section[]))),
  preparedBy: name, reviewedBy: name, approvedBy: name,
  preparedAt: signDate, reviewedAt: signDate, approvedAt: signDate,
});
export type ReportQuery = z.infer<typeof ReportQuery>;

export interface ReportRow {
  rank: number | null; hospital: string; code: string; name: string; department: string; type: string; purchaseYear: number;
  purchasePrice: number; years: number[]; breakdown: ScoreBreakdown;
  /** ที่มาของข้อมูลที่ใช้คิดคะแนน: ปีงบที่ยืนยันแล้ว หรือข้อมูลสะสมจากไฟล์ Excel */
  basis: string;
}
export interface ReportData {
  title: string; subtitle: string; scopeLabel: string; year: number; window: { from: number; to: number };
  formulaVersion: string; formulaDefinition: Record<string, unknown>; generatedAt: Date; generatedBy: string;
  sections: Section[]; sort: ReportQuery['sort']; signatures: {
    preparedBy?: string; reviewedBy?: string; approvedBy?: string;
    preparedAt?: string; reviewedAt?: string; approvedAt?: string;
  };
  kpis: { equipment: number; totalValue: number; scored: number; averageScore: number | null; high: number; good: number; medium: number; low: number; warning: number };
  rows: ReportRow[];
  notScored: { hospital: string; code: string; name: string; reason: string }[];
  annual: Record<string, unknown>[];
  multiHospital: boolean;
}

export async function buildReportData(db: Db, u: CurrentUser, q: ReportQuery): Promise<ReportData> {
  const year = q.year ?? fiscalYearOf(new Date()) - 1;
  const f = await currentFormulaSet(db);
  const def = (await db.query('SELECT definition FROM formula_set WHERE id = $1', [f.id])).rows[0]?.definition ?? {};
  if (!FORMULA_SETS[f.version]) throw new HttpError(500, 'ไม่พบชุดสูตร');
  const all = await scoreAll(db, year, f.fs, { hospitalId: q.hospitalId, departmentId: q.departmentId });
  let scope = 'ทุกโรงพยาบาลในเครือข่าย';
  if (q.hospitalId || u.hospitalId) {
    const h = (await db.query('SELECT name FROM hospital WHERE id = $1', [q.hospitalId ?? u.hospitalId])).rows[0];
    if (!h) throw new HttpError(404, 'ไม่พบโรงพยาบาล');
    scope = h.name;
  }
  if (q.departmentId) {
    const d = (await db.query('SELECT name FROM department WHERE id = $1', [q.departmentId])).rows[0];
    if (!d) throw new HttpError(404, 'ไม่พบหน่วยงาน');
    scope += ` · ${d.name}`;
  }
  const rows: ReportRow[] = [];
  const notScored: ReportData['notScored'] = [];
  for (const r of all) {
    const e = r.equipment;
    if (r.outcome.status === 'scored')
      rows.push({ rank: r.rank, hospital: e.hospital_name ?? '', code: e.code, name: e.name, department: e.department_name ?? '', type: e.type_name ?? '',
        purchaseYear: e.purchase_year_be, purchasePrice: e.purchase_price, years: r.outcome.years, breakdown: r.outcome.breakdown,
        basis: r.outcome.source === 'excel' ? 'ข้อมูลสะสมจากไฟล์ Excel' : r.outcome.years.join(', ') });
    else notScored.push({ hospital: e.hospital_name ?? '', code: e.code, name: e.name, reason: r.outcome.problems.slice(0, 2).join(' · ') });
  }
  const cmp: Record<ReportQuery['sort'], (a: ReportRow, b: ReportRow) => number> = {
    score_desc: (a, b) => b.breakdown.utilityScore - a.breakdown.utilityScore,
    score_asc: (a, b) => a.breakdown.utilityScore - b.breakdown.utilityScore,
    code: (a, b) => a.hospital.localeCompare(b.hospital, 'th') || a.code.localeCompare(b.code),
    department: (a, b) => a.department.localeCompare(b.department, 'th') || b.breakdown.utilityScore - a.breakdown.utilityScore,
  };
  rows.sort(cmp[q.sort]);
  const ids = all.filter((r) => r.outcome.status === 'scored').map((r) => r.equipment.id);
  const annual = ids.length
    ? (
        await db.query(
          `SELECT a.*, e.code, e.name AS equipment_name, h.name AS hospital_name FROM annual_record a
             JOIN equipment e ON e.id = a.equipment_id JOIN hospital h ON h.id = a.hospital_id
            WHERE a.equipment_id = ANY($1) AND a.status IN ('approved','locked') AND a.fiscal_year_be BETWEEN $2 AND $3
            ORDER BY h.name, e.code, a.fiscal_year_be`,
          [ids, year - WINDOW_YEARS + 1, year],
        )
      ).rows.map((r) => ({ ...rowToBody(r), fiscalYear: r.fiscal_year_be, status: r.status, code: r.code, equipmentName: r.equipment_name, hospital: r.hospital_name }))
    : [];
  const scores = rows.map((r) => r.breakdown.utilityScore);
  const count = (l: string) => rows.filter((r) => r.breakdown.recommendation === l).length;
  return {
    title: 'รายงานสรุปผลการวิเคราะห์ Utility Score ครุภัณฑ์ทางการแพทย์',
    subtitle: `เพื่อประกอบการวางแผนจัดซื้อ บำรุงรักษา และทดแทน · ปีงบประมาณ ${year - WINDOW_YEARS + 1}–${year}`,
    scopeLabel: scope,
    year,
    window: { from: year - WINDOW_YEARS + 1, to: year },
    formulaVersion: f.version,
    formulaDefinition: def,
    generatedAt: new Date(),
    generatedBy: u.name,
    sections: q.sections,
    sort: q.sort,
    signatures: {
      preparedBy: q.preparedBy, reviewedBy: q.reviewedBy, approvedBy: q.approvedBy,
      preparedAt: q.preparedAt, reviewedAt: q.reviewedAt, approvedAt: q.approvedAt,
    },
    kpis: {
      equipment: all.length,
      totalValue: all.reduce((s, r) => s + r.equipment.purchase_price, 0),
      scored: rows.length,
      averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      high: count('high'), good: count('good'), medium: count('medium'), low: count('low'),
      warning: rows.filter((r) => r.breakdown.warning).length,
    },
    rows,
    notScored,
    annual,
    multiHospital: new Set(all.map((r) => r.equipment.hospital_id)).size > 1,
  };
}

export const REC = RECOMMENDATION_TEXT;
export const thaiDate = (d: Date, time = false) =>
  d.toLocaleString('th-TH-u-ca-buddhist', { day: 'numeric', month: 'long', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Asia/Bangkok' });
