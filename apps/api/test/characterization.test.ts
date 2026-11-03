import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from './helpers.js';

/**
 * Characterization test: บันทึกผลลัพธ์ของระบบไว้เป็น snapshot ก่อน Refactor
 * แล้วตรวจว่าหลัง Refactor ผลคำนวณและข้อมูลที่ API ส่งออกเหมือนเดิมทุกค่า
 * (ใช้ปีวิเคราะห์ระบุชัดเจน ไม่ขึ้นกับวันที่รันทดสอบ)
 */
let env: Awaited<ReturnType<typeof setupTestEnv>>;
const C: Record<string, string> = {};
const Y = 2568;
const get = async (who: string, url: string) => (await env.as(C[who]!).get(url)).json();

beforeAll(async () => {
  env = await setupTestEnv({}, { annual: true });
  for (const [k, pid] of Object.entries({ ca: 'PID-DEMO-CA', aEntry: 'PID-DEMO-A-ENTRY', bEntry: 'PID-DEMO-B-ENTRY' })) C[k] = (await env.login(pid)).cookie;
});
afterAll(async () => env?.teardown());

const pickScore = (r: Record<string, any>) => ({
  code: r.equipment.code, status: r.status, rank: r.rank, utilityScore: r.utilityScore, scores: r.scores, paybackYears: r.paybackYears,
  costPerCase: r.costPerCase, recommendation: r.recommendation, warning: r.warning, utilizationPct: r.utilizationPct, source: r.source,
  utilization: r.utilization, assessment: r.assessment, dataYears: r.dataYears, problems: r.problems,
});

describe('characterization: ผลคำนวณก่อน/หลัง Refactor ต้องเหมือนเดิม', () => {
  it('/api/scores (รพ. A และส่วนกลาง)', async () => {
    for (const who of ['aEntry', 'ca']) {
      const d = await get(who, `/api/scores?year=${Y}`);
      expect({ year: d.year, window: d.window, formula: d.formula, summary: d.summary, rows: d.rows.map(pickScore) }).toMatchSnapshot(who);
    }
  });
  it('/api/equipment/:id/score ทุกเครื่องของ รพ. A', async () => {
    const eq = (await get('aEntry', '/api/equipment?pageSize=200')).rows as { id: string; code: string }[];
    const out: Record<string, unknown> = {};
    for (const e of eq.sort((a, b) => a.code.localeCompare(b.code))) {
      const d = await get('aEntry', `/api/equipment/${e.id}/score?year=${Y}`);
      out[e.code] = { outcome: d.outcome, rank: d.rank, rankOf: d.rankOf, utilization: d.utilization, assessment: d.assessment, annual: d.annual };
    }
    expect(out).toMatchSnapshot();
  });
  it('/api/dashboard/hospital และ /api/dashboard/network', async () => {
    const h = await get('aEntry', `/api/dashboard/hospital?year=${Y}`);
    expect({ ...h, equipment: h.equipment.map((e: Record<string, unknown>) => ({ ...e, id: undefined })) }).toMatchSnapshot('hospital');
    const n = await get('ca', `/api/dashboard/network?year=${Y}`);
    expect({ ...n, hospitals: n.hospitals.map((x: Record<string, any>) => ({ ...x, hospital: x.hospital.hcode, types: Object.values(x.types) })), types: n.types.map((t: { name: string }) => t.name) }).toMatchSnapshot('network');
  });
  it('/api/formula/preview (ค่าในไฟล์ Excel: CT Scan)', async () => {
    const r = await env.as(C.aEntry!).post('/api/formula/preview', {
      purchaseYear: 2566, purchasePrice: 25000000, analysisYear: 2569, utilizationPct: 78, cases: 9600, maintenanceCost: 1200000,
      downtimePct: 3, revenue: 21400000, clinicalRating: 4, satisfactionRating: 4, strategicRating: 4,
    });
    expect(r.json()).toMatchSnapshot();
  });
  it('รายงานผู้บริหาร: ตารางในตัวอย่าง HTML (ไม่รวมวันเวลาที่สร้าง)', async () => {
    const html = (await env.as(C.aEntry!).get(`/api/reports/executive/preview?year=${Y}&sections=kpi,ranking,factors,annual`)).body;
    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    expect(tables).toMatchSnapshot();
  });
});
