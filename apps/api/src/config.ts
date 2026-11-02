import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'ต้องกำหนด DATABASE_URL'),
  AUTH_MODE: z.enum(['dev', 'oidc']).default('dev'),
  SESSION_HOURS: z.coerce.number().positive().default(8),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().optional(),
});
export type Config = z.infer<typeof Env> & { devLoginEnabled: boolean; oidcConfigured: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = Env.parse(env);
  if (c.NODE_ENV === 'production' && c.AUTH_MODE === 'dev')
    throw new Error('AUTH_MODE=dev ใช้ใน production ไม่ได้ ต้องตั้งค่า Provider ID (AUTH_MODE=oidc)');
  return {
    ...c,
    // เข้าสู่ระบบจำลองใช้ได้เฉพาะเครื่องพัฒนา/ทดสอบ
    devLoginEnabled: c.AUTH_MODE === 'dev' && c.NODE_ENV !== 'production',
    oidcConfigured: Boolean(c.OIDC_ISSUER && c.OIDC_CLIENT_ID && c.OIDC_CLIENT_SECRET && c.OIDC_REDIRECT_URI),
  };
}
