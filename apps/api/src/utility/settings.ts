import type { Db } from '../db.js';
import { currentFormulaSet } from '../scoring.js';
import type { ScoringSettings } from './score.js';

/**
 * น้ำหนักและค่าคงที่สำหรับข้อมูลที่นำเข้าจาก Excel = ชุดสูตรที่ใช้อยู่ (ชุดเดียวทั้งระบบ)
 * ปรับได้ที่หน้า "สมมติฐานและน้ำหนักคะแนน" โดยผู้ดูแลระบบส่วนกลาง
 */
export async function activeSettings(db: Db): Promise<ScoringSettings & { id: string; version: string }> {
  const f = await currentFormulaSet(db);
  return { id: f.id, version: f.version, weights: { ...f.fs.weights }, paybackPenalty: f.fs.paybackPenalty, currentYearBe: f.fs.currentYearBe ?? null };
}
