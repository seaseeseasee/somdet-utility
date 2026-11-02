import { annualMetrics, validateAnnual, type AnnualInput } from '@mu/formula';
import { z } from 'zod';

/** ปีงบประมาณ (พ.ศ.) ของวันที่: 1 ต.ค. – 30 ก.ย. เช่น 1 ต.ค. 2568 – 30 ก.ย. 2569 = ปีงบ 2569 */
export function fiscalYearOf(d: Date): number {
  return d.getMonth() >= 9 ? d.getFullYear() + 544 : d.getFullYear() + 543;
}
/** ช่วงวันที่ของปีงบประมาณ (ค.ศ.) */
export function fiscalRange(fyBe: number) {
  const end = fyBe - 543;
  return { from: `${end - 1}-10-01`, to: `${end}-09-30` };
}

const n = (max?: number) => {
  let s = z.number().min(0, 'ต้องไม่ติดลบ');
  if (max !== undefined) s = s.max(max, `ต้องไม่เกิน ${max}`);
  return s.nullable().optional();
};
const rating = z
  .number()
  .min(1, 'คะแนน 1–5')
  .max(5, 'คะแนน 1–5')
  .refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-9, 'ทศนิยมได้ไม่เกิน 1 ตำแหน่ง')
  .nullable()
  .optional();

/** ข้อมูลรายปีที่บันทึกได้ (ร่างกรอกไม่ครบได้ แต่ค่าที่กรอกต้องอยู่ในช่วงที่เป็นไปได้) */
export const AnnualBody = z.object({
  availableDays: n(366), actualDays: n(366), maxAvailableHours: n(8784), actualHours: n(8784),
  useCount: z.number().int().min(0).nullable().optional(), caseCount: z.number().int().min(0).nullable().optional(),
  repairCost: n(), partsCost: n(), pmCost: n(), calibrationCost: n(), otherCost: n(), revenue: n(),
  noDirectRevenue: z.boolean().default(false),
  repairDays: n(366), breakdownCount: z.number().int().min(0).nullable().optional(), downtimeHours: n(8784),
  clinicalRating: rating, satisfactionRating: rating, strategicRating: rating,
  ratingRationale: z.string().trim().max(2000).nullable().optional(),
  clinicalNecessity: z.enum(['high', 'medium', 'low']).nullable().optional(),
  condition: z.enum(['good', 'fair', 'broken']).nullable().optional(),
  inspectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ YYYY-MM-DD').nullable().optional(),
  inspectionNote: z.string().trim().max(2000).nullable().optional(),
  safetyEvent: z.boolean().nullable().optional(),
  safetyDetail: z.string().trim().max(2000).nullable().optional(),
  recallStatus: z.enum(['none', 'past', 'ongoing']).nullable().optional(),
  unitRecommendation: z.enum(['continue', 'increase_use', 'repair', 'reallocate', 'replace', 'decommission']).nullable().optional(),
  rationale: z.string().trim().max(4000).nullable().optional(),
  changeReason: z.string().trim().max(2000).nullable().optional(),
});
export type AnnualBody = z.infer<typeof AnnualBody>;

/** ชื่อคอลัมน์ในฐานข้อมูล ↔ ชื่อฟิลด์ใน API */
export const COLUMN: Record<keyof AnnualBody, string> = {
  availableDays: 'available_days', actualDays: 'actual_days', maxAvailableHours: 'max_available_hours', actualHours: 'actual_hours',
  useCount: 'use_count', caseCount: 'case_count', repairCost: 'repair_cost', partsCost: 'parts_cost', pmCost: 'pm_cost',
  calibrationCost: 'calibration_cost', otherCost: 'other_cost', revenue: 'revenue', noDirectRevenue: 'no_direct_revenue',
  repairDays: 'repair_days', breakdownCount: 'breakdown_count', downtimeHours: 'downtime_hours',
  clinicalRating: 'clinical_rating', satisfactionRating: 'satisfaction_rating', strategicRating: 'strategic_rating',
  ratingRationale: 'rating_rationale', clinicalNecessity: 'clinical_necessity', condition: 'condition', inspectedAt: 'inspected_at',
  inspectionNote: 'inspection_note', safetyEvent: 'safety_event', safetyDetail: 'safety_detail', recallStatus: 'recall_status',
  unitRecommendation: 'unit_recommendation', rationale: 'rationale', changeReason: 'change_reason',
};
export const FIELDS = Object.keys(COLUMN) as (keyof AnnualBody)[];

export function rowToBody(row: Record<string, unknown>): AnnualBody {
  return Object.fromEntries(FIELDS.map((f) => [f, row[COLUMN[f]] ?? (f === 'noDirectRevenue' ? false : null)])) as AnnualBody;
}

const toInput = (b: AnnualBody, fy: number): Partial<AnnualInput> =>
  Object.fromEntries(
    Object.entries({ ...b, fiscalYear: fy }).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<AnnualInput>;

/** ช่องที่ต้องกรอกก่อนส่งตรวจ (นอกเหนือจากช่องตัวเลขที่ validateAnnual ตรวจ) */
const REQUIRED_TEXT: [keyof AnnualBody, string][] = [
  ['ratingRationale', 'เหตุผลประกอบคะแนน 1–5'],
  ['clinicalNecessity', 'ความจำเป็นทางคลินิก'],
  ['condition', 'ผลตรวจสภาพเครื่อง'],
  ['inspectedAt', 'วันที่ตรวจสภาพ'],
  ['safetyEvent', 'เหตุการณ์ความปลอดภัย'],
  ['recallStatus', 'สถานะ Recall'],
  ['unitRecommendation', 'ข้อเสนอแนะของหน่วยงาน'],
  ['rationale', 'เหตุผลประกอบข้อเสนอแนะ'],
];
const NUMERIC_REQUIRED: (keyof AnnualBody)[] = [
  'availableDays', 'actualDays', 'maxAvailableHours', 'actualHours', 'useCount', 'caseCount', 'repairCost', 'partsCost',
  'pmCost', 'calibrationCost', 'otherCost', 'revenue', 'repairDays', 'breakdownCount', 'downtimeHours',
  'clinicalRating', 'satisfactionRating', 'strategicRating',
];
export const TOTAL_REQUIRED = NUMERIC_REQUIRED.length + REQUIRED_TEXT.length;

/** ผลตรวจทั้งหมดของข้อมูลรายปี: errors = ส่งตรวจไม่ได้, warnings = ต้องระบุเหตุผล, completeness = % ช่องบังคับที่กรอก */
export function evaluate(b: AnnualBody, fy: number, previous?: AnnualBody, ctx?: { purchasePrice: number; usefulLifeYears: number | null }) {
  const { errors, warnings } = validateAnnual(toInput(b, fy), previous ? toInput(previous, fy - 1) : undefined);
  for (const [f, label] of REQUIRED_TEXT) {
    const v = b[f];
    if (v === null || v === undefined || v === '') errors.push({ field: f, message: `${label}: กรุณากรอก` });
  }
  if (b.safetyEvent === true && !b.safetyDetail) errors.push({ field: 'safetyDetail', message: 'กรุณาระบุรายละเอียดเหตุการณ์ความปลอดภัย' });
  const filled =
    NUMERIC_REQUIRED.filter((f) => b[f] !== null && b[f] !== undefined).length +
    REQUIRED_TEXT.filter(([f]) => b[f] !== null && b[f] !== undefined && b[f] !== '').length;
  const complete = NUMERIC_REQUIRED.every((f) => b[f] !== null && b[f] !== undefined);
  const metrics = complete
    ? annualMetrics(toInput(b, fy) as AnnualInput, ctx?.purchasePrice, ctx?.usefulLifeYears ?? undefined)
    : null;
  return {
    errors,
    warnings,
    needsChangeReason: warnings.length > 0 && !b.changeReason,
    completeness: Math.round((filled / TOTAL_REQUIRED) * 100),
    metrics,
  };
}
