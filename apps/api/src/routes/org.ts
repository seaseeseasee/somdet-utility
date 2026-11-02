import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CENTRAL_ROLES, HOSPITAL_ROLES, requirePerm, requireUser, ROLES, type Role } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx } from '../db.js';
import { HttpError } from '../errors.js';
import type { AppDeps } from '../app.js';

const Uuid = z.string().uuid();

export async function orgRoutes(app: FastifyInstance, { pool }: AppDeps) {
  // ---------------------------------------------------------------- hospitals
  app.get('/api/hospitals', async (req) => {
    const u = requireUser(req);
    return withTx(pool, u.scope, async (db) => (await db.query('SELECT id, hcode, name, province, status FROM hospital ORDER BY name')).rows);
  });

  app.post('/api/hospitals', async (req, reply) => {
    const u = requirePerm(req, 'hospital.manage');
    const b = z
      .object({ hcode: z.string().trim().regex(/^[0-9A-Za-z]{3,10}$/, 'รหัสสถานพยาบาล 3–10 ตัวอักษร/ตัวเลข'), name: z.string().trim().min(2).max(200), province: z.string().trim().max(100).optional() })
      .parse(req.body);
    const row = await withTx(pool, u.scope, async (db) => {
      const r = (await db.query('INSERT INTO hospital (hcode, name, province) VALUES ($1,$2,$3) RETURNING *', [b.hcode, b.name, b.province ?? null])).rows[0];
      await writeAudit(db, { hospitalId: null, actorId: u.id, action: 'create', entity: 'hospital', entityId: r.id, after: r, ip: req.ip });
      return r;
    });
    return reply.code(201).send(row);
  });

  // ---------------------------------------------------------------- departments
  app.get('/api/departments', async (req) => {
    const u = requireUser(req);
    const q = z.object({ hospitalId: Uuid.optional() }).parse(req.query);
    return withTx(pool, u.scope, async (db) =>
      (await db.query('SELECT id, hospital_id, name FROM department WHERE ($1::uuid IS NULL OR hospital_id = $1) ORDER BY name', [q.hospitalId ?? null])).rows,
    );
  });

  app.post('/api/departments', async (req, reply) => {
    const u = requirePerm(req, 'department.manage');
    const b = z.object({ name: z.string().trim().min(1).max(200), hospitalId: Uuid.optional() }).parse(req.body);
    const hospitalId = u.hospitalId ?? b.hospitalId;
    if (!hospitalId) throw new HttpError(400, 'กรุณาระบุโรงพยาบาล');
    const row = await withTx(pool, u.scope, async (db) => {
      const r = (await db.query('INSERT INTO department (hospital_id, name) VALUES ($1,$2) RETURNING *', [hospitalId, b.name])).rows[0];
      await writeAudit(db, { hospitalId, actorId: u.id, action: 'create', entity: 'department', entityId: r.id, after: r, ip: req.ip });
      return r;
    });
    return reply.code(201).send(row);
  });

  app.get('/api/equipment-types', async (req) => {
    const u = requireUser(req);
    return withTx(pool, u.scope, async (db) => (await db.query('SELECT id, name FROM equipment_type ORDER BY name')).rows);
  });

  // ---------------------------------------------------------------- users
  const userSelect = `SELECT u.id, u.provider_id, u.name, u.hospital_id, h.name AS hospital_name, u.department_id, u.status,
           u.created_at, u.last_login_at, coalesce(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
      FROM app_user u LEFT JOIN user_role ur ON ur.user_id = u.id LEFT JOIN hospital h ON h.id = u.hospital_id`;

  app.get('/api/users', async (req) => {
    const u = requirePerm(req, 'users.manage');
    return withTx(pool, u.scope, async (db) => (await db.query(`${userSelect} GROUP BY u.id, h.name ORDER BY u.name`)).rows);
  });

  /** ตรวจว่าผู้ดูแลกำหนดบทบาทนี้ให้ผู้ใช้นี้ได้หรือไม่ */
  function checkRoles(actor: ReturnType<typeof requireUser>, hospitalId: string | null, roles: Role[]) {
    const central = actor.roles.includes('central_admin');
    if (!central && hospitalId !== actor.hospitalId) throw new HttpError(403, 'จัดการได้เฉพาะผู้ใช้ในโรงพยาบาลของท่าน');
    if (!central && roles.some((r) => CENTRAL_ROLES.includes(r))) throw new HttpError(403, 'กำหนดบทบาทส่วนกลางได้เฉพาะผู้ดูแลระบบส่วนกลาง');
    if (hospitalId === null && roles.some((r) => HOSPITAL_ROLES.includes(r))) throw new HttpError(400, 'บทบาทของโรงพยาบาลต้องระบุโรงพยาบาล');
    if (hospitalId !== null && roles.some((r) => CENTRAL_ROLES.includes(r))) throw new HttpError(400, 'บทบาทส่วนกลางต้องไม่ผูกกับโรงพยาบาล');
  }

  app.post('/api/users', async (req, reply) => {
    const actor = requirePerm(req, 'users.manage');
    const b = z
      .object({
        providerId: z.string().trim().min(3).max(100),
        name: z.string().trim().min(1).max(200),
        hospitalId: Uuid.nullable().optional(),
        departmentId: Uuid.nullable().optional(),
        roles: z.array(z.enum(ROLES)).max(6).default([]),
      })
      .parse(req.body);
    const hospitalId = actor.roles.includes('central_admin') ? (b.hospitalId ?? null) : actor.hospitalId;
    checkRoles(actor, hospitalId, b.roles);
    const row = await withTx(pool, actor.scope, async (db) => {
      const r = (
        await db.query(
          'INSERT INTO app_user (provider_id, name, hospital_id, department_id, status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [b.providerId, b.name, hospitalId, b.departmentId ?? null, b.roles.length ? 'active' : 'pending'],
        )
      ).rows[0];
      for (const role of b.roles) await db.query('INSERT INTO user_role (user_id, role) VALUES ($1,$2)', [r.id, role]);
      const full = (await db.query(`${userSelect} WHERE u.id = $1 GROUP BY u.id, h.name`, [r.id])).rows[0];
      await writeAudit(db, { hospitalId, actorId: actor.id, action: 'create', entity: 'user', entityId: r.id, after: full, ip: req.ip });
      return full;
    });
    return reply.code(201).send(row);
  });

  app.put('/api/users/:id', async (req) => {
    const actor = requirePerm(req, 'users.manage');
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const b = z
      .object({
        status: z.enum(['pending', 'active', 'suspended']).optional(),
        roles: z.array(z.enum(ROLES)).max(6).optional(),
        departmentId: Uuid.nullable().optional(),
      })
      .parse(req.body);
    if (id === actor.id && (b.status === 'suspended' || (b.roles && !b.roles.some((r) => actor.roles.includes(r)))))
      throw new HttpError(400, 'ไม่สามารถระงับหรือลดสิทธิ์ผู้ดูแลของตนเองได้');
    return withTx(pool, actor.scope, async (db) => {
      const before = (await db.query(`${userSelect} WHERE u.id = $1 GROUP BY u.id, h.name`, [id])).rows[0];
      if (!before) throw new HttpError(404, 'ไม่พบผู้ใช้');
      checkRoles(actor, before.hospital_id, b.roles ?? before.roles);
      if (b.status) await db.query('UPDATE app_user SET status = $2 WHERE id = $1', [id, b.status]);
      if (b.departmentId !== undefined) await db.query('UPDATE app_user SET department_id = $2 WHERE id = $1', [id, b.departmentId]);
      if (b.roles) {
        await db.query('DELETE FROM user_role WHERE user_id = $1', [id]);
        for (const role of b.roles) await db.query('INSERT INTO user_role (user_id, role) VALUES ($1,$2)', [id, role]);
      }
      if (b.status === 'suspended') await db.query('DELETE FROM session WHERE user_id = $1', [id]);
      const after = (await db.query(`${userSelect} WHERE u.id = $1 GROUP BY u.id, h.name`, [id])).rows[0];
      await writeAudit(db, { hospitalId: before.hospital_id, actorId: actor.id, action: 'update', entity: 'user', entityId: id, before, after, ip: req.ip });
      return after;
    });
  });
}
