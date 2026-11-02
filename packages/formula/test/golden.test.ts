/**
 * Golden Test: เทียบผลกับค่าที่ Excel คำนวณและบันทึกไว้ในไฟล์ต้นฉบับ (cached values)
 * แหล่ง: Utility_Analysis_ครุภัณฑ์การแพทย์ (1).xlsx
 *   - ชีต "ตัวอย่างการลงข้อมูลครุภัณฑ์ " แถว 4–7 (แถว 4–6 ตรงกับไฟล์แม่แบบ)
 *   - ชีต "ข้อมูลครุภัณฑ์ 67-69" แถว 4, 6, 14, 15 (เฉพาะแถวที่สูตรถูกต้อง ไม่รวมแถวที่พบ #REF! หรืออ้างคอลัมน์ผิด)
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateYears,
  annualMetrics,
  computeAnnualScore,
  computeScore,
  FORMULA_SET_V1,
  FORMULA_SET_V1_1,
  IncompleteDataError,
  rankScores,
  recommendationOf,
  validateAnnual,
  validateFormulaSet,
  type AnnualInput,
  type CumulativeInput,
} from '../src/index.js';

type Row = [string, number, number, number, number, number, number, number, number, number, number];
// [ชื่อ, C ปีที่ซื้อ, D ราคา, F Util%, G เคส, H บำรุงรักษา, I Downtime%, J รายได้, K, L, M]
const toInput = (r: Row): CumulativeInput => ({
  purchaseYear: r[1], purchasePrice: r[2], analysisYear: 2569, utilizationPct: r[3], cases: r[4],
  maintenanceCost: r[5], downtimePct: r[6], revenue: r[7], noDirectRevenue: r[7] === 0,
  clinicalRating: r[8], satisfactionRating: r[9], strategicRating: r[10],
});
// ค่า Excel: [E, N, O(null=N/A), P, Q, R, S, T, U, V, X]
type Expected = [number, number | null, number | null, number, number, number, number, number, number, number, string];

const CASES: [string, Row, Expected][] = [
  ['ตัวอย่าง!4 CT Scan', ['CT', 2566, 25000000, 78, 9600, 1200000, 3, 21400000, 4, 4, 4],
    [3, 2729.166667, 3.504672897, 78, 47.42990654, 97, 80, 80, 80, 75.53598131, 'คงสภาพ ติดตามต่อเนื่อง']],
  ['ตัวอย่าง!5 Ultrasound', ['US', 2565, 3500000, 45, 4400, 450000, 8, 2258000, 3, 3, 3],
    [4, 897.7272727, 6.200177148, 45, 6.997342781, 92, 60, 60, 60, 50.44946856, 'ทบทวนแผนการใช้งาน/เพิ่ม Utilization']],
  ['ตัวอย่าง!6 Ventilator (ไม่มีรายได้)', ['Vent', 2567, 1800000, 30, 800, 150000, 15, 0, 3, 2, 3],
    [2, 2437.5, null, 30, 50, 85, 60, 40, 60, 52.25, 'ทบทวนแผนการใช้งาน/เพิ่ม Utilization']],
  ['ตัวอย่าง!7 หุ่นยนต์ตรวจสอบซองยา', ['Robot', 2566, 3960000, 65, 11447, 0, 30, 0, 3, 3, 3],
    [3, 345.9421683, null, 65, 50, 70, 60, 60, 60, 60.75, 'คงสภาพ ติดตามต่อเนื่อง']],
  ['67-69!4 เครื่องให้การรักษาด้วยคลื่นวิทยุ', ['RF', 2567, 1190000, 15, 1062, 0, 0, 276120, 4, 4, 4],
    [2, 1120.527307, 8.619440823, 15, 0, 100, 80, 80, 80, 50.75, 'ทบทวนแผนการใช้งาน/เพิ่ม Utilization']],
  ['67-69!6 TMS (คะแนนทศนิยม)', ['TMS', 2568, 2500000, 20, 36, 0, 0, 36422, 4.5, 5, 5],
    [1, 69444.44444, 68.63983307, 20, 0, 100, 90, 100, 100, 58, 'ทบทวนแผนการใช้งาน/เพิ่ม Utilization']],
  ['67-69!14 เครื่องจัดยาอัตโนมัติ', ['Disp', 2566, 6200000, 95, 22894, 360000, 15, 0, 4, 4, 4],
    [3, 286.5379575, null, 95, 50, 85, 80, 80, 80, 78.5, 'คงสภาพ ติดตามต่อเนื่อง']],
  ['67-69!15 Peripheral magnetic stimulation', ['PMS', 2566, 970000, 75, 6351, 0, 10, 1651260, 4, 4, 4],
    [3, 152.7318533, 1.762290614, 75, 73.56564078, 90, 80, 80, 80, 78.96312816, 'คงสภาพ ติดตามต่อเนื่อง']],
];

describe('Golden Test เทียบกับ Excel', () => {
  for (const [name, row, e] of CASES) {
    it(name, () => {
      const r = computeScore(toInput(row));
      const close = (a: number | null, b: number | null) =>
        // Excel เก็บค่าไว้ประมาณ 10 หลักนัยสำคัญ จึงเทียบแบบสัมพัทธ์
        b === null ? expect(a).toBeNull() : expect(Math.abs(a! - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
      expect(r.ageYears).toBe(e[0]);
      close(r.costPerCase, e[1]);
      close(r.paybackYears, e[2]);
      close(r.scores.utilization, e[3]);
      close(r.scores.financial, e[4]);
      close(r.scores.reliability, e[5]);
      close(r.scores.clinical, e[6]);
      close(r.scores.satisfaction, e[7]);
      close(r.scores.strategic, e[8]);
      close(r.utilityScore, e[9]);
      expect(r.recommendationText).toBe(e[10]);
      expect(r.formulaVersion).toBe('1.0');
    });
  }

  it('RANK ตาม Excel (ตัวอย่าง W4:W7 = 1, 4, 3, 2)', () => {
    expect(rankScores([75.53598131, 50.44946856, 52.25, 60.75])).toEqual([1, 4, 3, 2]);
  });
  it('RANK กรณีคะแนนเท่ากัน (ชีตนำเสนอ: 57.6 ×3 ได้อันดับ 5 แล้วข้ามไป 8)', () => {
    expect(rankScores([79, 78.5, 68, 58, 57.6, 57.6, 57.6, 57, 50.75, 23.5])).toEqual([1, 2, 3, 4, 5, 5, 5, 8, 9, 10]);
  });
});

describe('เกณฑ์และธงเตือน', () => {
  it('ขอบเกณฑ์ 80/60/40 ใช้ ≥', () => {
    expect(recommendationOf(80)).toBe('high');
    expect(recommendationOf(79.999)).toBe('good');
    expect(recommendationOf(60)).toBe('good');
    expect(recommendationOf(40)).toBe('medium');
    expect(recommendationOf(39.99)).toBe('low');
  });
  it('ธงเตือน D-12: Utilization < 40% หรือ Score < 50', () => {
    const ct = computeScore(toInput(CASES[0]![1]));
    expect(ct.warning).toBe(false);
    const vent = computeScore(toInput(CASES[2]![1]));
    expect(vent.warning).toBe(true); // Util 30%
  });
  it('ชุดสูตร v1.0 ผลรวมน้ำหนัก = 1', () => {
    expect(validateFormulaSet(FORMULA_SET_V1)).toEqual([]);
  });
  it('Financial Score ไม่ต่ำกว่า 0 และไม่เกิน 100', () => {
    const i = toInput(CASES[0]![1]);
    const hi = computeScore({ ...i, revenue: 1e12 }).scores.financial;
    expect(hi).toBeLessThanOrEqual(100);
    expect(hi).toBeGreaterThan(99.99);
    expect(computeScore({ ...i, revenue: 1 }).scores.financial).toBe(0);
  });
});

describe('D-05 / D-08: ข้อมูลไม่ครบไม่ได้คะแนน', () => {
  it('รายได้ 0 แต่ไม่ได้ระบุ "ไม่มีรายได้ตรง" → ไม่คำนวณ', () => {
    const i = { ...toInput(CASES[2]![1]), noDirectRevenue: false };
    expect(() => computeScore(i)).toThrow(IncompleteDataError);
  });
  it('ข้อมูลว่าง (กรณี E-05 ใน Excel ได้ 25 คะแนน) → ไม่คำนวณ', () => {
    const i = { ...toInput(CASES[0]![1]), utilizationPct: NaN, clinicalRating: NaN };
    expect(() => computeScore(i)).toThrow(/Utilization/);
  });
  it('คะแนน 1–5 เกินช่วง หรือทศนิยมเกิน 1 ตำแหน่ง → ไม่คำนวณ', () => {
    const i = toInput(CASES[0]![1]);
    expect(() => computeScore({ ...i, clinicalRating: 6 })).toThrow(/ไม่เกิน 5/);
    expect(() => computeScore({ ...i, clinicalRating: 4.55 })).toThrow(/ทศนิยม/);
    expect(() => computeScore({ ...i, clinicalRating: 4.5 })).not.toThrow();
  });
});

const year = (fy: number, o: Partial<AnnualInput> = {}): AnnualInput => ({
  fiscalYear: fy, availableDays: 245, actualDays: 200, maxAvailableHours: 2450, actualHours: 980, useCount: 1120,
  caseCount: 1050, repairCost: 42000, partsCost: 18500, pmCost: 30000, calibrationCost: 12000, otherCost: 2500,
  revenue: 388000, noDirectRevenue: false, repairDays: 21, breakdownCount: 3, downtimeHours: 245,
  clinicalRating: 3, satisfactionRating: 3, strategicRating: 3, ...o,
});

describe('D-01/D-03/D-06: ตัวชี้วัดรายปี', () => {
  it('ค่าตามตัวอย่างในแบบฟอร์ม Mockup', () => {
    const m = annualMetrics(year(2569));
    expect(m.maintenanceCost).toBe(105000);
    expect(m.utilizationPctHours).toBeCloseTo(40, 9);
    expect(m.availabilityPct).toBeCloseTo(91.4285714, 6);
    expect(m.downtimePct).toBeCloseTo(10, 9);
    expect(m.costPerUse).toBeNull();
    expect(annualMetrics(year(2569), 3500000, 10).costPerUse).toBeCloseTo((350000 + 105000) / 1120, 9);
  });
  it('Validation: วันใช้จริง > วันพร้อมใช้ เป็นข้อผิดพลาด', () => {
    const v = validateAnnual(year(2569, { actualDays: 260 }));
    expect(v.errors.map((e) => e.field)).toContain('actualDays');
  });
  it('Validation: Utilization เปลี่ยน ≥ 30 จุดจากปีก่อน เป็นข้อสังเกต', () => {
    const v = validateAnnual(year(2569), year(2568, { actualHours: 2000 }));
    expect(v.errors).toEqual([]);
    expect(v.warnings.length).toBeGreaterThan(0);
  });
});

describe('D-02: รวมข้อมูลรายปีเป็นข้อมูลสะสม', () => {
  it('ผลรวม/ค่าเฉลี่ยถ่วงน้ำหนักชั่วโมง/คะแนนปีล่าสุด', () => {
    const c = aggregateYears(
      [year(2569, { clinicalRating: 4 }), year(2568, { actualHours: 1470, revenue: 400000, clinicalRating: 2 })],
      { purchaseYear: 2565, purchasePrice: 3500000 },
      2569,
    );
    expect(c.utilizationPct).toBeCloseTo(((980 + 1470) / 4900) * 100, 9);
    expect(c.downtimePct).toBeCloseTo(10, 9);
    expect(c.cases).toBe(2100);
    expect(c.maintenanceCost).toBe(210000);
    expect(c.revenue).toBe(788000);
    expect(c.clinicalRating).toBe(4); // N-06: ปีล่าสุด
    const s = computeScore(c);
    expect(s.paybackYears).toBeCloseTo(3500000 / (788000 / 4), 9);
  });
  it('ไม่มีรายได้ตรงเมื่อทุกปีระบุไว้เท่านั้น', () => {
    const eq = { purchaseYear: 2567, purchasePrice: 1800000 };
    expect(aggregateYears([year(2568, { revenue: 0, noDirectRevenue: true }), year(2569, { revenue: 0, noDirectRevenue: true })], eq, 2569).noDirectRevenue).toBe(true);
    expect(aggregateYears([year(2568, { revenue: 0, noDirectRevenue: true }), year(2569, { revenue: 0 })], eq, 2569).noDirectRevenue).toBe(false);
  });
  it('Score รายปีใช้อายุ 1 ปี', () => {
    const s = computeAnnualScore(year(2569), { purchaseYear: 2565, purchasePrice: 3500000 });
    expect(s.ageYears).toBe(1);
    expect(s.paybackYears).toBeCloseTo(3500000 / 388000, 9);
  });
  it('ไม่มีข้อมูลรายปี → ไม่คำนวณ', () => {
    expect(() => aggregateYears([], { purchaseYear: 2565, purchasePrice: 1 }, 2569)).toThrow(IncompleteDataError);
  });
});

describe('ชุดสูตร v1.1 (D-16): ตัวหาร Payback = MIN(อายุตาม Excel, จำนวนปีที่มีข้อมูล)', () => {
  it('ข้อมูลครบทุกปีตั้งแต่ซื้อ → ผลเท่ากับ Excel ทุกแถว', () => {
    for (const [name, row, e] of CASES) {
      const i = toInput(row);
      // ซื้อปี C วิเคราะห์ปี 2569 → มีข้อมูลปีงบ C..2569 = (2569 − C + 1) ปี ≥ อายุตาม Excel
      const r = computeScore({ ...i, dataYears: 2569 - i.purchaseYear + 1 }, FORMULA_SET_V1_1);
      expect(Math.abs(r.utilityScore - e[9]), name).toBeLessThanOrEqual(1e-9 * e[9]);
      expect(r.formulaVersion).toBe('1.1');
    }
  });
  it('เครื่องอายุเกิน 5 ปี ใช้จำนวนปีที่มีข้อมูล (5) แทนอายุ (9)', () => {
    const i = { ...toInput(['Old', 2560, 3000000, 70, 5000, 300000, 5, 2500000, 4, 4, 4]), dataYears: 5 };
    const v10 = computeScore(i, FORMULA_SET_V1);
    const v11 = computeScore(i, FORMULA_SET_V1_1);
    expect(v10.ageYears).toBe(9);
    expect(v10.paybackYears).toBeCloseTo(3000000 / (2500000 / 9), 9); // 10.8 ปี → Financial 0
    expect(v11.paybackDivisorYears).toBe(5);
    expect(v11.paybackYears).toBeCloseTo(3000000 / (2500000 / 5), 9); // 6 ปี → Financial 10
    expect(v11.scores.financial).toBeCloseTo(10, 9);
    expect(v11.utilityScore - v10.utilityScore).toBeCloseTo(2, 9); // +10 × 0.2
    expect(v11.explanation.join(' ')).toMatch(/MIN\(อายุ 9, ข้อมูล 5 ปี\)/);
  });
  it('aggregateYears ระบุจำนวนปีที่มีข้อมูล', () => {
    const c = aggregateYears([year(2568), year(2569)], { purchaseYear: 2560, purchasePrice: 3500000 }, 2569);
    expect(c.dataYears).toBe(2);
    expect(computeScore(c, FORMULA_SET_V1_1).paybackDivisorYears).toBe(2);
  });
  it('v1.1 ต่างจาก v1.0 เฉพาะตัวหาร Payback', () => {
    const { version: a, paybackDivisor: b, ...r10 } = FORMULA_SET_V1;
    const { version: c, paybackDivisor: d, ...r11 } = FORMULA_SET_V1_1;
    expect(r11).toEqual(r10);
    expect([a, b, c, d]).toEqual(['1.0', 'excel_age', '1.1', 'min_age_data_years']);
  });
});
