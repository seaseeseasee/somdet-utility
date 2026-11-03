import type { FormulaSet } from '@mu/formula';
import type { Db } from '../db.js';
import { currentFormulaSet } from '../scoring.js';

/**
 * ชุดสูตรที่ใช้คำนวณข้อมูลที่นำเข้าจาก Excel = ชุดสูตรที่ใช้อยู่ (ชุดเดียวทั้งระบบ)
 * ปรับได้ที่หน้า "สมมติฐานและน้ำหนักคะแนน" โดยผู้ดูแลระบบส่วนกลาง
 */
export async function activeSettings(db: Db): Promise<FormulaSet & { id: string; currentYearBe: number | null }> {
  const f = await currentFormulaSet(db);
  return { ...f.fs, id: f.id, currentYearBe: f.fs.currentYearBe ?? null };
}
