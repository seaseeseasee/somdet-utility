import type { Db } from '../db.js';
import { HttpError } from '../errors.js';
import type { UtilityInput } from './score.js';

/** ค่าชั่วคราวของช่องที่ไฟล์ Excel ไม่มี — เจ้าหน้าที่แก้ภายหลังในหน้าแก้ไขครุภัณฑ์ */
export const PLACEHOLDER = { department: 'ไม่ระบุหน่วยงาน', type: 'อื่น ๆ', brand: 'ไม่ระบุ', model: 'ไม่ระบุ' };

/** สร้างในทะเบียนได้เมื่อมีปีที่ซื้อและราคาซื้อ (> 0) เพราะเป็นช่องบังคับของทะเบียน */
export const canRegister = (i: UtilityInput) => i.purchaseYearBe !== null && i.purchasePrice !== null && i.purchasePrice > 0;

export const matchKey = (name: string, i: Pick<UtilityInput, 'purchaseYearBe' | 'purchasePrice'>) =>
  `${name.replace(/\s+/g, ' ').trim().toLowerCase()}|${i.purchaseYearBe}|${i.purchasePrice}`;

export interface Registrar {
  /** สร้างครุภัณฑ์ใหม่จากแถวที่นำเข้า คืน id */
  create(name: string, i: UtilityInput): Promise<string>;
}

/** เตรียมค่าคงที่ของการนำเข้าครั้งนี้ (หน่วยงาน/ประเภทชั่วคราว และเลขรหัสถัดไป) */
export async function registrar(db: Db, o: { hospitalId: string; userId: string; batchId: string; now?: Date }): Promise<Registrar> {
  const department = (
    await db.query(
      `INSERT INTO department (hospital_id, name) VALUES ($1,$2)
       ON CONFLICT (hospital_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [o.hospitalId, PLACEHOLDER.department],
    )
  ).rows[0].id as string;
  const type = (await db.query('SELECT id FROM equipment_type WHERE name = $1', [PLACEHOLDER.type])).rows[0]?.id as string | undefined;
  if (!type) throw new HttpError(500, `ไม่พบประเภทครุภัณฑ์ "${PLACEHOLDER.type}"`);
  const prefix = `IMP-${(o.now ?? new Date()).getFullYear() + 543}-`;
  // เลขลำดับถัดไปของรหัสชั่วคราวในโรงพยาบาลนี้ (กันชนกันด้วย advisory lock ระหว่างการนำเข้าพร้อมกัน)
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`import-code:${o.hospitalId}`]);
  let seq = (
    await db.query(
      `SELECT coalesce(max(substring(code FROM '^${prefix}(\\d+)$')::int), 0) AS n FROM equipment WHERE hospital_id = $1 AND code LIKE $2`,
      [o.hospitalId, `${prefix}%`],
    )
  ).rows[0].n as number;

  return {
    async create(name, i) {
      const code = `${prefix}${String(++seq).padStart(4, '0')}`;
      const date = `${i.purchaseYearBe! - 543}-01-01`;
      const r = await db.query(
        `INSERT INTO equipment (hospital_id, code, name, type_id, department_id, brand, model, serial_no, purchase_year_be, purchase_price,
           received_date, start_date, status, maintenance_plan, status_note, created_by, updated_by, details_pending, imported_batch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$2,$8,$9,$10,$10,'in_use','none',$11,$12,$12,true,$13) RETURNING id`,
        [o.hospitalId, code, name.slice(0, 300), type, department, PLACEHOLDER.brand, PLACEHOLDER.model, i.purchaseYearBe, i.purchasePrice,
         date, 'นำเข้าจากไฟล์ Excel รอกรอกข้อมูลเพิ่ม (รหัส ยี่ห้อ รุ่น Serial หน่วยงาน วันที่รับเข้า)', o.userId, o.batchId],
      );
      return r.rows[0].id as string;
    },
  };
}
