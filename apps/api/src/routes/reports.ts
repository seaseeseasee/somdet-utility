import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requirePerm, type CurrentUser } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx } from '../db.js';
import { buildReportData, ReportQuery, SECTION_LABEL, SECTIONS, type ReportData } from '../reports/data.js';
import { renderReportHtml } from '../reports/html.js';
import { closePdfBrowser, htmlToPdf } from '../reports/pdf.js';
import { buildWorkbook } from '../reports/xlsx.js';
import type { AppDeps } from '../app.js';

export async function reportRoutes(app: FastifyInstance, { pool }: AppDeps) {
  app.addHook('onClose', closePdfBrowser);

  const load = async (req: FastifyRequest) => {
    const u = requirePerm(req, 'report.export');
    const q = ReportQuery.parse(req.query);
    const data = await withTx(pool, u.scope, (db) => buildReportData(db, u, q));
    return { u, q, data };
  };
  const fileName = (d: ReportData, ext: string) => `Utility_Report_${d.year}_${new Date().toISOString().slice(0, 10)}.${ext}`;
  const logExport = (req: FastifyRequest, u: CurrentUser, d: ReportData, format: string, q: ReportQuery) =>
    withTx(pool, u.scope, (db) =>
      writeAudit(db, {
        hospitalId: q.hospitalId ?? u.hospitalId, actorId: u.id, action: 'export', entity: 'report', entityId: null,
        after: { format, year: d.year, scope: d.scopeLabel, sections: d.sections, rows: d.rows.length, formula: d.formulaVersion, file: fileName(d, format) },
        ip: req.ip, userAgent: req.headers['user-agent'],
      }),
    );

  app.get('/api/reports/options', async (req) => {
    requirePerm(req, 'report.export');
    return { sections: SECTIONS.map((s) => ({ key: s, label: SECTION_LABEL[s] })) };
  });

  /** ตัวอย่างก่อนพิมพ์: HTML ชุดเดียวกับที่ใช้สร้าง PDF */
  app.get('/api/reports/executive/preview', async (req, reply) => {
    const { data } = await load(req);
    reply.header('content-type', 'text/html; charset=utf-8').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:");
    return renderReportHtml(data);
  });

  app.get('/api/reports/executive.pdf', async (req, reply) => {
    const { u, q, data } = await load(req);
    const pdf = await htmlToPdf(renderReportHtml(data), `${data.scopeLabel} · ชุดสูตร v${data.formulaVersion} · ปีงบ ${data.year}`);
    await logExport(req, u, data, 'pdf', q);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${fileName(data, 'pdf')}"`).send(pdf);
  });

  app.get('/api/reports/executive.xlsx', async (req, reply) => {
    const { u, q, data } = await load(req);
    const buf = await buildWorkbook(data);
    await logExport(req, u, data, 'xlsx', q);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${fileName(data, 'xlsx')}"`)
      .send(buf);
  });

  /** รายงานที่ส่งออกล่าสุดในขอบเขตของผู้ใช้ */
  app.get('/api/reports/recent', async (req) => {
    const u = requirePerm(req, 'report.export');
    return withTx(pool, u.scope, async (db) =>
      (
        await db.query(
          `SELECT a.at, a.after, u.name AS actor_name FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_id
            WHERE a.entity = 'report' AND a.action = 'export' ORDER BY a.id DESC LIMIT 10`,
        )
      ).rows,
    );
  });
}
