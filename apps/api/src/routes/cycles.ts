import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluate, fiscalRange, fiscalYearOf, rowToBody } from '../annual.js';
import { requirePerm } from '../auth.js';
import { writeAudit } from '../audit.js';
import { currentFormulaSet, scoreAll } from '../scoring.js';
import { withTx, type Db } from '../db.js';
import { HttpError } from '../errors.js';
import type { AppDeps } from '../app.js';

const Uuid = z.string().uuid();
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ YYYY-MM-DD');

export const REASON_LABEL: Record<string, string> = {
  annual: 'ประเมินประจำปี',
  end_of_life: 'ครบอายุใช้งานตามเกณฑ์',
  new: 'รับเข้าใหม่ปีนี้',
  calibration_due: 'ครบกำหนดสอบเทียบ',
};
export const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังบันทึก', rejected: 'ถูกตีกลับ', submitted: 'รอตรวจสอบ', approved: 'ยืนยันแล้ว',
};

/**
 * N-02: ครบกำหนดประเมินทุกเครื่องที่ใช้งาน/พร้อมใช้/ซ่อม และซื้อไม่หลังปีงบนั้น
 * พร้อมระบุเหตุเพิ่ม: ครบอายุใช้งานตามเกณฑ์ หรือรับเข้าใหม่ในปีงบนั้น
 * (ครบกำหนดสอบเทียบ: รอข้อมูลกำหนดสอบเทียบในทะเบียน จึงยังไม่สร้างอัตโนมัติ)
 */
async function generateTasks(db: Db, cycle: { id: string; hospital_id: string; fiscal_year_be: number; closes_at: string }) {
  const eq = (
    await db.query(
      `SELECT id, purchase_year_be, useful_life_years FROM equipment
        WHERE hospital_id = $1 AND status IN ('ready','in_use','repair') AND purchase_year_be <= $2`,
      [cycle.hospital_id, cycle.fiscal_year_be],
    )
  ).rows;
  let created = 0;
  for (const e of eq) {
    const reasons = ['annual'];
    if (e.useful_life_years && cycle.fiscal_year_be - e.purchase_year_be >= e.useful_life_years) reasons.push('end_of_life');
    if (e.purchase_year_be === cycle.fiscal_year_be) reasons.push('new');
    const r = await db.query(
      `INSERT INTO assessment_task (hospital_id, cycle_id, equipment_id, reasons, due_date) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (cycle_id, equipment_id) DO UPDATE SET reasons = EXCLUDED.reasons
         WHERE assessment_task.reasons IS DISTINCT FROM EXCLUDED.reasons
       RETURNING (xmax = 0) AS inserted`,
      [cycle.hospital_id, cycle.id, e.id, reasons, cycle.closes_at],
    );
    // อัปเดตเหตุที่ครบกำหนดของรายการเดิม (ผู้รับผิดชอบและกำหนดส่งคงเดิม) แต่นับเฉพาะรายการใหม่
    if (r.rows[0]?.inserted) created++;
  }
  return created;
}

const derived = (status: string | null, lastAction: string | null) =>
  !status ? 'not_started' : status === 'draft' ? (lastAction === 'reject' ? 'rejected' : 'in_progress') : status === 'submitted' ? 'submitted' : 'approved';

async function tasksOf(db: Db, cycleId: string) {
  const rows = (
    await db.query(
      `SELECT t.id, t.reasons, t.due_date, t.assignee_id, au.name AS assignee_name, e.id AS equipment_id, e.code, e.name,
              d.name AS department_name, c.fiscal_year_be, to_jsonb(a) AS record, lr.action AS last_action, lr.reason AS last_reason,
              lr.at AS last_action_at, lu.name AS last_actor_name
         FROM assessment_task t
         JOIN assessment_cycle c ON c.id = t.cycle_id
         JOIN equipment e ON e.id = t.equipment_id
         JOIN department d ON d.id = e.department_id
         LEFT JOIN app_user au ON au.id = t.assignee_id
         LEFT JOIN annual_record a ON a.equipment_id = t.equipment_id AND a.fiscal_year_be = c.fiscal_year_be
         LEFT JOIN LATERAL (SELECT action, reason, at, actor_id FROM review_action WHERE annual_record_id = a.id ORDER BY at DESC, id DESC LIMIT 1) lr ON true
         LEFT JOIN app_user lu ON lu.id = lr.actor_id
        WHERE t.cycle_id = $1
        ORDER BY t.due_date, e.code`,
      [cycleId],
    )
  ).rows;
  return rows.map((r) => {
    const rec = r.record as Record<string, unknown> | null;
    const status = derived((rec?.status as string) ?? null, r.last_action);
    return {
      id: r.id,
      equipment: { id: r.equipment_id, code: r.code, name: r.name, department: r.department_name },
      reasons: (r.reasons as string[]).map((x) => ({ code: x, label: REASON_LABEL[x] ?? x })),
      dueDate: r.due_date,
      assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name } : null,
      recordId: (rec?.id as string) ?? null,
      status,
      statusLabel: TASK_STATUS_LABEL[status],
      completeness: rec ? evaluate(rowToBody(rec), r.fiscal_year_be).completeness : 0,
      rejection: status === 'rejected' ? { reason: r.last_reason, at: r.last_action_at, by: r.last_actor_name } : null,
    };
  });
}

const summary = (tasks: { status: string }[]) => {
  const s: Record<string, number> = { total: tasks.length, not_started: 0, in_progress: 0, rejected: 0, submitted: 0, approved: 0 };
  for (const t of tasks) s[t.status] = (s[t.status] ?? 0) + 1;
  return s;
};

export async function cycleRoutes(app: FastifyInstance, { pool }: AppDeps) {
  app.get('/api/cycles', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    return withTx(pool, u.scope, async (db) => {
      const cycles = (
        await db.query(
          `SELECT c.*, h.name AS hospital_name FROM assessment_cycle c JOIN hospital h ON h.id = c.hospital_id
            ORDER BY c.fiscal_year_be DESC, h.name`,
        )
      ).rows;
      const out = [];
      for (const c of cycles) out.push({ ...c, period: fiscalRange(c.fiscal_year_be), planFiscalYear: c.fiscal_year_be + 1, summary: summary(await tasksOf(db, c.id)) });
      return { currentFiscalYear: fiscalYearOf(new Date()), suggestedFiscalYear: fiscalYearOf(new Date()) - 1, cycles: out };
    });
  });

  /** เปิดรอบประเมิน (N-03: ค่าเริ่มต้น 1–31 ต.ค. หลังสิ้นปีงบ) และสร้างรายการครบกำหนด */
  app.post('/api/cycles', async (req, reply) => {
    const u = requirePerm(req, 'cycle.manage');
    if (!u.hospitalId) throw new HttpError(403, 'เปิดรอบประเมินได้เฉพาะผู้ดูแลระบบของโรงพยาบาล');
    const b = z
      .object({ fiscalYearBe: z.number().int().min(2500).max(2700), opensAt: DateStr.optional(), closesAt: DateStr.optional() })
      .parse(req.body);
    if (b.fiscalYearBe > fiscalYearOf(new Date())) throw new HttpError(400, 'เปิดรอบของปีงบประมาณในอนาคตไม่ได้');
    const ce = b.fiscalYearBe - 543;
    const opensAt = b.opensAt ?? `${ce}-10-01`;
    const closesAt = b.closesAt ?? `${ce}-10-31`;
    if (closesAt < opensAt) throw new HttpError(400, 'วันปิดรับต้องไม่ก่อนวันเปิดรอบ', [{ field: 'closesAt', message: 'วันปิดรับต้องไม่ก่อนวันเปิดรอบ' }]);
    const out = await withTx(pool, u.scope, async (db) => {
      const exists = await db.query('SELECT 1 FROM assessment_cycle WHERE hospital_id = $1 AND fiscal_year_be = $2', [u.hospitalId, b.fiscalYearBe]);
      if (exists.rowCount) throw new HttpError(409, `มีรอบประเมินปีงบ ${b.fiscalYearBe} อยู่แล้ว`);
      const c = (
        await db.query(
          'INSERT INTO assessment_cycle (hospital_id, fiscal_year_be, opens_at, closes_at, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [u.hospitalId, b.fiscalYearBe, opensAt, closesAt, u.id],
        )
      ).rows[0];
      const created = await generateTasks(db, c);
      await writeAudit(db, { hospitalId: u.hospitalId, actorId: u.id, action: 'create', entity: 'assessment_cycle', entityId: c.id, after: { ...c, tasksCreated: created }, ip: req.ip });
      return { ...c, tasksCreated: created };
    });
    return reply.code(201).send(out);
  });

  app.get('/api/cycles/:id/tasks', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const q = z.object({ mine: z.enum(['1', '0']).optional() }).parse(req.query);
    return withTx(pool, u.scope, async (db) => {
      const c = (await db.query('SELECT c.*, h.name AS hospital_name FROM assessment_cycle c JOIN hospital h ON h.id = c.hospital_id WHERE c.id = $1', [id])).rows[0];
      if (!c) throw new HttpError(404, 'ไม่พบรอบประเมิน');
      let tasks = await tasksOf(db, id);
      if (q.mine === '1') tasks = tasks.filter((t) => t.assignee?.id === u.id);
      return { cycle: { ...c, period: fiscalRange(c.fiscal_year_be), planFiscalYear: c.fiscal_year_be + 1 }, summary: summary(tasks), tasks };
    });
  });

  /** เพิ่มรายการให้ครุภัณฑ์ที่ลงทะเบียนหลังเปิดรอบ */
  app.post('/api/cycles/:id/regenerate', async (req) => {
    const u = requirePerm(req, 'cycle.manage');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTx(pool, u.scope, async (db) => {
      const c = (await db.query('SELECT * FROM assessment_cycle WHERE id = $1', [id])).rows[0];
      if (!c) throw new HttpError(404, 'ไม่พบรอบประเมิน');
      if (c.status !== 'open') throw new HttpError(409, 'รอบประเมินปิดแล้ว');
      const created = await generateTasks(db, c);
      if (created) await writeAudit(db, { hospitalId: c.hospital_id, actorId: u.id, action: 'regenerate', entity: 'assessment_cycle', entityId: id, after: { tasksCreated: created }, ip: req.ip });
      return { tasksCreated: created };
    });
  });

  /** ปิดรอบ: ล็อกข้อมูลที่ยืนยันแล้วของปีงบนั้น รายการที่ยังไม่ยืนยันจะแจ้งไว้ */
  app.post('/api/cycles/:id/close', async (req) => {
    const u = requirePerm(req, 'cycle.manage');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    return withTx(pool, u.scope, async (db) => {
      const c = (await db.query('SELECT * FROM assessment_cycle WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw new HttpError(404, 'ไม่พบรอบประเมิน');
      if (c.status !== 'open') throw new HttpError(409, 'รอบประเมินปิดแล้ว');
      const locked = await db.query(
        `UPDATE annual_record SET status = 'locked', version = version + 1
          WHERE hospital_id = $1 AND fiscal_year_be = $2 AND status = 'approved'
            AND equipment_id IN (SELECT equipment_id FROM assessment_task WHERE cycle_id = $3) RETURNING id`,
        [c.hospital_id, c.fiscal_year_be, id],
      );
      for (const r of locked.rows)
        await db.query("INSERT INTO review_action (hospital_id, annual_record_id, action, reason, actor_id) VALUES ($1,$2,'lock','ปิดรอบประเมิน',$3)", [c.hospital_id, r.id, u.id]);
      await db.query("UPDATE assessment_cycle SET status = 'closed', closed_at = now() WHERE id = $1", [id]);
      // เก็บผลประเมิน ณ วันปิดรอบ (ประวัติการประเมิน) พร้อม snapshot ข้อมูลที่ใช้และเวอร์ชันสูตร
      const f = await currentFormulaSet(db);
      const ids = (await db.query('SELECT equipment_id FROM assessment_task WHERE cycle_id = $1', [id])).rows.map((r) => r.equipment_id);
      let snapshots = 0;
      for (const r of await scoreAll(db, c.fiscal_year_be, f.fs, { hospitalId: c.hospital_id })) {
        if (r.outcome.status !== 'scored' || !ids.includes(r.equipment.id)) continue;
        const b = r.outcome.breakdown;
        await db.query(
          `INSERT INTO score_result (hospital_id, equipment_id, formula_set_id, basis, period_from, period_to, inputs_snapshot, breakdown,
             utility_score, recommendation, warning, cycle_id, analysis_year, rank)
           VALUES ($1,$2,$3,'cumulative',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [c.hospital_id, r.equipment.id, f.id, r.outcome.years[0], c.fiscal_year_be, { ...r.outcome.inputs, years: r.outcome.years }, b,
           b.utilityScore, b.recommendation, b.warning, id, c.fiscal_year_be, r.rank],
        );
        snapshots++;
      }
      const s = summary(await tasksOf(db, id));
      await writeAudit(db, { hospitalId: c.hospital_id, actorId: u.id, action: 'close', entity: 'assessment_cycle', entityId: id, after: { locked: locked.rowCount, scoreSnapshots: snapshots, formula: f.version, summary: s }, ip: req.ip });
      return { locked: locked.rowCount, notApproved: s.total! - s.approved!, scoreSnapshots: snapshots, summary: s };
    });
  });

  /** มอบหมายผู้รับผิดชอบ / เปลี่ยนกำหนดส่ง */
  app.put('/api/tasks/:id', async (req) => {
    const u = requirePerm(req, 'cycle.manage');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z.object({ assigneeId: Uuid.nullable().optional(), dueDate: DateStr.optional() }).parse(req.body);
    return withTx(pool, u.scope, async (db) => {
      const t = (await db.query('SELECT * FROM assessment_task WHERE id = $1', [id])).rows[0];
      if (!t) throw new HttpError(404, 'ไม่พบรายการ');
      if (b.assigneeId) {
        const ok = await db.query(
          `SELECT 1 FROM app_user u JOIN user_role r ON r.user_id = u.id
            WHERE u.id = $1 AND u.hospital_id = $2 AND u.status = 'active' AND r.role IN ('data_entry','hospital_admin')`,
          [b.assigneeId, t.hospital_id],
        );
        if (!ok.rowCount) throw new HttpError(400, 'ผู้รับผิดชอบต้องเป็นเจ้าหน้าที่บันทึกข้อมูลของโรงพยาบาลนี้ที่ใช้งานอยู่');
      }
      const after = (
        await db.query(
          'UPDATE assessment_task SET assignee_id = CASE WHEN $2 THEN $3::uuid ELSE assignee_id END, due_date = coalesce($4, due_date) WHERE id = $1 RETURNING *',
          [id, b.assigneeId !== undefined, b.assigneeId ?? null, b.dueDate ?? null],
        )
      ).rows[0];
      await writeAudit(db, { hospitalId: t.hospital_id, actorId: u.id, action: 'update', entity: 'assessment_task', entityId: id, before: t, after, ip: req.ip });
      return after;
    });
  });

  /** รายชื่อผู้ที่มอบหมายงานได้ */
  app.get('/api/assignees', async (req) => {
    const u = requirePerm(req, 'cycle.manage');
    return withTx(pool, u.scope, async (db) =>
      (
        await db.query(
          `SELECT DISTINCT u.id, u.name FROM app_user u JOIN user_role r ON r.user_id = u.id
            WHERE u.status = 'active' AND u.hospital_id = $1 AND r.role IN ('data_entry','hospital_admin') ORDER BY u.name`,
          [u.hospitalId],
        )
      ).rows,
    );
  });
}
