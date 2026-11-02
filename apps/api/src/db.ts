import pg from 'pg';

// NUMERIC → number, DATE → 'YYYY-MM-DD' (ไม่แปลงเป็นเวลาท้องถิ่น)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export type Scope = { scope: 'all' | 'hospital' | 'auth'; hospitalId?: string | null };
export type Db = pg.PoolClient;

export function createPool(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // การเชื่อมต่อที่ว่างอยู่หลุด (เช่น ฐานข้อมูลรีสตาร์ท) ต้องไม่ทำให้ทั้งโปรเซสล่ม — pool จะเชื่อมต่อใหม่เอง
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return pool;
}

/**
 * ทุกคำสั่งของแอปทำใน transaction ที่ตั้งค่า app.scope และ app.hospital_id
 * เพื่อให้ Row-Level Security ของ PostgreSQL กรองข้อมูลตามโรงพยาบาลอีกชั้นหนึ่ง
 */
export async function withTx<T>(pool: pg.Pool, s: Scope, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.scope', $1, true), set_config('app.hospital_id', $2, true)", [
      s.scope,
      s.hospitalId ?? '',
    ]);
    const r = await fn(db);
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    db.release();
  }
}
