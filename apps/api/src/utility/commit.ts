import { currentYearOf, type FormulaSet } from '@mu/formula';
import { writeAudit } from '../audit.js';
import type { Db } from '../db.js';
import type { PendingImport } from './pending.js';
import type { PreviewRow, PreviewSheet } from './parse.js';
import { matchKey, registrar } from './register.js';

/**
 * ยืนยันนำเข้า (ทำงานใน transaction ที่ผู้เรียกเปิดไว้ — ผิดพลาดจุดใด rollback ทั้งหมด)
 * 1) สร้าง batch  2) โหมดแทนที่: ซ่อนข้อมูลเดิมของชีตที่เลือก  3) ผูก/สร้างครุภัณฑ์
 * 4) เขียนข้อมูลรายเครื่อง  5) ลบครุภัณฑ์ชั่วคราวที่ไม่มีในไฟล์ใหม่  6) บันทึก audit
 */

export interface CommitInput {
  pending: PendingImport;
  sheets: PreviewSheet[];
  mode: 'append' | 'replace';
  settings: FormulaSet & { id: string };
  actor: { id: string; providerId: string; ip?: string; userAgent?: string };
}

export interface CommitResult { batchId: string; inserted: number; replaced: number; skipped: number; registered: number; reused: number; removed: number }

type Row = { s: PreviewSheet; r: PreviewRow; equipmentId: string | null };

/** จำนวนแถวต่อคำสั่ง INSERT (20 พารามิเตอร์ต่อแถว ไม่เกินขีดจำกัด 65,535 ของ PostgreSQL) */
const INSERT_CHUNK = 500;

async function createBatch(db: Db, c: CommitInput, rowCount: number) {
  const { pending: p, settings } = c;
  const r = await db.query(
    `INSERT INTO utility_import_batch (hospital_id, filename, file_sha256, uploaded_by, mode, sheets, settings_snapshot, row_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [p.hospitalId, p.filename, p.sha, c.actor.id, c.mode, c.sheets.map((s) => s.sheet),
     { active: settings, currentYearBe: currentYearOf(settings), fromFile: p.fileSettings, providerId: c.actor.providerId }, rowCount],
  );
  return r.rows[0].id as string;
}

/**
 * โหมดแทนที่: ซ่อนข้อมูลนำเข้าเดิมของชีตที่เลือก (soft delete)
 * คืนครุภัณฑ์เดิมจัดกลุ่มตามชื่อ+ปี+ราคา เพื่อใช้ต่อแทนการสร้างซ้ำในทะเบียน
 */
async function retireDatasets(db: Db, hospitalId: string, datasets: string[]) {
  const old = (
    await db.query(
      `UPDATE utility_record SET deleted_at = now() WHERE hospital_id = $1 AND dataset = ANY($2) AND deleted_at IS NULL
       RETURNING equipment_id, name, purchase_year_be, purchase_price`,
      [hospitalId, datasets],
    )
  ).rows;
  const reuse = new Map<string, string[]>();
  const equipment = new Set<string>();
  for (const o of old)
    if (o.equipment_id) {
      equipment.add(o.equipment_id);
      const k = matchKey(o.name, { purchaseYearBe: o.purchase_year_be, purchasePrice: o.purchase_price });
      reuse.set(k, [...(reuse.get(k) ?? []), o.equipment_id]);
    }
  return { replaced: old.length, reuse, equipment };
}

/** ผูกแต่ละแถวกับครุภัณฑ์: ใช้ของเดิมเมื่อชื่อ+ปี+ราคาตรงกัน ไม่งั้นสร้างใหม่ (เฉพาะแถวที่สร้างในทะเบียนได้) */
async function attachEquipment(db: Db, c: CommitInput, batchId: string, rows: Row[], reuse: Map<string, string[]>) {
  const reg = await registrar(db, { hospitalId: c.pending.hospitalId, userId: c.actor.id, batchId });
  const kept = new Set<string>();
  let registered = 0;
  for (const row of rows) {
    if (!row.r.register) continue;
    const existing = reuse.get(matchKey(row.r.name, row.r.input))?.shift();
    if (existing) {
      row.equipmentId = existing;
      kept.add(existing);
    } else {
      row.equipmentId = await reg.create(row.r.name, row.r.input);
      registered++;
    }
  }
  return { kept, registered };
}

async function insertRecords(db: Db, hospitalId: string, batchId: string, rows: Row[]) {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const chunk = rows.slice(start, start + INSERT_CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map(({ s, r, equipmentId }) => {
      const i = r.input;
      const v = [hospitalId, batchId, s.sheet, s.title, s.sheet, r.sourceRow, r.seqNo, r.name, i.purchaseYearBe, i.purchasePrice, i.utilizationPct,
        i.totalCases, i.maintenanceCostTotal, i.downtimePct, i.revenueTotal, i.clinicalRating, i.satisfactionRating, i.strategicRating,
        r.status === 'incomplete' ? 'incomplete' : 'complete', equipmentId];
      const first = values.length;
      values.push(...v);
      return `(${v.map((_, k) => `$${first + k + 1}`).join(',')})`;
    });
    await db.query(
      `INSERT INTO utility_record (hospital_id, batch_id, dataset, dataset_title, source_sheet, source_row, seq_no, name, purchase_year_be,
         purchase_price, utilization_pct, total_cases, maintenance_cost_total, downtime_pct, revenue_total, clinical_rating,
         satisfaction_rating, strategic_rating, data_status, equipment_id)
       VALUES ${tuples.join(',')}`,
      values,
    );
  }
}

/** ครุภัณฑ์เดิมที่ไม่มีในไฟล์ใหม่: ลบเฉพาะที่ยังเป็นค่าชั่วคราวและไม่มีข้อมูลรายปี ที่เจ้าหน้าที่แก้แล้วเก็บไว้ */
async function removeOrphans(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return (
    await db.query(
      `DELETE FROM equipment e WHERE e.id = ANY($1) AND e.details_pending
         AND NOT EXISTS (SELECT 1 FROM annual_record a WHERE a.equipment_id = e.id)
         AND NOT EXISTS (SELECT 1 FROM utility_record x WHERE x.equipment_id = e.id AND x.deleted_at IS NULL)
       RETURNING e.id, e.code, e.name`,
      [ids],
    )
  ).rows as { id: string; code: string; name: string }[];
}

export async function commitImport(db: Db, c: CommitInput): Promise<CommitResult> {
  const hospitalId = c.pending.hospitalId;
  const rows: Row[] = c.sheets.flatMap((s) => s.rows.filter((r) => r.status !== 'error').map((r) => ({ s, r, equipmentId: null })));
  const batchId = await createBatch(db, c, rows.length);

  const old = c.mode === 'replace'
    ? await retireDatasets(db, hospitalId, c.sheets.map((s) => s.sheet))
    : { replaced: 0, reuse: new Map<string, string[]>(), equipment: new Set<string>() };
  const { kept, registered } = await attachEquipment(db, c, batchId, rows, old.reuse);
  await insertRecords(db, hospitalId, batchId, rows);
  const removed = await removeOrphans(db, [...old.equipment].filter((id) => !kept.has(id)));
  await db.query('UPDATE utility_import_batch SET registered_count = $2 WHERE id = $1', [batchId, registered]);

  const skipped = c.sheets.reduce((n, s) => n + s.summary.error, 0);
  await writeAudit(db, {
    hospitalId, actorId: c.actor.id, action: 'import', entity: 'utility_import_batch', entityId: batchId,
    after: {
      filename: c.pending.filename, sha256: c.pending.sha, mode: c.mode, sheets: c.sheets.map((s) => s.sheet), inserted: rows.length,
      replaced: old.replaced, skipped, registered, reusedEquipment: kept.size, removedEquipment: removed.map((e) => e.code),
    },
    ip: c.actor.ip, userAgent: c.actor.userAgent,
  });
  return { batchId, inserted: rows.length, replaced: old.replaced, skipped, registered, reused: kept.size, removed: removed.length };
}
