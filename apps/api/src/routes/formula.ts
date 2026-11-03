import type { FastifyInstance } from 'fastify';
import { computeScore, currentYearOf, formulaSetFromDefinition, IncompleteDataError } from '@mu/formula';
import { currentFormulaSet } from '../scoring.js';
import { z } from 'zod';
import { requirePerm, requireUser } from '../auth.js';
import { verifyAudit, writeAudit } from '../audit.js';
import { withTx } from '../db.js';
import { HttpError } from '../errors.js';
import type { AppDeps } from '../app.js';

const Num = z.coerce.number();

export async function formulaRoutes(app: FastifyInstance, { pool }: AppDeps) {
  app.get('/api/formula-sets/current', async (req) => {
    const u = requireUser(req);
    const row = await withTx(pool, u.scope, async (db) =>
      (await db.query("SELECT version, definition, status, approved_at FROM formula_set WHERE status = 'approved' ORDER BY approved_at DESC LIMIT 1")).rows[0],
    );
    return row;
  });

  /** ชุดสูตรที่ใช้อยู่ (ค่าที่ใช้คำนวณจริง) + ประวัติทุกเวอร์ชัน */
  app.get('/api/formula-sets', async (req) => {
    const u = requireUser(req);
    return withTx(pool, u.scope, async (db) => {
      const f = await currentFormulaSet(db);
      const history = (
        await db.query(
          `SELECT f.version, f.status, f.approved_at, f.definition, u.name AS approved_by_name, f.approved_by IS NOT NULL AS has_approver
             FROM formula_set f LEFT JOIN app_user u ON u.id = f.approved_by ORDER BY f.created_at DESC`,
        )
      ).rows;
      return {
        current: { version: f.version, weights: f.fs.weights, paybackPenalty: f.fs.paybackPenalty, currentYearBe: f.fs.currentYearBe ?? null, currentYearBeUsed: currentYearOf(f.fs) },
        history,
      };
    });
  });

  /**
   * สร้างชุดสูตรเวอร์ชันใหม่จากชุดที่ใช้อยู่ (ปรับน้ำหนัก 6 ด้าน ตัวคูณ Payback ปีปัจจุบัน) แล้วเปิดใช้ทันที
   * เวอร์ชันเดิมเปลี่ยนเป็น retired (ไม่แก้ไข) เพื่อให้รายงานที่ออกไปแล้วอ้างอิงได้
   */
  app.post('/api/formula-sets', async (req, reply) => {
    const u = requirePerm(req, 'formula.manage');
    const n = z.number().finite();
    const b = z
      .object({
        weights: z.object({ utilization: n, clinical: n, financial: n, reliability: n, satisfaction: n, strategic: n }),
        paybackPenalty: n,
        currentYearBe: z.number().int().nullable(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body);
    const out = await withTx(pool, u.scope, async (db) => {
      const cur = await currentFormulaSet(db);
      const definition = {
        ...cur.definition, weights: b.weights, paybackPenalty: b.paybackPenalty, currentYearBe: b.currentYearBe,
        change: b.note || 'ปรับสมมติฐานและน้ำหนักคะแนน', basedOn: cur.version,
      };
      const versions = (await db.query('SELECT version FROM formula_set')).rows.map((r) => r.version as string);
      const nextMinor = Math.max(...versions.map((v) => Number(v.split('.')[1] ?? 0))) + 1;
      const version = `1.${nextMinor}`;
      try {
        formulaSetFromDefinition(version, definition);
      } catch (e) {
        const msg = (e as Error).message.replace(/^ชุดสูตร \S+ ไม่ถูกต้อง: /, '');
        throw new HttpError(400, msg, msg.split('; ').map((m) => ({ field: 'weights', message: m })));
      }
      await db.query("UPDATE formula_set SET status = 'retired' WHERE status = 'approved'");
      const r = (
        await db.query("INSERT INTO formula_set (version, definition, status, approved_by, approved_at) VALUES ($1,$2,'approved',$3,now()) RETURNING id", [version, definition, u.id])
      ).rows[0];
      await writeAudit(db, {
        hospitalId: null, actorId: u.id, action: 'create', entity: 'formula_set', entityId: r.id,
        before: { version: cur.version, weights: cur.fs.weights, paybackPenalty: cur.fs.paybackPenalty, currentYearBe: cur.fs.currentYearBe ?? null },
        after: { version, weights: b.weights, paybackPenalty: b.paybackPenalty, currentYearBe: b.currentYearBe, note: definition.change },
        ip: req.ip, userAgent: req.headers['user-agent'],
      });
      return { version };
    });
    return reply.code(201).send(out);
  });

  /** คำนวณตัวอย่างจากค่าที่ส่งมา (ไม่บันทึก) — ใช้แสดง "ที่มาของคะแนน" ระหว่างกรอก */
  app.post('/api/formula/preview', async (req, reply) => {
    const b = z
      .object({
        purchaseYear: Num, purchasePrice: Num, analysisYear: Num, utilizationPct: Num, cases: Num, maintenanceCost: Num,
        downtimePct: Num, revenue: Num, noDirectRevenue: z.boolean().default(false),
        clinicalRating: Num, satisfactionRating: Num, strategicRating: Num, dataYears: Num.optional(),
      })
      .parse(req.body);
    const u = requireUser(req);
    const f = await withTx(pool, u.scope, (db) => currentFormulaSet(db));
    try {
      return computeScore(b, f.fs);
    } catch (e) {
      if (e instanceof IncompleteDataError) return reply.code(422).send({ error: 'ข้อมูลไม่ครบ ยังคำนวณไม่ได้', problems: e.problems });
      throw e;
    }
  });

  app.get('/api/audit/verify', async (req) => {
    const u = requirePerm(req, 'audit.view');
    const q = z.object({ hospitalId: z.string().uuid().optional() }).parse(req.query);
    const hospitalId = u.hospitalId ?? q.hospitalId ?? null;
    return withTx(pool, u.scope, (db) => verifyAudit(db, hospitalId));
  });
}
