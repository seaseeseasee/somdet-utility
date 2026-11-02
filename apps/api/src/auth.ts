import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTx, type Db, type Scope } from './db.js';
import { HttpError } from './errors.js';

export const ROLES = ['central_admin', 'central_executive', 'hospital_admin', 'data_entry', 'reviewer', 'executive'] as const;
export type Role = (typeof ROLES)[number];
export const CENTRAL_ROLES: Role[] = ['central_admin', 'central_executive'];
export const HOSPITAL_ROLES: Role[] = ['hospital_admin', 'data_entry', 'reviewer', 'executive'];

export const ROLE_LABEL: Record<Role, string> = {
  central_admin: 'ผู้ดูแลระบบส่วนกลาง',
  central_executive: 'ผู้บริหารส่วนกลาง',
  hospital_admin: 'ผู้ดูแลระบบโรงพยาบาล',
  data_entry: 'เจ้าหน้าที่บันทึกข้อมูล',
  reviewer: 'ผู้ตรวจสอบ',
  executive: 'ผู้บริหารโรงพยาบาล',
};

/** สิทธิ์ตาม Role Permission Matrix (docs หน้า 9) */
export const PERMISSIONS = {
  'dashboard.view': ROLES,
  'report.export': ROLES,
  'equipment.read': ROLES,
  'equipment.write': ['hospital_admin', 'data_entry'],
  'equipment.code.change': ['hospital_admin'],
  'annual.write': ['hospital_admin', 'data_entry'],
  'annual.review': ['hospital_admin', 'reviewer'],
  'annual.unlock': ['hospital_admin'],
  'cycle.manage': ['hospital_admin'],
  'users.manage': ['central_admin', 'hospital_admin'],
  'hospital.manage': ['central_admin'],
  'department.manage': ['central_admin', 'hospital_admin'],
  'formula.manage': ['central_admin'],
  'audit.view': ['central_admin', 'central_executive', 'hospital_admin', 'reviewer', 'executive'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export interface CurrentUser {
  id: string;
  providerId: string;
  name: string;
  hospitalId: string | null;
  departmentId: string | null;
  roles: Role[];
  scope: Scope;
}

export const can = (u: CurrentUser, p: Permission) => u.roles.some((r) => (PERMISSIONS[p] as readonly Role[]).includes(r));
export const permissionsOf = (u: CurrentUser) => (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(u, p));

export const SESSION_COOKIE = 'mu_session';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function scopeOf(hospitalId: string | null, roles: Role[]): Scope {
  if (hospitalId === null && roles.some((r) => CENTRAL_ROLES.includes(r))) return { scope: 'all' };
  if (hospitalId) return { scope: 'hospital', hospitalId };
  // ผู้ใช้ที่ไม่มีโรงพยาบาลและไม่มีบทบาทส่วนกลาง: ไม่เห็นข้อมูลใด
  return { scope: 'hospital', hospitalId: '00000000-0000-0000-0000-000000000000' };
}

async function loadUser(db: Db, where: string, arg: string): Promise<(CurrentUser & { status: string }) | null> {
  const r = await db.query(
    `SELECT u.id, u.provider_id, u.name, u.hospital_id, u.department_id, u.status,
            coalesce(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
       FROM app_user u LEFT JOIN user_role ur ON ur.user_id = u.id
      WHERE ${where} GROUP BY u.id`,
    [arg],
  );
  const row = r.rows[0];
  if (!row) return null;
  const roles = row.roles as Role[];
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    hospitalId: row.hospital_id,
    departmentId: row.department_id,
    roles,
    status: row.status,
    scope: scopeOf(row.hospital_id, roles),
  };
}

export const findUserByProviderId = (db: Db, providerId: string) => loadUser(db, 'u.provider_id = $1', providerId);

export async function createSession(pool: pg.Pool, userId: string, hours: number, ip?: string, ua?: string) {
  const token = randomBytes(32).toString('base64url');
  await withTx(pool, { scope: 'auth' }, (db) =>
    db.query(
      `INSERT INTO session (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1,$2, now() + make_interval(hours => $3), $4, $5)`,
      [sha256(token), userId, hours, ip ?? null, ua?.slice(0, 300) ?? null],
    ),
  );
  return token;
}

export async function destroySession(pool: pg.Pool, token: string) {
  await withTx(pool, { scope: 'auth' }, (db) => db.query('DELETE FROM session WHERE token_hash = $1', [sha256(token)]));
}

export async function userFromSession(pool: pg.Pool, token: string | undefined): Promise<CurrentUser | null> {
  if (!token) return null;
  return withTx(pool, { scope: 'auth' }, async (db) => {
    const s = await db.query('SELECT user_id FROM session WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
    const userId = s.rows[0]?.user_id as string | undefined;
    if (!userId) return null;
    const u = await loadUser(db, 'u.id = $1', userId);
    if (!u || u.status !== 'active') return null;
    const { status: _s, ...user } = u;
    return user;
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    user: CurrentUser | null;
  }
}

export function requireUser(req: FastifyRequest): CurrentUser {
  if (!req.user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  return req.user;
}

export function requirePerm(req: FastifyRequest, p: Permission): CurrentUser {
  const u = requireUser(req);
  if (!can(u, p)) throw new HttpError(403, 'ท่านไม่มีสิทธิ์ดำเนินการนี้');
  return u;
}

/** ป้องกัน CSRF: คำขอที่เปลี่ยนข้อมูลต้องมี header นี้ (เบราว์เซอร์ส่งข้ามโดเมนไม่ได้หากไม่เปิด CORS) */
export async function csrfGuard(req: FastifyRequest, reply: FastifyReply) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-mu-csrf'] !== '1') {
    reply.code(403).send({ error: 'คำขอไม่ถูกต้อง (CSRF)' });
  }
}
