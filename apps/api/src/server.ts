import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp({ pool, config });
if (config.devLoginEnabled) app.log.warn('AUTH_MODE=dev: เปิดการเข้าสู่ระบบจำลองสำหรับพัฒนาเท่านั้น ไม่ใช่ Provider ID');
await app.listen({ port: config.PORT, host: config.HOST });
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
