/** ผลประเมินความคุ้มค่า (เกณฑ์เสริม) */
import type { FactorScores, ScoreBreakdown } from './cumulative.js';

// ---------------------------------------------------------------- ผลประเมินความคุ้มค่า (เกณฑ์เสริม)
// แยกจากเกณฑ์ข้อเสนอแนะของชุดสูตร (thresholds) และไม่ใช้ในรายงานผู้บริหาร

export type ValueLevel = 'very_worth' | 'worth' | 'watch' | 'not_worth';

/** ระดับคะแนนรวม: ≥ 80 / 65–79.99 / 50–64.99 / < 50 */
export const VALUE_LEVELS: Record<ValueLevel, { min: number; range: string; label: string; advice: string }> = {
  very_worth: { min: 80, range: '≥ 80', label: 'คุ้มค่ามาก', advice: 'คงใช้ต่อ / ขยายหรือจัดหาเพิ่มได้' },
  worth: { min: 65, range: '65–79', label: 'คุ้มค่า', advice: 'คงใช้ต่อ ติดตามตามรอบปกติ' },
  watch: { min: 50, range: '50–64', label: 'พอใช้ / ต้องเฝ้าระวัง', advice: 'ทบทวนปัญหารายมิติ แล้วทำแผนปรับปรุง' },
  not_worth: { min: 0, range: '< 50', label: 'ไม่คุ้มค่า', advice: 'พิจารณาลดการลงทุน ย้ายใช้งาน ทดแทน หรือจำหน่าย' },
};

/** รายมิติ: < 50 = ต่ำ, 50–59.99 = เฝ้าระวัง */
export const DIMENSION_LOW = 50;
export const DIMENSION_WATCH = 60;
/** กฎเสริม: Reliability หรือ Clinical ต่ำกว่านี้ = ธงแดงด้านความปลอดภัยผู้ป่วย */
export const SAFETY_RED_FLAG = 40;

export const DIMENSION_ADVICE: Record<keyof FactorScores, { label: string; meaning: string; actions: string }> = {
  utilization: { label: 'Utilization', meaning: 'ใช้งานน้อย', actions: 'เพิ่มข้อบ่งใช้ ย้ายไปหน่วยที่ใช้มากกว่า ทบทวนว่าจำเป็นต้องมีหรือไม่' },
  financial: { label: 'Financial', meaning: 'คืนทุนช้า ต้นทุนต่อเคสสูง', actions: 'ปรับราคา/การเบิกจ่าย เพิ่มจำนวนเคส ต่อรองสัญญาบำรุงรักษา' },
  reliability: { label: 'Reliability', meaning: 'เสียบ่อย downtime สูง', actions: 'เพิ่ม PM ทบทวนสัญญาซ่อม เตรียมเครื่องสำรอง พิจารณาทดแทน' },
  clinical: { label: 'Clinical', meaning: 'ประโยชน์ทางคลินิกต่ำ', actions: 'ทบทวนข้อบ่งใช้ ปรึกษาแพทย์ผู้ใช้ ดูว่ามีทางเลือกที่ดีกว่าหรือไม่' },
  satisfaction: { label: 'Satisfaction', meaning: 'ผู้ใช้ไม่พอใจ', actions: 'สำรวจสาเหตุ อบรมการใช้งาน ปรับ workflow' },
  strategic: { label: 'Strategic', meaning: 'ไม่สอดคล้องแผน', actions: 'ประเมินบทบาทในแผนพัฒนาบริการ ตัดสินใจคงหรือเลิก' },
};

export type DimensionStatus = 'ok' | 'watch' | 'low' | 'insufficient';

export interface ValueAssessment {
  level: ValueLevel;
  label: string;
  range: string;
  advice: string;
  dimensions: { key: keyof FactorScores; label: string; score: number; status: DimensionStatus; meaning?: string; actions?: string }[];
  /** กฎเสริม (override): red = กระทบความปลอดภัยหรือสรุปได้ว่าไม่คุ้มทุน, info = ข้อจำกัดของข้อมูล */
  flags: { severity: 'red' | 'info'; rule: 'safety' | 'payback_over_life' | 'payback_na' | 'no_useful_life'; text: string }[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function valueLevelOf(score: number): ValueLevel {
  const v = round2(score);
  for (const k of ['very_worth', 'worth', 'watch'] as const) if (v >= VALUE_LEVELS[k].min) return k;
  return 'not_worth';
}

/** ประเมินความคุ้มค่าจากผลคำนวณ Utility Score พร้อมกฎเสริม */
export function assessValue(b: Pick<ScoreBreakdown, 'utilityScore' | 'scores' | 'paybackYears'>, opt: { usefulLifeYears?: number | null } = {}): ValueAssessment {
  const level = valueLevelOf(b.utilityScore);
  const paybackNA = b.paybackYears === null;
  const dimensions = (Object.keys(DIMENSION_ADVICE) as (keyof FactorScores)[]).map((key) => {
    const score = b.scores[key];
    const d = DIMENSION_ADVICE[key];
    // Financial = 50 เป็นค่ากลางเมื่อไม่มีรายได้ตรง จึงห้ามสรุปผลด้านการเงิน
    const status: DimensionStatus =
      key === 'financial' && paybackNA ? 'insufficient' : round2(score) < DIMENSION_LOW ? 'low' : round2(score) < DIMENSION_WATCH ? 'watch' : 'ok';
    return { key, label: d.label, score, status, ...(status === 'low' || status === 'watch' ? { meaning: d.meaning, actions: d.actions } : {}) };
  });

  const flags: ValueAssessment['flags'] = [];
  for (const k of ['reliability', 'clinical'] as const)
    if (round2(b.scores[k]) < SAFETY_RED_FLAG)
      flags.push({ severity: 'red', rule: 'safety', text: `${DIMENSION_ADVICE[k].label} Score ${b.scores[k].toFixed(1)} < ${SAFETY_RED_FLAG}: กระทบความปลอดภัยผู้ป่วย ต้องแก้ไขก่อน แม้คะแนนรวมสูง` });
  if (paybackNA) flags.push({ severity: 'info', rule: 'payback_na', text: 'Payback = N/A: ข้อมูลด้านการเงินไม่เพียงพอ (Financial 50 เป็นค่ากลาง ไม่ใช้สรุปผลด้านการเงิน)' });
  else if (opt.usefulLifeYears && b.paybackYears! > opt.usefulLifeYears)
    flags.push({ severity: 'red', rule: 'payback_over_life', text: `Payback ${b.paybackYears!.toFixed(1)} ปี เกินอายุการใช้งานตามเกณฑ์ ${opt.usefulLifeYears} ปี: ไม่คุ้มทุน` });
  else if (!opt.usefulLifeYears)
    flags.push({ severity: 'info', rule: 'no_useful_life', text: 'ยังไม่ได้กำหนดอายุการใช้งานตามเกณฑ์ในทะเบียน จึงเทียบ Payback กับอายุเครื่องไม่ได้' });

  const l = VALUE_LEVELS[level];
  return { level, label: l.label, range: l.range, advice: l.advice, dimensions, flags };
}
