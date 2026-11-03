import { describe, expect, it } from 'vitest';
import { annualMetrics, CRITICAL_LOW_USE_ADVICE, UTILIZATION_LEVELS, utilizationAdvice, utilizationLevelOf } from '../src/index.js';

describe('ระดับ Utilization 5 ระดับ', () => {
  it.each([
    [0, 1], [19.99, 1], [20, 2], [39.99, 2], [40, 3], [59.99, 3], [60, 4], [79.99, 4], [80, 5], [100, 5],
  ])('%s%% → ระดับ %s (ค่าที่ขอบอยู่ระดับที่สูงกว่า)', (pct, level) => {
    expect(utilizationLevelOf(pct)).toBe(level);
  });
  it('ทุกค่า 0–100 ได้ระดับเดียว ไม่ตกหล่นและไม่ทับซ้อน', () => {
    for (let i = 0; i <= 10000; i++) {
      const pct = i / 100;
      const matches = ([1, 2, 3, 4, 5] as const).filter((l) => pct >= UTILIZATION_LEVELS[l].min && (l === 5 || pct < UTILIZATION_LEVELS[(l + 1) as 2 | 3 | 4 | 5].min));
      expect(matches).toEqual([utilizationLevelOf(pct)]);
    }
  });
  it('ปัดเป็นทศนิยม 2 ตำแหน่งก่อนเทียบเกณฑ์ (79.996 แสดงเป็น 80.00% จึงอยู่ระดับ 5)', () => {
    expect(utilizationLevelOf(79.996)).toBe(5);
    expect(utilizationLevelOf(79.994)).toBe(4);
  });
  it('ค่าเกิน 100%, ติดลบ, ว่าง, NaN → ไม่จัดระดับ (ไม่แสดงเป็นผลปกติ)', () => {
    for (const v of [100.01, 150, -0.01, -5, null, undefined, NaN, Infinity]) expect(utilizationLevelOf(v as number)).toBeNull();
    expect(utilizationAdvice(120)).toBeNull();
  });
  it('ข้อเสนอแนะตรงกับระดับ', () => {
    expect(utilizationAdvice(85)!.advice).toBe('ควรคงการใช้งานอย่างต่อเนื่อง วางแผนบำรุงรักษา และประเมินความเพียงพอของอุปกรณ์');
    expect(utilizationAdvice(65)!.advice).toMatch(/^ควรคงการใช้งาน ติดตาม/);
    expect(utilizationAdvice(45)!.advice).toMatch(/^ควรทบทวนตารางการใช้งาน/);
    expect(utilizationAdvice(25)!.advice).toMatch(/^ควรวิเคราะห์สาเหตุที่ใช้งานต่ำ/);
    expect(utilizationAdvice(5)!).toMatchObject({ level: 1, label: 'ใช้งานต่ำมาก', range: '< 20%' });
  });
  it('อุปกรณ์ช่วยชีวิต/ฉุกเฉินที่ใช้งานต่ำ ไม่ได้รับคำแนะนำให้โอนย้ายหรือจำหน่าย', () => {
    for (const pct of [5, 25]) {
      const a = utilizationAdvice(pct, { critical: true })!;
      expect(a.advice).toBe(CRITICAL_LOW_USE_ADVICE);
      expect(a.advice).not.toMatch(/พิจารณาโอนย้ายหรือจำหน่ายตามระเบียบ/);
    }
    // ระดับ 3 ขึ้นไปใช้ข้อเสนอแนะปกติ
    expect(utilizationAdvice(45, { critical: true })!.advice).toBe(UTILIZATION_LEVELS[3].advice);
  });
});

describe('สูตร Utilization ของข้อมูลรายปี', () => {
  const base = {
    fiscalYear: 2569, availableDays: 245, actualDays: 200, maxAvailableHours: 2450, actualHours: 980, useCount: 1120, caseCount: 1050,
    repairCost: 0, partsCost: 0, pmCost: 0, calibrationCost: 0, otherCost: 0, revenue: 0, noDirectRevenue: true, repairDays: 0,
    breakdownCount: 0, downtimeHours: 0, clinicalRating: 3, satisfactionRating: 3, strategicRating: 3,
  };
  it('Utilization = ชม.ใช้จริง ÷ ชม.พร้อมใช้ × 100 ตรงกับการคำนวณด้วยมือ (980 ÷ 2450 = 40%)', () => {
    expect(annualMetrics(base as never).utilizationPctHours).toBeCloseTo(40, 9);
  });
  it('ชั่วโมงพร้อมใช้ = 0 → ไม่คำนวณ (ไม่หารด้วยศูนย์)', () => {
    expect(annualMetrics({ ...base, maxAvailableHours: 0 } as never).utilizationPctHours).toBeNull();
  });
});
