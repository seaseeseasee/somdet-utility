import { z } from 'zod';
import { writeAudit } from './audit.js';
import type { Db } from './db.js';

/**
 * ข้อมูลตัวตนที่ได้จาก Provider ID (ผู้ใช้และหน่วยงานต้นสังกัด)
 * เมื่อเชื่อม OIDC จริงให้แปลง claim ของ Provider ID มาเป็นรูปนี้
 */
export const ProviderClaims = z.object({
  providerId: z.string().trim().min(3).max(100),
  name: z.string().trim().min(1, 'ไม่มีชื่อผู้ใช้จาก Provider ID').max(200),
  hcode: z.string().trim().regex(/^[0-9A-Za-z]{3,10}$/, 'รหัสสถานพยาบาลจาก Provider ID ไม่ถูกต้อง'),
  hospitalName: z.string().trim().min(2, 'ไม่มีชื่อโรงพยาบาลจาก Provider ID').max(200),
});
export type ProviderClaims = z.infer<typeof ProviderClaims>;

/**
 * เข้าสู่ระบบครั้งแรกด้วย Provider ID: ยืนยันโรงพยาบาลจากข้อมูลของ Provider ID (สร้างให้ถ้ายังไม่มี)
 * สร้างบัญชีเจ้าหน้าที่ แล้วระงับเจ้าหน้าที่คนเดิมของโรงพยาบาลนั้น (1 คนต่อโรงพยาบาล คนใหม่แทนคนเดิม)
 */
export async function provisionStaff(db: Db, c: ProviderClaims, ctx: { ip?: string; userAgent?: string }) {
  let hospital = (await db.query('SELECT id FROM hospital WHERE hcode = $1', [c.hcode])).rows[0] as { id: string } | undefined;
  let createdHospital = false;
  if (!hospital) {
    hospital = (await db.query('INSERT INTO hospital (hcode, name) VALUES ($1,$2) RETURNING *', [c.hcode, c.hospitalName])).rows[0];
    createdHospital = true;
  }
  const hospitalId = hospital!.id;
  const user = (
    await db.query("INSERT INTO app_user (provider_id, name, hospital_id, status) VALUES ($1,$2,$3,'active') RETURNING id", [c.providerId, c.name, hospitalId])
  ).rows[0] as { id: string };
  await db.query("INSERT INTO user_role (user_id, role) VALUES ($1,'data_entry')", [user.id]);

  const replaced = (
    await db.query(
      "UPDATE app_user SET status = 'suspended' WHERE hospital_id = $1 AND id <> $2 AND status <> 'suspended' RETURNING id, provider_id, name",
      [hospitalId, user.id],
    )
  ).rows as { id: string; provider_id: string; name: string }[];
  if (replaced.length) await db.query('DELETE FROM session WHERE user_id = ANY($1)', [replaced.map((r) => r.id)]);

  const base = { hospitalId, actorId: user.id, ip: ctx.ip, userAgent: ctx.userAgent };
  if (createdHospital)
    await writeAudit(db, { ...base, action: 'create', entity: 'hospital', entityId: hospitalId, after: { hcode: c.hcode, name: c.hospitalName, via: 'provider_id' } });
  await writeAudit(db, {
    ...base, action: 'create', entity: 'user', entityId: user.id,
    after: { providerId: c.providerId, name: c.name, roles: ['data_entry'], via: 'provider_id', replaced: replaced.map((r) => r.provider_id) },
  });
  for (const r of replaced)
    await writeAudit(db, { ...base, action: 'update', entity: 'user', entityId: r.id, before: { status: 'active' }, after: { status: 'suspended', reason: `แทนที่โดย ${c.providerId}` } });
  return { userId: user.id, createdHospital, replaced };
}
