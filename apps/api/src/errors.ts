import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const PG_UNIQUE: Record<string, string> = {
  equipment_hospital_id_code_key: 'รหัสครุภัณฑ์นี้มีอยู่แล้วในโรงพยาบาล',
  equipment_hospital_id_serial_no_key: 'Serial Number นี้มีอยู่แล้วในโรงพยาบาล',
  app_user_provider_id_key: 'Provider ID นี้มีอยู่ในระบบแล้ว',
  hospital_hcode_key: 'รหัสสถานพยาบาลนี้มีอยู่แล้ว',
  department_hospital_id_name_key: 'ชื่อหน่วยงานนี้มีอยู่แล้ว',
};

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, details: err.details });
  if (err instanceof ZodError)
    return reply.code(400).send({
      error: 'ข้อมูลไม่ถูกต้อง',
      issues: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  const pgErr = err as Error & { code?: string; constraint?: string };
  if (pgErr.code === '23505')
    return reply.code(409).send({ error: PG_UNIQUE[pgErr.constraint ?? ''] ?? 'ข้อมูลซ้ำกับที่มีอยู่' });
  if (pgErr.code === '23503') return reply.code(400).send({ error: 'ข้อมูลอ้างอิงไม่ถูกต้อง' });
  if (pgErr.code === '23514') return reply.code(400).send({ error: 'ข้อมูลไม่ผ่านเงื่อนไขของระบบ' });
  if (pgErr.code === '42501') return reply.code(403).send({ error: 'ท่านไม่มีสิทธิ์เข้าถึงข้อมูลนี้' });
  const fe = err as FastifyError;
  if (fe.statusCode && fe.statusCode < 500) return reply.code(fe.statusCode).send({ error: fe.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'เกิดข้อผิดพลาดในระบบ' });
}
