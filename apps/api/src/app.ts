import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type pg from 'pg';
import { csrfGuard, SESSION_COOKIE, userFromSession } from './auth.js';
import type { Config } from './config.js';
import { errorHandler } from './errors.js';
import { annualRoutes } from './routes/annual.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { equipmentRoutes } from './routes/equipment.js';
import { formulaRoutes } from './routes/formula.js';
import { orgRoutes } from './routes/org.js';
import { reportRoutes } from './routes/reports.js';
import { scoreRoutes } from './routes/scores.js';
import { utilityRoutes } from './routes/utility.js';

export interface AppDeps {
  pool: pg.Pool;
  config: Config;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie'] },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  app.setErrorHandler(errorHandler);
  app.decorateRequest('user', null);
  app.addHook('onRequest', csrfGuard);
  app.addHook('preHandler', async (req) => {
    req.user = await userFromSession(deps.pool, req.cookies[SESSION_COOKIE]);
  });

  app.get('/api/health', async () => ({ ok: true }));
  await authRoutes(app, deps);
  await orgRoutes(app, deps);
  await equipmentRoutes(app, deps);
  await formulaRoutes(app, deps);
  await annualRoutes(app, deps);
  await scoreRoutes(app, deps);
  await dashboardRoutes(app, deps);
  await reportRoutes(app, deps);
  await utilityRoutes(app, deps);
  return app;
}
