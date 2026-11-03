/** ระดับ Utilization 1–5 และข้อเสนอแนะการใช้งาน */
import { isNum } from './util.js';

// ---------------------------------------------------------------- ระดับ Utilization และข้อเสนอแนะ

export type UtilizationLevel = 1 | 2 | 3 | 4 | 5;

/** เกณฑ์ 5 ระดับ (ช่วงไม่ทับซ้อนและไม่ตกหล่น: ค่าที่ขอบ เช่น 80% อยู่ระดับที่สูงกว่า) */
export const UTILIZATION_LEVELS: Record<UtilizationLevel, { min: number; range: string; label: string; advice: string }> = {
  5: { min: 80, range: '≥ 80%', label: 'ใช้งานสูงมาก', advice: 'ควรคงการใช้งานอย่างต่อเนื่อง วางแผนบำรุงรักษา และประเมินความเพียงพอของอุปกรณ์' },
  4: { min: 60, range: '60–79.99%', label: 'ใช้งานสูง', advice: 'ควรคงการใช้งาน ติดตามปริมาณการใช้งานและประสิทธิภาพอย่างสม่ำเสมอ' },
  3: { min: 40, range: '40–59.99%', label: 'ใช้งานปานกลาง', advice: 'ควรทบทวนตารางการใช้งาน วิเคราะห์ช่วงเวลาที่ใช้งานน้อย และเพิ่มประสิทธิภาพการใช้งาน' },
  2: { min: 20, range: '20–39.99%', label: 'ใช้งานต่ำ', advice: 'ควรวิเคราะห์สาเหตุที่ใช้งานต่ำ และพิจารณาการใช้ร่วมกันหรือโอนย้ายหน่วยงาน' },
  1: { min: 0, range: '< 20%', label: 'ใช้งานต่ำมาก', advice: 'ควรทบทวนความจำเป็นในการครอบครอง ประเมินความคุ้มค่า และพิจารณาโอนย้ายหรือจำหน่ายตามระเบียบ' },
};

/** อุปกรณ์ช่วยชีวิต/สำรองฉุกเฉิน: ใช้น้อยเป็นเรื่องปกติ จึงไม่แนะนำโอนย้ายหรือจำหน่ายจากระดับการใช้งาน */
export const CRITICAL_LOW_USE_ADVICE =
  'อุปกรณ์ช่วยชีวิต/สำรองฉุกเฉิน: การใช้งานน้อยอาจเป็นเรื่องปกติ ควรตรวจความพร้อมใช้งานสม่ำเสมอ และทบทวนจำนวนที่ต้องสำรองตามความจำเป็นทางคลินิก ไม่ใช้ระดับ Utilization เป็นเหตุผลโอนย้ายหรือจำหน่าย';
export const ADVICE_DISCLAIMER = 'ข้อเสนอแนะเป็นข้อมูลประกอบการพิจารณาของผู้บริหาร ไม่ใช่การตัดสินใจอัตโนมัติ';

/**
 * ระดับ Utilization (1–5) — ปัดเป็นทศนิยม 2 ตำแหน่งก่อนเทียบเกณฑ์ (ตรงกับช่วง 60–79.99% ในเกณฑ์)
 * ไม่มีค่า, ติดลบ หรือเกิน 100% = ข้อมูลผิดปกติ ไม่จัดระดับ (null)
 */
export function utilizationLevelOf(pct: number | null | undefined): UtilizationLevel | null {
  if (!isNum(pct)) return null;
  const v = Math.round(pct * 100) / 100;
  if (v < 0 || v > 100) return null;
  for (const lvl of [5, 4, 3, 2] as const) if (v >= UTILIZATION_LEVELS[lvl].min) return lvl;
  return 1;
}

export interface UtilizationAdvice {
  level: UtilizationLevel;
  label: string;
  range: string;
  advice: string;
  /** อุปกรณ์ช่วยชีวิต/สำรองฉุกเฉิน — ใช้ข้อเสนอแนะแบบพิเศษเมื่อระดับต่ำ */
  critical: boolean;
}

/** ข้อเสนอแนะตามระดับ Utilization (null = ไม่มีข้อมูลหรือข้อมูลผิดปกติ) */
export function utilizationAdvice(pct: number | null | undefined, opt: { critical?: boolean } = {}): UtilizationAdvice | null {
  const level = utilizationLevelOf(pct);
  if (level === null) return null;
  const l = UTILIZATION_LEVELS[level];
  const critical = Boolean(opt.critical);
  return { level, label: l.label, range: l.range, advice: critical && level <= 2 ? CRITICAL_LOW_USE_ADVICE : l.advice, critical };
}
