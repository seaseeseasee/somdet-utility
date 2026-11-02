import type { FastifyInstance } from 'fastify';
import { computeScore, IncompleteDataError } from '@mu/formula';
import { currentFormulaSet } from '../scoring.js';
import { z } from 'zod';
import { requirePerm, requireUser } from '../auth.js';
import { verifyAudit } from '../audit.js';
import { withTx } from '../db.js';
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
