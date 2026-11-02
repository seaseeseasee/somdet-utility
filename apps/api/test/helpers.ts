import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../scripts/migrate.js';
import { seedDemo } from '../scripts/seed-dev.js';

/**
 * สร้างฐานข้อมูลทดสอบใหม่ทุกครั้ง: TEST_PG_ADMIN_URL ต้องเป็นบัญชีที่สร้าง database ได้
 * ค่าเริ่มต้นตรงกับ Postgres ทดสอบบนเครื่อง (port 5433)
 */
export async function setupTestEnv(overrides: Record<string, string> = {}, seedOpts: { annual?: boolean } = {}) {
  const base = process.env.TEST_PG_ADMIN_URL ?? 'postgres://mu_owner@127.0.0.1:5433/postgres';
  const dbName = `mu_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = new pg.Client({ connectionString: base });
  await root.connect();
  await root.query(`CREATE DATABASE ${dbName}`);
  await root.end();
  const adminUrl = base.replace(/\/[^/]*$/, `/${dbName}`);
  const appPassword = 'test_app_pw';
  await migrate(adminUrl, appPassword, () => undefined);
  const seed = await seedDemo(adminUrl, () => undefined, seedOpts);
  const u = new URL(adminUrl);
  u.username = 'mu_app';
  u.password = appPassword;
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: u.toString(), AUTH_MODE: 'dev', ...overrides });
  const pool = createPool(config.DATABASE_URL);
  const app = await buildApp({ pool, config });
  const teardown = async () => {
    await app.close();
    await pool.end();
    const r = new pg.Client({ connectionString: base });
    await r.connect();
    await r.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await r.end();
  };
  const login = async (providerId: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: { 'x-mu-csrf': '1' }, payload: { providerId } });
    if (res.statusCode !== 200) throw new Error(`login ${providerId}: ${res.statusCode} ${res.body}`);
    const c = res.cookies.find((c) => c.name === 'mu_session')!;
    return { cookie: `mu_session=${c.value}`, raw: c };
  };
  const as = (cookie: string) => ({
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie } }),
    post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object, headers: { cookie, 'x-mu-csrf': '1' } }),
    put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object, headers: { cookie, 'x-mu-csrf': '1' } }),
  });
  return { app, pool, config, seed, adminUrl, teardown, login, as };
}
