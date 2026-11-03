import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import type { ScoringSettings } from './score.js';

type SettingsRow = Record<string, number | string | null | boolean>;

export const toSettings = (r: SettingsRow): ScoringSettings & { id: string; createdAt: unknown; source: string } => ({
  id: r.id as string,
  weights: {
    utilization: r.w_utilization as number, clinical: r.w_clinical as number, financial: r.w_financial as number,
    reliability: r.w_reliability as number, satisfaction: r.w_satisfaction as number, strategic: r.w_strategic as number,
  },
  paybackPenalty: r.payback_penalty as number,
  currentYearBe: r.current_year_be as number | null,
  createdAt: r.created_at,
  source: r.source as string,
});

/** ชุดน้ำหนักที่เปิดใช้สำหรับข้อมูลที่นำเข้าจาก Excel */
export async function activeSettings(db: Db) {
  const r = (await db.query('SELECT * FROM scoring_settings WHERE is_active')).rows[0];
  if (!r) throw new HttpError(500, 'ไม่พบชุดน้ำหนักที่เปิดใช้');
  return toSettings(r);
}
