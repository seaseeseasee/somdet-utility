import { createHash } from 'node:crypto';
import type { Db } from './db.js';

export const GENESIS = '0'.repeat(64);

/** JSON แบบเรียง key คงที่ เพื่อให้คำนวณ hash ซ้ำจาก jsonb ได้ */
export function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

const toJson = (v: unknown) => (v === undefined || v === null ? null : JSON.parse(stableStringify(v)));

export interface AuditEntry {
  hospitalId: string | null;
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

function hashOf(prev: string, e: AuditEntry, at: string) {
  return createHash('sha256')
    .update(
      [prev, e.hospitalId ?? '', e.actorId ?? '', e.action, e.entity, e.entityId ?? '', stableStringify(toJson(e.before)), stableStringify(toJson(e.after)), at].join('|'),
    )
    .digest('hex');
}

/** บันทึก audit แบบ hash chain แยกต่อโรงพยาบาล (หรือ chain ส่วนกลางเมื่อ hospital_id = NULL) */
export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  const key = e.hospitalId ?? 'central';
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit:${key}`]);
  const prev = await db.query<{ hash: string }>(
    'SELECT hash FROM audit_log WHERE hospital_id IS NOT DISTINCT FROM $1 ORDER BY id DESC LIMIT 1',
    [e.hospitalId],
  );
  const prevHash = prev.rows[0]?.hash ?? GENESIS;
  const at = new Date().toISOString();
  await db.query(
    `INSERT INTO audit_log (hospital_id, actor_id, action, entity, entity_id, before, after, ip, user_agent, at, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [e.hospitalId, e.actorId, e.action, e.entity, e.entityId ?? null, toJson(e.before), toJson(e.after), e.ip ?? null, e.userAgent ?? null, at, prevHash, hashOf(prevHash, e, at)],
  );
}

/** ตรวจความถูกต้องของ chain — คืนรายการ id ที่ไม่ผ่าน */
export async function verifyAudit(db: Db, hospitalId: string | null): Promise<{ checked: number; broken: number[] }> {
  const r = await db.query(
    `SELECT id, hospital_id, actor_id, action, entity, entity_id, before, after, at, prev_hash, hash
       FROM audit_log WHERE hospital_id IS NOT DISTINCT FROM $1 ORDER BY id`,
    [hospitalId],
  );
  let prev = GENESIS;
  const broken: number[] = [];
  for (const row of r.rows) {
    const at = (row.at as Date).toISOString();
    const h = hashOf(prev, { hospitalId: row.hospital_id, actorId: row.actor_id, action: row.action, entity: row.entity, entityId: row.entity_id, before: row.before, after: row.after }, at);
    if (row.prev_hash !== prev || row.hash !== h) broken.push(row.id);
    prev = row.hash;
  }
  return { checked: r.rows.length, broken };
}
