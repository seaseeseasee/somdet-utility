import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePerm, type CurrentUser } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withTx } from '../db.js';
import { HttpError } from '../errors.js';
import { buildPreview, checkFile, clean, LIMITS, parseWorkbook, sha256, type ParsedSettings, type PreviewSheet } from '../utility/parse.js';
import { matchKey, registrar } from '../utility/register.js';
import { currentYearOf, scoreDataset, type ScoringSettings } from '../utility/score.js';
import { activeSettings } from '../utility/settings.js';
import type { AppDeps } from '../app.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const Uuid = z.string().uuid();

/** Preview ที่ยังไม่ยืนยัน เก็บในหน่วยความจำ 30 นาที ผูกกับผู้ใช้ที่อัปโหลด (ไม่เก็บเนื้อหาไฟล์) */
interface PendingImport {
  userId: string; hospitalId: string; filename: string; sha: string; createdAt: number;
  sheets: PreviewSheet[]; fileSettings: ParsedSettings | null; activeSettings: ScoringSettings & { id: string };
}
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const pending = new Map<string, PendingImport>();
const sweep = () => {
  for (const [k, v] of pending) if (Date.now() - v.createdAt > PREVIEW_TTL_MS) pending.delete(k);
  while (pending.size > 200) pending.delete(pending.keys().next().value!);
};

/** โรงพยาบาลของการนำเข้า: เจ้าหน้าที่ = โรงพยาบาลของตน, ส่วนกลาง = ต้องระบุ hospitalId */
function targetHospital(u: CurrentUser, hospitalId?: string) {
  if (u.hospitalId) return u.hospitalId;
  if (!hospitalId) throw new HttpError(400, 'กรุณาเลือกโรงพยาบาลที่จะนำเข้าข้อมูล');
  return hospitalId;
}

const differs = (a: ScoringSettings, b: ScoringSettings) =>
  (Object.keys(a.weights) as (keyof ScoringSettings['weights'])[]).some((k) => Math.abs(a.weights[k] - b.weights[k]) > 1e-9) ||
  a.paybackPenalty !== b.paybackPenalty;

export async function utilityRoutes(app: FastifyInstance, { pool }: AppDeps) {
  // รับไฟล์เป็น body ตรง (ไม่ต้องเพิ่ม library multipart) ชื่อไฟล์ส่งใน header x-filename
  app.addContentTypeParser([XLSX_MIME, 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: LIMITS.maxBytes }, (_req, body, done) => done(null, body));

  app.post(
    '/api/utility/import/preview',
    { bodyLimit: LIMITS.maxBytes, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req: FastifyRequest) => {
      const u = requirePerm(req, 'utility.import');
      const { hospitalId: qh } = z.object({ hospitalId: Uuid.optional() }).parse(req.query);
      if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'กรุณาอัปโหลดไฟล์ .xlsx');
      const buf = req.body;
      let filename = '';
      try {
        filename = clean(decodeURIComponent(String(req.headers['x-filename'] ?? ''))).slice(0, 200);
      } catch {
        throw new HttpError(400, 'ชื่อไฟล์ไม่ถูกต้อง');
      }
      checkFile(buf, filename);
      const hospitalId = targetHospital(u, qh);
      const sha = sha256(buf);
      const wb = await parseWorkbook(buf);

      const { settings, previous, hospital } = await withTx(pool, u.scope, async (db) => ({
        settings: await activeSettings(db),
        hospital: (await db.query('SELECT id, name FROM hospital WHERE id = $1', [hospitalId])).rows[0],
        previous: (
          await db.query(
            `SELECT b.id, b.filename, b.uploaded_at, au.name AS uploaded_by_name FROM utility_import_batch b
               LEFT JOIN app_user au ON au.id = b.uploaded_by WHERE b.hospital_id = $1 AND b.file_sha256 = $2 ORDER BY b.uploaded_at DESC`,
            [hospitalId, sha],
          )
        ).rows,
      }));
      if (!hospital) throw new HttpError(404, 'ไม่พบโรงพยาบาล');

      const sheets = buildPreview(wb, settings);
      sweep();
      const token = randomBytes(24).toString('base64url');
      pending.set(token, { userId: u.id, hospitalId, filename, sha, createdAt: Date.now(), sheets, fileSettings: wb.settings, activeSettings: settings });

      const notices: string[] = [];
      if (previous.length) notices.push(`ไฟล์นี้เคยนำเข้าแล้ว ${previous.length} ครั้ง (ล่าสุด ${new Date(previous[0].uploaded_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}) ตรวจสอบก่อนยืนยันเพื่อไม่ให้ข้อมูลซ้ำ`);
      if (wb.settings?.problems.length) notices.push(`ไม่นำชุดน้ำหนักจากชีต "สมมติฐาน" มาใช้: ${wb.settings.problems.join('; ')}`);
      else if (wb.settings?.values && differs(wb.settings.values, settings))
        notices.push(`น้ำหนักในชีต "สมมติฐาน" ต่างจากชุดสูตรที่ระบบใช้ (v${settings.version}) ระบบคำนวณด้วยชุดสูตรของระบบ และเก็บค่าจากไฟล์ไว้คู่กับการนำเข้านี้ · ผู้ดูแลระบบส่วนกลางปรับชุดสูตรได้ที่หน้า "สมมติฐานและน้ำหนักคะแนน"`);
      return {
        previewToken: token,
        expiresInMinutes: PREVIEW_TTL_MS / 60000,
        filename,
        hospital,
        duplicateOf: previous,
        notices,
        settings: { active: settings, currentYearBe: currentYearOf(settings), fromFile: wb.settings },
        ignoredSheets: wb.ignoredSheets,
        sheets,
      };
    },
  );

  app.post('/api/utility/import/commit', async (req) => {
    const u = requirePerm(req, 'utility.import');
    const b = z
      .object({ previewToken: z.string().min(10).max(100), selectedSheets: z.array(z.string()).min(1, 'กรุณาเลือกอย่างน้อย 1 ชีต'), mode: z.enum(['append', 'replace']) })
      .parse(req.body);
    const p = pending.get(b.previewToken);
    if (!p || p.userId !== u.id || Date.now() - p.createdAt > PREVIEW_TTL_MS)
      throw new HttpError(410, 'Preview หมดอายุหรือไม่พบ กรุณาอัปโหลดไฟล์ใหม่');
    const chosen = p.sheets.filter((s) => b.selectedSheets.includes(s.sheet));
    if (chosen.length !== new Set(b.selectedSheets).size) throw new HttpError(400, 'มีชีตที่เลือกไม่อยู่ในไฟล์');

    const result = await withTx(pool, u.scope, async (db) => {
      const settings = await activeSettings(db);
      const rows = chosen.flatMap((s) => s.rows.filter((r) => r.status !== 'error').map((r) => ({ s, r })));
      const batch = (
        await db.query(
          `INSERT INTO utility_import_batch (hospital_id, filename, file_sha256, uploaded_by, mode, sheets, settings_snapshot, row_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [p.hospitalId, p.filename, p.sha, u.id, b.mode, chosen.map((s) => s.sheet),
           { active: settings, currentYearBe: currentYearOf(settings), fromFile: p.fileSettings, providerId: u.providerId }, rows.length],
        )
      ).rows[0] as { id: string };
      // โหมดแทนที่: ใช้ครุภัณฑ์เดิมที่สร้างจากการนำเข้าครั้งก่อนต่อ เมื่อชื่อ+ปี+ราคาตรงกัน (ไม่สร้างซ้ำในทะเบียน)
      const reuse = new Map<string, string[]>();
      const oldEquipment = new Set<string>();
      let replaced = 0;
      if (b.mode === 'replace') {
        const old = (
          await db.query(
            `UPDATE utility_record SET deleted_at = now() WHERE hospital_id = $1 AND dataset = ANY($2) AND deleted_at IS NULL
             RETURNING equipment_id, name, purchase_year_be, purchase_price`,
            [p.hospitalId, chosen.map((s) => s.sheet)],
          )
        ).rows;
        replaced = old.length;
        for (const o of old)
          if (o.equipment_id) {
            oldEquipment.add(o.equipment_id);
            const k = matchKey(o.name, { purchaseYearBe: o.purchase_year_be, purchasePrice: o.purchase_price });
            reuse.set(k, [...(reuse.get(k) ?? []), o.equipment_id]);
          }
      }

      const reg = await registrar(db, { hospitalId: p.hospitalId, userId: u.id, batchId: batch.id });
      let registered = 0;
      const kept = new Set<string>();
      for (const { s, r } of rows) {
        const i = r.input;
        let equipmentId: string | null = null;
        if (r.register) {
          equipmentId = reuse.get(matchKey(r.name, i))?.shift() ?? null;
          if (equipmentId) kept.add(equipmentId);
          else {
            equipmentId = await reg.create(r.name, i);
            registered++;
          }
        }
        await db.query(
          `INSERT INTO utility_record (hospital_id, batch_id, dataset, dataset_title, source_sheet, source_row, seq_no, name, purchase_year_be,
             purchase_price, utilization_pct, total_cases, maintenance_cost_total, downtime_pct, revenue_total, clinical_rating,
             satisfaction_rating, strategic_rating, data_status, equipment_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [p.hospitalId, batch.id, s.sheet, s.title, s.sheet, r.sourceRow, r.seqNo, r.name, i.purchaseYearBe, i.purchasePrice, i.utilizationPct,
           i.totalCases, i.maintenanceCostTotal, i.downtimePct, i.revenueTotal, i.clinicalRating, i.satisfactionRating, i.strategicRating,
           r.status === 'incomplete' ? 'incomplete' : 'complete', equipmentId],
        );
      }
      // ครุภัณฑ์เดิมที่ไม่มีในไฟล์ใหม่: ลบเฉพาะที่ยังเป็นค่าชั่วคราวและไม่มีข้อมูลรายปี ที่เจ้าหน้าที่แก้แล้วเก็บไว้
      const gone = [...oldEquipment].filter((id) => !kept.has(id));
      const removed = gone.length
        ? (
            await db.query(
              `DELETE FROM equipment e WHERE e.id = ANY($1) AND e.details_pending
                 AND NOT EXISTS (SELECT 1 FROM annual_record a WHERE a.equipment_id = e.id)
                 AND NOT EXISTS (SELECT 1 FROM score_result s WHERE s.equipment_id = e.id)
                 AND NOT EXISTS (SELECT 1 FROM utility_record x WHERE x.equipment_id = e.id AND x.deleted_at IS NULL)
               RETURNING e.id, e.code, e.name`,
              [gone],
            )
          ).rows
        : [];
      await db.query('UPDATE utility_import_batch SET registered_count = $2 WHERE id = $1', [batch.id, registered]);

      const skipped = chosen.reduce((n, s) => n + s.summary.error, 0);
      await writeAudit(db, {
        hospitalId: p.hospitalId, actorId: u.id, action: 'import', entity: 'utility_import_batch', entityId: batch.id,
        after: {
          filename: p.filename, sha256: p.sha, mode: b.mode, sheets: chosen.map((s) => s.sheet), inserted: rows.length, replaced, skipped,
          registered, reusedEquipment: kept.size, removedEquipment: removed.map((e) => e.code),
        },
        ip: req.ip, userAgent: req.headers['user-agent'],
      });
      return { batchId: batch.id, inserted: rows.length, replaced, skipped, registered, reused: kept.size, removed: removed.length };
    });
    pending.delete(b.previewToken);
    return result;
  });

  /** รายการ + คะแนน + อันดับ + ข้อเสนอแนะ (คำนวณตอนอ่านด้วยชุดน้ำหนักที่เปิดใช้) */
  app.get('/api/utility/records', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    const q = z.object({ dataset: z.string().max(200).optional(), batch: Uuid.optional(), hospitalId: Uuid.optional() }).parse(req.query);
    return withTx(pool, u.scope, async (db) => {
      const settings = await activeSettings(db);
      const all = (
        await db.query(
          `SELECT r.*, h.name AS hospital_name FROM utility_record r JOIN hospital h ON h.id = r.hospital_id
            WHERE r.deleted_at IS NULL AND ($1::uuid IS NULL OR r.hospital_id = $1)
            ORDER BY h.name, r.dataset, r.seq_no`,
          [q.hospitalId ?? null],
        )
      ).rows;
      // อันดับคิดจากทุกแถวใน dataset เดียวกัน (ก่อนกรอง batch) เพื่อให้อันดับไม่เปลี่ยนตามตัวกรอง
      const groups = new Map<string, typeof all>();
      for (const r of all) groups.set(`${r.hospital_id}|${r.dataset}`, [...(groups.get(`${r.hospital_id}|${r.dataset}`) ?? []), r]);
      const rows = [...groups.values()].flatMap((g) =>
        scoreDataset(
          g.map((r) => ({
            rec: r,
            purchaseYearBe: r.purchase_year_be, purchasePrice: r.purchase_price, utilizationPct: r.utilization_pct, totalCases: r.total_cases,
            maintenanceCostTotal: r.maintenance_cost_total, downtimePct: r.downtime_pct, revenueTotal: r.revenue_total,
            clinicalRating: r.clinical_rating, satisfactionRating: r.satisfaction_rating, strategicRating: r.strategic_rating,
          })),
          settings,
        ).map(({ row: { rec }, score, rank, problems }) => ({
          id: rec.id, hospitalId: rec.hospital_id, hospitalName: rec.hospital_name, batchId: rec.batch_id, dataset: rec.dataset,
          datasetTitle: rec.dataset_title, sourceRow: rec.source_row, seqNo: rec.seq_no, name: rec.name, dataStatus: rec.data_status,
          input: {
            purchaseYearBe: rec.purchase_year_be, purchasePrice: rec.purchase_price, utilizationPct: rec.utilization_pct, totalCases: rec.total_cases,
            maintenanceCostTotal: rec.maintenance_cost_total, downtimePct: rec.downtime_pct, revenueTotal: rec.revenue_total,
            clinicalRating: rec.clinical_rating, satisfactionRating: rec.satisfaction_rating, strategicRating: rec.strategic_rating,
          },
          utilityScore: score?.utilityScore ?? null,
          rank,
          recommendation: score?.recommendation ?? null,
          recommendationText: score?.recommendationText ?? null,
          paybackYears: score?.paybackYears ?? null,
          costPerCase: score?.costPerCase ?? null,
          scores: score?.scores ?? null,
          problems,
        })),
      );
      const datasets = [...groups.values()].map((g) => ({
        hospitalId: g[0].hospital_id, hospitalName: g[0].hospital_name, dataset: g[0].dataset, title: g[0].dataset_title, count: g.length,
      }));
      return {
        settings: { ...settings, currentYearBeUsed: currentYearOf(settings) },
        datasets,
        rows: rows.filter((r) => (!q.dataset || r.dataset === q.dataset) && (!q.batch || r.batchId === q.batch)),
      };
    });
  });

  app.get('/api/utility/batches', async (req) => {
    const u = requirePerm(req, 'equipment.read');
    return withTx(pool, u.scope, async (db) =>
      (
        await db.query(
          `SELECT b.id, b.filename, b.uploaded_at, b.mode, b.sheets, b.row_count, b.registered_count, h.name AS hospital_name, au.name AS uploaded_by_name,
                  (SELECT count(*)::int FROM utility_record r WHERE r.batch_id = b.id AND r.deleted_at IS NULL) AS active_rows
             FROM utility_import_batch b JOIN hospital h ON h.id = b.hospital_id LEFT JOIN app_user au ON au.id = b.uploaded_by
            ORDER BY b.uploaded_at DESC LIMIT 50`,
        )
      ).rows,
    );
  });

  /** ไฟล์เปล่ารูปแบบเดียวกับต้นแบบ: ชีตข้อมูล (หัวตารางแถว 3) + ชีตสมมติฐานจากชุดที่เปิดใช้ */
  app.get('/api/utility/template', async (req, reply) => {
    const u = requirePerm(req, 'equipment.read');
    const settings = await withTx(pool, u.scope, activeSettings);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ข้อมูลครุภัณฑ์');
    ws.getCell('A1').value = 'ตารางวิเคราะห์ Utility ครุภัณฑ์ทางการแพทย์';
    ws.getCell('A2').value = 'กรอกคอลัมน์ B–M เท่านั้น ช่องอื่นระบบคำนวณเอง (ไม่ต้องใส่สูตร)';
    const heads = ['ลำดับ', 'รายการครุภัณฑ์', 'ปีที่ซื้อ (พ.ศ.)', 'ราคาซื้อ (บาท)', 'ปีที่ใช้งานแล้ว (ปี)', 'อัตราการใช้งาน\nUtilization (%)',
      'จำนวนเคสสะสม\n(ตั้งแต่ซื้อ)', 'ค่าบำรุงรักษา\nสะสม (บาท)', 'Downtime\nสะสม (%)', 'รายได้สะสม\n(บาท)', 'คะแนนผลลัพธ์\nทางคลินิก (1-5)',
      'คะแนนความพึงพอใจ\nผู้ใช้งาน/ผู้ป่วย (1-5)', 'คะแนนมูลค่า\nเชิงกลยุทธ์ (1-5)', 'ต้นทุนต่อเคส\n(บาท)', 'Payback\nPeriod (ปี)', 'Utilization\nScore',
      'Financial\nScore', 'Reliability\nScore', 'Clinical\nScore', 'Satisfaction\nScore', 'Strategic\nScore', 'Utility Score\nรวม (0-100)', 'อันดับ', 'ข้อเสนอแนะ'];
    const head = ws.getRow(3);
    heads.forEach((h, i) => (head.getCell(i + 1).value = h));
    head.font = { bold: true };
    head.alignment = { wrapText: true, vertical: 'middle' };
    ws.columns.forEach((c, i) => (c.width = i === 1 ? 40 : 14));
    const st = wb.addWorksheet('สมมติฐาน');
    st.getCell('A1').value = 'สมมติฐานและน้ำหนักคะแนน';
    st.getRow(3).values = ['รายการ', 'ค่า', 'หมายเหตุ'];
    const w = settings.weights;
    ([
      ['น้ำหนัก: Utilization Rate', w.utilization], ['น้ำหนัก: Clinical Outcome', w.clinical], ['น้ำหนัก: Financial Return', w.financial],
      ['น้ำหนัก: Reliability', w.reliability], ['น้ำหนัก: Satisfaction', w.satisfaction], ['น้ำหนัก: Strategic Value', w.strategic],
      ['ตัวคูณ Payback', settings.paybackPenalty], ['ปีปัจจุบัน (พ.ศ.)', currentYearOf(settings)],
    ] as [string, number][]).forEach(([l, v], i) => (st.getRow(4 + i).values = [l, v]));
    st.getColumn(1).width = 30;
    const buf = await wb.xlsx.writeBuffer();
    return reply
      .header('content-type', XLSX_MIME)
      .header('content-disposition', `attachment; filename="utility-template.xlsx"; filename*=UTF-8''${encodeURIComponent('แบบฟอร์ม_Utility_Analysis.xlsx')}`)
      .send(Buffer.from(buf));
  });

}
