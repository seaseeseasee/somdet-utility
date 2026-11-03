import { describe, expect, it } from 'vitest';
import { scoreDataset, scoreUtility, settingsProblems, type ScoringSettings, type UtilityInput } from '../src/utility/score.js';

/** ค่าจากชีต "สมมติฐาน" ของไฟล์ต้นแบบ (ปีปัจจุบัน 2569) */
const S: ScoringSettings = {
  weights: { utilization: 0.25, clinical: 0.2, financial: 0.2, reliability: 0.15, satisfaction: 0.1, strategic: 0.1 },
  paybackPenalty: 15,
  currentYearBe: 2569,
};

const row = (o: Partial<UtilityInput>): UtilityInput => ({
  purchaseYearBe: null, purchasePrice: null, utilizationPct: null, totalCases: null, maintenanceCostTotal: null, downtimePct: null,
  revenueTotal: null, clinicalRating: null, satisfactionRating: null, strategicRating: null, ...o,
});
const r = (y: number, price: number, util: number, cases: number, ma: number, dt: number, rev: number | null, k: number, l: number, m: number) =>
  row({ purchaseYearBe: y, purchasePrice: price, utilizationPct: util, totalCases: cases, maintenanceCostTotal: ma, downtimePct: dt, revenueTotal: rev, clinicalRating: k, satisfactionRating: l, strategicRating: m });

describe('สูตร Utility Score ของข้อมูลที่นำเข้า (ตรงกับไฟล์ต้นแบบ ปี 2569)', () => {
  it('เครื่องให้การรักษาด้วยคลื่นวิทยุ → อายุ 2 ปี, Payback 8.62, Financial 0, Score 50.75', () => {
    const s = scoreUtility(r(2567, 1190000, 15, 1062, 0, 0, 276120, 4, 4, 4), S);
    expect(s.ageYears).toBe(2);
    expect(s.paybackYears).toBeCloseTo(8.62, 2);
    expect(s.scores.financial).toBe(0);
    expect(s.utilityScore).toBeCloseTo(50.75, 9);
  });
  it('เครื่องถ่ายภาพรังสีกระดูกขากรรไกรฯ → Payback 47.78, Financial 0, Score 58.0 (ไม่ใช่ 68 แบบที่สูตรในไฟล์ผิด)', () => {
    const s = scoreUtility(r(2567, 2370000, 12, 225, 0, 0, 99200, 5, 5, 5), S);
    expect(s.paybackYears).toBeCloseTo(47.78, 2);
    expect(s.scores.financial).toBe(0);
    expect(s.utilityScore).toBeCloseTo(58, 9);
  });
  it('เครื่องเอกซเรย์เคลื่อนที่ดิจิตอล ×3 (เคส 38/36/30) → Score 57.6 ทั้งสามแถว อันดับเท่ากัน', () => {
    const rows = [38, 36, 30].map((c) => r(2569, 3786666.67, 20, c, 0, 0, 9800, 4.5, 4.8, 5));
    const out = scoreDataset(rows, S);
    for (const x of out) expect(x.score!.utilityScore).toBeCloseTo(57.6, 9);
    expect(new Set(out.map((x) => x.rank))).toEqual(new Set([1]));
  });
  it('เครื่องจัดยาอัตโนมัติ (รายได้ 0) → Financial 50, Score 78.5', () => {
    const s = scoreUtility(r(2566, 6200000, 95, 22894, 360000, 15, 0, 4, 4, 4), S);
    expect(s.paybackYears).toBeNull();
    expect(s.scores.financial).toBe(50);
    expect(s.utilityScore).toBeCloseTo(78.5, 9);
  });
  it('รายได้ว่าง (null) = ไม่มีข้อมูลรายได้ → Financial 50', () => {
    expect(scoreUtility(r(2566, 6200000, 95, 22894, 360000, 15, null, 4, 4, 4), S).utilityScore).toBeCloseTo(78.5, 9);
  });
  it('เครื่องรักษาอาการปวดฯ peripheral magnetic stimulation → Payback 1.76, Financial 73.6, Score ≈ 78.96', () => {
    const s = scoreUtility(r(2566, 970000, 75, 6351, 0, 10, 1651260, 4, 4, 4), S);
    expect(s.paybackYears).toBeCloseTo(1.76, 2);
    expect(s.scores.financial).toBeCloseTo(73.57, 1);
    expect(s.utilityScore).toBeCloseTo(78.96, 2);
  });
  it('เครื่องตรวจวิเคราะห์สารอิเลคโตรไลท์ลิเทียม → Score 23.5 "พิจารณาทดแทนหรือไม่จัดซื้อเพิ่ม"', () => {
    const s = scoreUtility(r(2565, 764800, 2, 75, 0, 0, 2800, 1, 1, 1), S);
    expect(s.utilityScore).toBeCloseTo(23.5, 9);
    expect(s.recommendationText).toBe('พิจารณาทดแทนหรือไม่จัดซื้อเพิ่ม');
  });
  it('แถวที่ขาดข้อมูล (Somatics thymatron system IV) → ไม่มีคะแนน ไม่ติดอันดับ', () => {
    const out = scoreDataset([row({ purchaseYearBe: 2569 }), r(2565, 764800, 2, 75, 0, 0, 2800, 1, 1, 1)], S);
    expect(out[0]!.score).toBeNull();
    expect(out[0]!.rank).toBeNull();
    expect(out[0]!.problems.join(' ')).toMatch(/ราคาซื้อ/);
    expect(out[1]!.rank).toBe(1);
  });
  it('อันดับแบบ competition ranking: 5,5,5,8', () => {
    const scores = [90, 80, 70, 60, 57.6, 57.6, 57.6, 40].map((u) => r(2569, 1000000, u, 0, 0, 0, null, 1, 1, 1));
    expect(scoreDataset(scores, S).map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 5, 5, 8]);
  });
  it('ข้อเสนอแนะ 4 ระดับตามเกณฑ์ 80 / 60 / 40', () => {
    const rec = (k: number) => scoreUtility(r(2569, 1, 100, 0, 0, 0, null, k, k, k), S).recommendationText;
    // util 100 (25) + rel 100 (15) + financial 50 (10) + rating×20 × 0.4
    expect(rec(5)).toBe('ซื้อเพิ่ม/อัปเกรดรุ่นใหม่');
    expect(rec(2.5)).toBe('คงสภาพ ติดตามต่อเนื่อง');
    expect(rec(1)).toBe('ทบทวนแผนการใช้งาน/เพิ่ม Utilization');
  });
  it('ใช้ปีปัจจุบันจาก settings และค่าเริ่มต้น = ปีปัจจุบัน + 543', () => {
    const x = r(2567, 1190000, 15, 1062, 0, 0, 276120, 4, 4, 4);
    expect(scoreUtility(x, { ...S, currentYearBe: 2570 }).ageYears).toBe(3);
    expect(scoreUtility(x, { ...S, currentYearBe: null }, new Date('2026-06-01')).ageYears).toBe(2);
  });
});

describe('ตรวจชุดน้ำหนัก', () => {
  it('น้ำหนักรวมไม่เท่ากับ 1.00 → ปฏิเสธพร้อมข้อความชัดเจน', () => {
    const p = settingsProblems({ ...S, weights: { ...S.weights, utilization: 0.3 } });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/ผลรวมน้ำหนัก 6 ด้านต้องเท่ากับ 1\.00 \(ในไฟล์รวมได้ 1\.05\)/);
  });
  it('ชุดค่าเริ่มต้นผ่าน และน้ำหนักติดลบไม่ผ่าน', () => {
    expect(settingsProblems(S)).toEqual([]);
    expect(settingsProblems({ ...S, weights: { ...S.weights, utilization: -0.25, clinical: 0.7 } }).join()).toMatch(/ติดลบ/);
  });
});
