/**
 * รัน migration ด้วยบัญชี owner แล้วสร้าง/อัปเดตบัญชีแอป (mu_app) ที่ไม่ใช่ owner เพื่อให้ RLS มีผล
 * ใช้: DATABASE_ADMIN_URL=... DB_APP_PASSWORD=... npm run migrate -w @mu/api
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(adminUrl: string, appPassword: string, log = console.log) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migration')).rows.map((r) => r.name));
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      log(`ใช้ migration ${f}`);
      await c.query('BEGIN');
      await c.query(await readFile(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migration (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
    }
    const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname = 'mu_app'")).rowCount;
    const pw = c.escapeLiteral(appPassword);
    await c.query(exists ? `ALTER ROLE mu_app WITH LOGIN PASSWORD ${pw}` : `CREATE ROLE mu_app LOGIN PASSWORD ${pw} NOSUPERUSER NOBYPASSRLS`);
    await c.query(`GRANT USAGE ON SCHEMA public TO mu_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mu_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mu_app;
      REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM mu_app;
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON formula_set, schema_migration FROM mu_app;`);
    log('migration เสร็จสิ้น');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_ADMIN_URL, pw = process.env.DB_APP_PASSWORD;
  if (!url || !pw) throw new Error('ต้องกำหนด DATABASE_ADMIN_URL และ DB_APP_PASSWORD');
  await migrate(url, pw);
}
