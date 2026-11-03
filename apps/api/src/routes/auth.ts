import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  findUserByProviderId,
  permissionsOf,
  requireUser,
  ROLE_LABEL,
  SESSION_COOKIE,
} from '../auth.js';
import { writeAudit } from '../audit.js';
import { ProviderClaims, provisionStaff } from '../provision.js';
import { withTx } from '../db.js';
import { HttpError } from '../errors.js';
import type { AppDeps } from '../app.js';

export async function authRoutes(app: FastifyInstance, { pool, config }: AppDeps) {
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.COOKIE_SECURE || config.NODE_ENV === 'production',
    maxAge: config.SESSION_HOURS * 3600,
  };

  app.get('/api/auth/config', async () => ({
    mode: config.AUTH_MODE,
    devLoginEnabled: config.devLoginEnabled,
    oidcConfigured: config.oidcConfigured,
  }));

  /**
   * เข้าสู่ระบบด้วย Provider ID — ยังไม่ได้เชื่อมต่อจริง
   * จะพัฒนาเมื่อได้รับเอกสาร OIDC/OAuth2 และ client_id จากผู้ดูแลระบบ (docs ข้อ 2.6)
   */
  app.get('/api/auth/login', async (_req, reply) => {
    return reply.code(501).send({
      error: 'ยังไม่ได้เชื่อมต่อ Provider ID',
      required: ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'],
      configured: config.oidcConfigured,
    });
  });

  /**
   * เข้าสู่ระบบจำลองสำหรับนักพัฒนาเท่านั้น — ปิดอัตโนมัติเมื่อ NODE_ENV=production
   * ผู้ใช้ใหม่ส่งข้อมูลจำลองของ Provider ID (ชื่อ รหัสและชื่อโรงพยาบาล) มาด้วย เพื่อสร้างบัญชีเจ้าหน้าที่อัตโนมัติ
   */
  app.post(
    '/api/auth/dev-login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!config.devLoginEnabled) throw new HttpError(404, 'ไม่พบหน้านี้');
      const b = z
        .object({ providerId: z.string().trim().min(3).max(100), name: z.string().optional(), hcode: z.string().optional(), hospitalName: z.string().optional() })
        .parse(req.body);
      let u = await withTx(pool, { scope: 'auth' }, (db) => findUserByProviderId(db, b.providerId));
      if (!u && b.hcode) {
        const claims = ProviderClaims.parse(b);
        await withTx(pool, { scope: 'all' }, (db) => provisionStaff(db, claims, { ip: req.ip, userAgent: req.headers['user-agent'] }));
        u = await withTx(pool, { scope: 'auth' }, (db) => findUserByProviderId(db, b.providerId));
      }
      if (!u) throw new HttpError(404, 'ไม่พบผู้ใช้นี้ในระบบ และไม่มีข้อมูลโรงพยาบาลจาก Provider ID');
      if (u.status === 'pending') throw new HttpError(403, 'บัญชีรอผู้ดูแลระบบอนุมัติและกำหนดบทบาท');
      if (u.status !== 'active') throw new HttpError(403, 'บัญชีถูกระงับการใช้งาน');
      const token = await createSession(pool, u.id, config.SESSION_HOURS, req.ip, req.headers['user-agent']);
      await withTx(pool, u.scope, async (db) => {
        await db.query('UPDATE app_user SET last_login_at = now() WHERE id = $1', [u.id]);
        await writeAudit(db, {
          hospitalId: u.hospitalId, actorId: u.id, action: 'login', entity: 'session', entityId: u.id,
          after: { method: 'dev-login' }, ip: req.ip, userAgent: req.headers['user-agent'],
        });
      });
      reply.setCookie(SESSION_COOKIE, token, cookieOpts);
      return { ok: true };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(pool, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const u = requireUser(req);
    const hospital = u.hospitalId
      ? await withTx(pool, u.scope, async (db) => (await db.query('SELECT id, hcode, name FROM hospital WHERE id = $1', [u.hospitalId])).rows[0] ?? null)
      : null;
    return {
      id: u.id,
      providerId: u.providerId,
      name: u.name,
      hospital,
      roles: u.roles.map((r) => ({ role: r, label: ROLE_LABEL[r] })),
      scope: u.scope.scope,
      permissions: permissionsOf(u),
    };
  });
}
