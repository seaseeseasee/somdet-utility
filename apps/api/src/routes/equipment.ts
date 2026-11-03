import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can, requirePerm } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx, type Db } from '../db.js';
import { HttpError } from '../errors.js';
import type { AppDeps } from '../app.js';

const Uuid = z.string().uuid();
const Year = z.coerce.number().int().min(2500, 'ปี พ.ศ. ต้องอยู่ระหว่าง 2500–2700').max(2700, 'ปี พ.ศ. ต้องอยู่ระหว่าง 2500–2700');
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ YYYY-MM-DD (ค.ศ.)');
export const EQUIPMENT_STATUS = ['ready', 'in_use', 'repair', 'suspended', 'pending_disposal', 'disposed'] as const;

export const EquipmentBody = z
  .object({
    code: z.string().trim().min(1, 'กรุณากรอกรหัสครุภัณฑ์').max(50),
    name: z.string().trim().min(1, 'กรุณากรอกชื่อครุภัณฑ์').max(300),
    typeId: Uuid,
    departmentId: Uuid,
    brand: z.string().trim().min(1, 'กรุณากรอกยี่ห้อ').max(100),
    model: z.string().trim().min(1, 'กรุณากรอกรุ่น').max(100),
    serialNo: z.string().trim().min(1, 'กรุณากรอก Serial Number').max(100),
    purchaseYearBe: Year,
    budgetYearBe: Year.nullable().optional(),
    purchasePrice: z.coerce.number().positive('ราคาจัดซื้อต้องมากกว่า 0').max(1e12),
    contractNo: z.string().trim().max(100).nullable().optional(),
    fundingSource: z.string().trim().max(100).nullable().optional(),
    receivedDate: DateStr,
    startDate: DateStr,
    usefulLifeYears: z.coerce.number().int().positive('อายุการใช้งานตามเกณฑ์ต้องมากกว่า 0').max(50).nullable().optional(),
    status: z.enum(EQUIPMENT_STATUS),
    maintenancePlan: z.enum(['yes', 'none', 'in_progress']).default('none'),
    statusNote: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate < v.receivedDate)
      ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'วันที่เริ่มใช้งานต้องไม่ก่อนวันที่รับเข้า' });
    if ((v.status === 'repair' || v.status === 'suspended') && !v.statusNote)
      ctx.addIssue({ code: 'custom', path: ['statusNote'], message: 'กรุณาระบุเหตุผลเมื่อสถานะเป็นซ่อมหรืองดใช้' });
  });
type EquipmentBody = z.infer<typeof EquipmentBody>;

const COLS = `e.id, e.hospital_id, h.name AS hospital_name, e.code, e.name, e.type_id, t.name AS type_name, e.department_id, d.name AS department_name,
  e.brand, e.model, e.serial_no, e.purchase_year_be, e.budget_year_be, e.purchase_price, e.contract_no, e.funding_source,
  e.received_date, e.start_date, e.useful_life_years, e.status, e.maintenance_plan, e.status_note,
  e.created_at, e.updated_at, e.version, e.details_pending, e.imported_batch_id`;
const FROM = `FROM equipment e JOIN hospital h ON h.id = e.hospital_id JOIN equipment_type t ON t.id = e.type_id JOIN department d ON d.id = e.department_id`;

async function getOne(db: Db, id: string) {
  return (await db.query(`SELECT ${COLS} ${FROM} WHERE e.id = $1`, [id])).rows[0] as Record<string, unknown> | undefined;
}

/** FK ข้ามโรงพยาบาลได้ (FK ไม่ผ่าน RLS) จึงตรวจเองว่าหน่วยงานเป็นของโรงพยาบาลนี้ */
async function assertDepartment(db: Db, departmentId: string, hospitalId: string) {
  const r = await db.query('SELECT 1 FROM department WHERE id = $1 AND hospital_id = $2', [departmentId, hospitalId]);
  if (!r.rowCount) throw new HttpError(400, 'หน่วยงานไม่อยู่ในโรงพยาบาลนี้', [{ field: 'departmentId', message: 'เลือกหน่วยงานของโรงพยาบาลนี้' }]);
}

const values = (b: EquipmentBody) => [
  b.code, b.name, b.typeId, b.departmentId, b.brand, b.model, b.serialNo, b.purchaseYearBe, b.budgetYearBe ?? null,
  b.purchasePrice, b.contractNo ?? null, b.fundingSource ?? null, b.receivedDate, b.startDate, b.usefulLifeYears ?? null,
  b.status, b.maintenancePlan, b.statusNote ?? null,
];

export async function equipmentRoutes(app: FastifyInstance, { pool }: AppDeps) {
  app.get('/api/equipment', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const q = z
      .object({
        q: z.string().trim().max(100).optional(),
        status: z.enum(EQUIPMENT_STATUS).optional(),
        departmentId: Uuid.optional(),
        typeId: Uuid.optional(),
        hospitalId: Uuid.optional(),
        minPrice: z.coerce.number().min(0).optional(),
        pending: z.enum(['1']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    return withTx(pool, u.scope, async (db) => {
      const where = `WHERE ($1::text IS NULL OR e.code ILIKE '%'||$1||'%' OR e.name ILIKE '%'||$1||'%' OR e.serial_no ILIKE '%'||$1||'%'
          OR e.brand ILIKE '%'||$1||'%' OR e.model ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR e.status = $2) AND ($3::uuid IS NULL OR e.department_id = $3)
        AND ($4::uuid IS NULL OR e.type_id = $4) AND ($5::uuid IS NULL OR e.hospital_id = $5)
        AND ($6::numeric IS NULL OR e.purchase_price >= $6) AND (NOT $7::boolean OR e.details_pending)`;
      const args = [q.q || null, q.status ?? null, q.departmentId ?? null, q.typeId ?? null, q.hospitalId ?? null, q.minPrice ?? null, q.pending === '1'];
      const total = (await db.query(`SELECT count(*)::int AS n ${FROM} ${where}`, args)).rows[0].n as number;
      const rows = (
        await db.query(`SELECT ${COLS} ${FROM} ${where} ORDER BY h.name, e.code LIMIT $8 OFFSET $9`, [
          ...args, q.pageSize, (q.page - 1) * q.pageSize,
        ])
      ).rows;
      return { total, page: q.page, pageSize: q.pageSize, rows };
    });
  });

  app.get('/api/equipment/:id', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const row = await withTx(pool, u.scope, (db) => getOne(db, id));
    if (!row) throw new HttpError(404, 'ไม่พบครุภัณฑ์');
    return row;
  });

  app.post('/api/equipment', async (req, reply) => {
    const u = requirePerm(req, 'equipment.write');
    if (!u.hospitalId) throw new HttpError(403, 'ผู้ใช้ส่วนกลางไม่สามารถลงทะเบียนครุภัณฑ์ของโรงพยาบาลได้');
    const b = EquipmentBody.parse(req.body);
    const row = await withTx(pool, u.scope, async (db) => {
      await assertDepartment(db, b.departmentId, u.hospitalId!);
      const r = await db.query(
        `INSERT INTO equipment (hospital_id, code, name, type_id, department_id, brand, model, serial_no, purchase_year_be, budget_year_be,
           purchase_price, contract_no, funding_source, received_date, start_date, useful_life_years, status, maintenance_plan, status_note,
           created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING id`,
        [u.hospitalId, ...values(b), u.id],
      );
      const created = await getOne(db, r.rows[0].id);
      await writeAudit(db, { hospitalId: u.hospitalId, actorId: u.id, action: 'create', entity: 'equipment', entityId: r.rows[0].id, after: created, ip: req.ip, userAgent: req.headers['user-agent'] });
      return created;
    });
    return reply.code(201).send(row);
  });

  app.put('/api/equipment/:id', async (req) => {
    const u = requirePerm(req, 'equipment.write');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const body = z.object({ version: z.number().int().positive() }).passthrough().parse(req.body);
    const b = EquipmentBody.parse(req.body);
    return withTx(pool, u.scope, async (db) => {
      const before = await getOne(db, id);
      if (!before) throw new HttpError(404, 'ไม่พบครุภัณฑ์');
      if (before.code !== b.code && !can(u, 'equipment.code.change'))
        throw new HttpError(403, 'แก้ไขรหัสครุภัณฑ์ได้เฉพาะผู้ดูแลระบบโรงพยาบาล');
      await assertDepartment(db, b.departmentId, before.hospital_id as string);
      const r = await db.query(
        `UPDATE equipment SET code=$1, name=$2, type_id=$3, department_id=$4, brand=$5, model=$6, serial_no=$7, purchase_year_be=$8,
           budget_year_be=$9, purchase_price=$10, contract_no=$11, funding_source=$12, received_date=$13, start_date=$14,
           useful_life_years=$15, status=$16, maintenance_plan=$17, status_note=$18,
           updated_by=$19, updated_at=now(), version = version + 1, details_pending = false
         WHERE id=$20 AND version=$21`,
        [...values(b), u.id, id, body.version],
      );
      if (!r.rowCount)
        throw new HttpError(409, 'ข้อมูลถูกแก้ไขโดยผู้อื่นระหว่างที่ท่านแก้ไข กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไขอีกครั้ง');
      const after = await getOne(db, id);
      await writeAudit(db, { hospitalId: before.hospital_id as string, actorId: u.id, action: 'update', entity: 'equipment', entityId: id, before, after, ip: req.ip, userAgent: req.headers['user-agent'] });
      return after;
    });
  });

  app.get('/api/equipment/:id/history', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTx(pool, u.scope, async (db) => {
      if (!(await getOne(db, id))) throw new HttpError(404, 'ไม่พบครุภัณฑ์');
      return (
        await db.query(
          `SELECT a.id, a.action, a.at, a.before, a.after, u.name AS actor_name
             FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_id
            WHERE a.entity = 'equipment' AND a.entity_id = $1 ORDER BY a.id DESC LIMIT 100`,
          [id],
        )
      ).rows;
    });
  });
}
