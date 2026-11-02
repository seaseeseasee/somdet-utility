import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AnnualBody, COLUMN, evaluate, FIELDS, fiscalRange, fiscalYearOf, rowToBody } from '../annual.js';
import { can, requirePerm, type CurrentUser } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx, type Db } from '../db.js';
import { HttpError } from '../errors.js';
import type { AppDeps } from '../app.js';

const Uuid = z.string().uuid();
const Params = z.object({ id: Uuid, year: z.coerce.number().int().min(2500).max(2700) });

export const STATUS_LABEL: Record<string, string> = { draft: 'ร่าง', submitted: 'รอตรวจสอบ', approved: 'ยืนยันแล้ว', locked: 'ล็อกแล้ว' };

async function equipmentOf(db: Db, id: string) {
  const e = (
    await db.query('SELECT id, hospital_id, code, name, purchase_year_be, purchase_price, useful_life_years, status FROM equipment WHERE id = $1', [id])
  ).rows[0];
  if (!e) throw new HttpError(404, 'ไม่พบครุภัณฑ์');
  return e as { id: string; hospital_id: string; code: string; name: string; purchase_year_be: number; purchase_price: number; useful_life_years: number | null; status: string };
}

async function recordById(db: Db, id: string, lock = false) {
  const r = (await db.query(`SELECT * FROM annual_record WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!r) throw new HttpError(404, 'ไม่พบข้อมูลรายปี');
  return r as Record<string, unknown> & { id: string; hospital_id: string; equipment_id: string; fiscal_year_be: number; status: string; version: number; created_by: string; updated_by: string };
}

/** ข้อมูลปีก่อนหน้าที่ยืนยันแล้ว ใช้ตรวจข้อสังเกต (ค่าเปลี่ยนมาก) */
async function previousApproved(db: Db, equipmentId: string, fy: number) {
  const r = (
    await db.query("SELECT * FROM annual_record WHERE equipment_id = $1 AND fiscal_year_be = $2 AND status IN ('approved','locked')", [equipmentId, fy - 1])
  ).rows[0];
  return r ? rowToBody(r) : undefined;
}

async function detail(db: Db, equipmentId: string, fy: number) {
  const e = await equipmentOf(db, equipmentId);
  const rec = (await db.query('SELECT * FROM annual_record WHERE equipment_id = $1 AND fiscal_year_be = $2', [equipmentId, fy])).rows[0];
  const data = rec ? rowToBody(rec) : null;
  const prev = await previousApproved(db, equipmentId, fy);
  const evaluation = data ? evaluate(data, fy, prev, { purchasePrice: e.purchase_price, usefulLifeYears: e.useful_life_years }) : null;
  const reviews = rec
    ? (
        await db.query(
          `SELECT r.action, r.reason, r.at, u.name AS actor_name FROM review_action r LEFT JOIN app_user u ON u.id = r.actor_id
            WHERE r.annual_record_id = $1 ORDER BY r.at DESC, r.id`,
          [rec.id],
        )
      ).rows
    : [];
  const maintenance = rec
    ? (await db.query('SELECT id, event_date, kind, detail, cost, work_order_no FROM maintenance_event WHERE annual_record_id = $1 ORDER BY event_date', [rec.id])).rows
    : [];
  return {
    equipment: e,
    fiscalYear: fy,
    period: fiscalRange(fy),
    record: rec
      ? { id: rec.id, status: rec.status, statusLabel: STATUS_LABEL[rec.status], version: rec.version, createdBy: rec.created_by, updatedBy: rec.updated_by, updatedAt: rec.updated_at, submittedAt: rec.submitted_at, approvedAt: rec.approved_at }
      : null,
    data,
    previousYear: prev ?? null,
    evaluation,
    reviews,
    maintenance,
  };
}

const auditCtx = (req: FastifyRequest, u: CurrentUser) => ({ actorId: u.id, ip: req.ip, userAgent: req.headers['user-agent'] });

async function review(db: Db, recordId: string, hospitalId: string, action: string, actorId: string, reason?: string | null) {
  await db.query('INSERT INTO review_action (hospital_id, annual_record_id, action, reason, actor_id) VALUES ($1,$2,$3,$4,$5)', [
    hospitalId, recordId, action, reason ?? null, actorId,
  ]);
}

export async function annualRoutes(app: FastifyInstance, { pool }: AppDeps) {
  /** รายการปีงบที่บันทึกได้ของครุภัณฑ์ และสถานะแต่ละปี */
  app.get('/api/equipment/:id/annual', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTx(pool, u.scope, async (db) => {
      const e = await equipmentOf(db, id);
      const rows = (await db.query('SELECT * FROM annual_record WHERE equipment_id = $1 ORDER BY fiscal_year_be', [id])).rows;
      const current = fiscalYearOf(new Date());
      const years = [];
      for (let fy = Math.max(e.purchase_year_be, current - 4); fy <= current; fy++) {
        const r = rows.find((x) => x.fiscal_year_be === fy);
        years.push({
          fiscalYear: fy,
          recordId: r?.id ?? null,
          status: r?.status ?? null,
          statusLabel: r ? STATUS_LABEL[r.status] : 'ยังไม่บันทึก',
          completeness: r ? evaluate(rowToBody(r), fy).completeness : 0,
          updatedAt: r?.updated_at ?? null,
        });
      }
      // ปีที่เก่ากว่า 5 ปีงบที่บันทึกไว้แล้วยังแสดงในประวัติ
      for (const r of rows.filter((x) => x.fiscal_year_be < current - 4))
        years.unshift({ fiscalYear: r.fiscal_year_be, recordId: r.id, status: r.status, statusLabel: STATUS_LABEL[r.status], completeness: evaluate(rowToBody(r), r.fiscal_year_be).completeness, updatedAt: r.updated_at });
      return { equipment: e, currentFiscalYear: current, years };
    });
  });

  app.get('/api/equipment/:id/annual/:year', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const { id, year } = Params.parse(req.params);
    return withTx(pool, u.scope, (db) => detail(db, id, year));
  });

  /** บันทึกร่าง (สร้างใหม่หรือแก้ไข) — ร่างกรอกไม่ครบได้ ปีอื่นไม่ถูกแก้ */
  app.put('/api/equipment/:id/annual/:year', async (req) => {
    const u = requirePerm(req, 'annual.write');
    const { id, year } = Params.parse(req.params);
    const body = AnnualBody.parse(req.body);
    const { version } = z.object({ version: z.number().int().positive().optional() }).parse(req.body);
    return withTx(pool, u.scope, async (db) => {
      const e = await equipmentOf(db, id);
      const current = fiscalYearOf(new Date());
      if (year < e.purchase_year_be) throw new HttpError(400, `ปีงบประมาณต้องไม่ก่อนปีที่จัดซื้อ (${e.purchase_year_be})`);
      if (year > current) throw new HttpError(400, `บันทึกล่วงหน้าเกินปีงบประมาณปัจจุบัน (${current}) ไม่ได้`);
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`annual:${id}:${year}`]);
      const existing = (await db.query('SELECT * FROM annual_record WHERE equipment_id = $1 AND fiscal_year_be = $2 FOR UPDATE', [id, year])).rows[0];
      const cols = FIELDS.map((f) => COLUMN[f]);
      const vals = FIELDS.map((f) => (f === 'otherCost' && body[f] == null ? 0 : (body[f] ?? null)));
      if (!existing) {
        const r = await db.query(
          `INSERT INTO annual_record (hospital_id, equipment_id, fiscal_year_be, ${cols.join(', ')}, created_by, updated_by)
           VALUES ($1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(', ')}, $${cols.length + 4}, $${cols.length + 4}) RETURNING *`,
          [e.hospital_id, id, year, ...vals, u.id],
        );
        await writeAudit(db, { hospitalId: e.hospital_id, ...auditCtx(req, u), action: 'create', entity: 'annual_record', entityId: r.rows[0].id, after: r.rows[0] });
      } else {
        if (existing.status !== 'draft')
          throw new HttpError(409, `ข้อมูลปี ${year} อยู่ในสถานะ "${STATUS_LABEL[existing.status]}" แก้ไขไม่ได้ ต้องให้ผู้ดูแลระบบโรงพยาบาลปลดล็อกก่อน`);
        if (version !== undefined && version !== existing.version)
          throw new HttpError(409, 'ข้อมูลถูกแก้ไขโดยผู้อื่นระหว่างที่ท่านแก้ไข กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไขอีกครั้ง');
        const r = await db.query(
          `UPDATE annual_record SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_by = $${cols.length + 2},
             updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`,
          [existing.id, ...vals, u.id],
        );
        await writeAudit(db, { hospitalId: e.hospital_id, ...auditCtx(req, u), action: 'update', entity: 'annual_record', entityId: existing.id, before: existing, after: r.rows[0] });
      }
      return detail(db, id, year);
    });
  });

  /** ส่งให้ผู้ตรวจสอบ — ต้องไม่มีข้อผิดพลาด และระบุเหตุผลเมื่อมีข้อสังเกต */
  app.post('/api/annual/:id/submit', async (req) => {
    const u = requirePerm(req, 'annual.write');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTx(pool, u.scope, async (db) => {
      const r = await recordById(db, id, true);
      if (r.status !== 'draft') throw new HttpError(409, `ข้อมูลอยู่ในสถานะ "${STATUS_LABEL[r.status]}" ส่งตรวจซ้ำไม่ได้`);
      const e = await equipmentOf(db, r.equipment_id);
      const ev = evaluate(rowToBody(r), r.fiscal_year_be, await previousApproved(db, r.equipment_id, r.fiscal_year_be), { purchasePrice: e.purchase_price, usefulLifeYears: e.useful_life_years });
      if (ev.errors.length) throw new HttpError(422, `ยังส่งตรวจไม่ได้ พบข้อผิดพลาด ${ev.errors.length} รายการ`, ev.errors);
      if (ev.needsChangeReason) throw new HttpError(422, 'มีข้อสังเกต กรุณาระบุเหตุผลก่อนส่งตรวจ', [{ field: 'changeReason', message: 'กรุณาระบุเหตุผลของการเปลี่ยนแปลง' }]);
      await db.query("UPDATE annual_record SET status = 'submitted', submitted_at = now(), version = version + 1 WHERE id = $1", [id]);
      await review(db, id, r.hospital_id, 'submit', u.id);
      await writeAudit(db, { hospitalId: r.hospital_id, ...auditCtx(req, u), action: 'submit', entity: 'annual_record', entityId: id, before: { status: r.status }, after: { status: 'submitted' } });
      return detail(db, r.equipment_id, r.fiscal_year_be);
    });
  });

  /** ยืนยัน — ผู้บันทึกหรือผู้แก้ไขล่าสุดยืนยันข้อมูลของตนเองไม่ได้ (Segregation of Duties) */
  app.post('/api/annual/:id/approve', async (req) => {
    const u = requirePerm(req, 'annual.review');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const { note } = z.object({ note: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    return withTx(pool, u.scope, async (db) => {
      const r = await recordById(db, id, true);
      if (r.status !== 'submitted') throw new HttpError(409, 'ยืนยันได้เฉพาะข้อมูลที่อยู่ในสถานะ "รอตรวจสอบ"');
      if (r.created_by === u.id || r.updated_by === u.id) throw new HttpError(403, 'ไม่สามารถยืนยันข้อมูลที่ท่านเป็นผู้บันทึกหรือแก้ไขเอง');
      await db.query("UPDATE annual_record SET status = 'approved', approved_by = $2, approved_at = now(), version = version + 1 WHERE id = $1", [id, u.id]);
      await review(db, id, r.hospital_id, 'approve', u.id, note);
      await writeAudit(db, { hospitalId: r.hospital_id, ...auditCtx(req, u), action: 'approve', entity: 'annual_record', entityId: id, before: { status: r.status }, after: { status: 'approved', note: note ?? null } });
      return detail(db, r.equipment_id, r.fiscal_year_be);
    });
  });

  app.post('/api/annual/:id/reject', async (req) => {
    const u = requirePerm(req, 'annual.review');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(5, 'กรุณาระบุเหตุผลที่ตีกลับ (อย่างน้อย 5 ตัวอักษร)').max(2000) }).parse(req.body ?? {});
    return withTx(pool, u.scope, async (db) => {
      const r = await recordById(db, id, true);
      if (r.status !== 'submitted') throw new HttpError(409, 'ตีกลับได้เฉพาะข้อมูลที่อยู่ในสถานะ "รอตรวจสอบ"');
      await db.query("UPDATE annual_record SET status = 'draft', submitted_at = NULL, version = version + 1 WHERE id = $1", [id]);
      await review(db, id, r.hospital_id, 'reject', u.id, reason);
      await writeAudit(db, { hospitalId: r.hospital_id, ...auditCtx(req, u), action: 'reject', entity: 'annual_record', entityId: id, before: { status: r.status }, after: { status: 'draft', reason } });
      return detail(db, r.equipment_id, r.fiscal_year_be);
    });
  });

  /** ปลดล็อกข้อมูลที่ยืนยัน/ล็อกแล้วกลับเป็นร่าง — ต้องมีเหตุผล และบันทึก audit */
  app.post('/api/annual/:id/unlock', async (req) => {
    const u = requirePerm(req, 'annual.unlock');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(5, 'กรุณาระบุเหตุผลการปลดล็อก (อย่างน้อย 5 ตัวอักษร)').max(2000) }).parse(req.body ?? {});
    return withTx(pool, u.scope, async (db) => {
      const r = await recordById(db, id, true);
      if (!['approved', 'locked', 'submitted'].includes(r.status)) throw new HttpError(409, 'ข้อมูลเป็นร่างอยู่แล้ว');
      await db.query("UPDATE annual_record SET status = 'draft', submitted_at = NULL, approved_by = NULL, approved_at = NULL, version = version + 1 WHERE id = $1", [id]);
      await review(db, id, r.hospital_id, 'unlock', u.id, reason);
      await writeAudit(db, { hospitalId: r.hospital_id, ...auditCtx(req, u), action: 'unlock', entity: 'annual_record', entityId: id, before: { status: r.status }, after: { status: 'draft', reason } });
      return detail(db, r.equipment_id, r.fiscal_year_be);
    });
  });

  // ---------------------------------------------------------------- ประวัติซ่อมบำรุง (แก้ได้เฉพาะตอนเป็นร่าง)
  app.post('/api/annual/:id/maintenance', async (req, reply) => {
    const u = requirePerm(req, 'annual.write');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z
      .object({
        eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ YYYY-MM-DD'),
        kind: z.enum(['repair', 'pm', 'calibration', 'other']),
        detail: z.string().trim().min(1, 'กรุณาระบุรายละเอียด').max(1000),
        cost: z.number().min(0, 'ค่าใช้จ่ายต้องไม่ติดลบ'),
        workOrderNo: z.string().trim().max(100).nullable().optional(),
      })
      .parse(req.body);
    const row = await withTx(pool, u.scope, async (db) => {
      const r = await recordById(db, id);
      if (r.status !== 'draft') throw new HttpError(409, 'แก้ไขประวัติซ่อมบำรุงได้เฉพาะตอนข้อมูลเป็นร่าง');
      const { from, to } = fiscalRange(r.fiscal_year_be);
      if (b.eventDate < from || b.eventDate > to) throw new HttpError(400, `วันที่ต้องอยู่ในปีงบประมาณ ${r.fiscal_year_be} (${from} ถึง ${to})`, [{ field: 'eventDate', message: 'วันที่อยู่นอกปีงบประมาณ' }]);
      const m = (
        await db.query(
          'INSERT INTO maintenance_event (hospital_id, annual_record_id, event_date, kind, detail, cost, work_order_no) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [r.hospital_id, id, b.eventDate, b.kind, b.detail, b.cost, b.workOrderNo ?? null],
        )
      ).rows[0];
      await writeAudit(db, { hospitalId: r.hospital_id, ...auditCtx(req, u), action: 'create', entity: 'maintenance_event', entityId: m.id, after: m });
      return m;
    });
    return reply.code(201).send(row);
  });

  app.delete('/api/annual/:id/maintenance/:eventId', async (req) => {
    const u = requirePerm(req, 'annual.write');
    const { id, eventId } = z.object({ id: Uuid, eventId: Uuid }).parse(req.params);
    return withTx(pool, u.scope, async (db) => {
      const r = await recordById(db, id);
      if (r.status !== 'draft') throw new HttpError(409, 'แก้ไขประวัติซ่อมบำรุงได้เฉพาะตอนข้อมูลเป็นร่าง');
      const m = (await db.query('DELETE FROM maintenance_event WHERE id = $1 AND annual_record_id = $2 RETURNING *', [eventId, id])).rows[0];
      if (!m) throw new HttpError(404, 'ไม่พบรายการ');
      await writeAudit(db, { hospitalId: r.hospital_id, ...auditCtx(req, u), action: 'delete', entity: 'maintenance_event', entityId: eventId, before: m });
      return { ok: true };
    });
  });

  /** คิวรอตรวจสอบของโรงพยาบาล */
  app.get('/api/review-queue', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    return withTx(pool, u.scope, async (db) => {
      const rows = (
        await db.query(
          `SELECT a.id, a.fiscal_year_be, a.submitted_at, a.created_by, a.updated_by, e.id AS equipment_id, e.code, e.name,
                  d.name AS department_name, h.name AS hospital_name, ub.name AS updated_by_name
             FROM annual_record a JOIN equipment e ON e.id = a.equipment_id JOIN department d ON d.id = e.department_id
             JOIN hospital h ON h.id = a.hospital_id LEFT JOIN app_user ub ON ub.id = a.updated_by
            WHERE a.status = 'submitted' ORDER BY a.submitted_at`,
        )
      ).rows;
      return rows.map((r) => ({ ...r, canApprove: can(u, 'annual.review') && r.created_by !== u.id && r.updated_by !== u.id }));
    });
  });
}
