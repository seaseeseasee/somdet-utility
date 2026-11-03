import { describe, expect, it } from 'vitest';
import { assessValue, valueLevelOf, type FactorScores } from '../src/index.js';

const scores = (o: Partial<FactorScores> = {}): FactorScores => ({
  utilization: 80, clinical: 80, financial: 80, reliability: 80, satisfaction: 80, strategic: 80, ...o,
});

describe('ระดับคะแนนรวม (เกณฑ์เสริม)', () => {
  it.each([
    [100, 'very_worth'], [80, 'very_worth'], [79.99, 'worth'], [65, 'worth'], [64.99, 'watch'], [50, 'watch'], [49.99, 'not_worth'], [0, 'not_worth'],
  ])('%s → %s', (s, level) => expect(valueLevelOf(s)).toBe(level));
  it('ข้อเสนอแนะตรงกับระดับ', () => {
    const a = (u: number) => assessValue({ utilityScore: u, scores: scores(), paybackYears: 2 }, { usefulLifeYears: 10 });
    expect(a(85)).toMatchObject({ label: 'คุ้มค่ามาก', advice: 'คงใช้ต่อ / ขยายหรือจัดหาเพิ่มได้' });
    expect(a(70)).toMatchObject({ label: 'คุ้มค่า', advice: 'คงใช้ต่อ ติดตามตามรอบปกติ' });
    expect(a(55)).toMatchObject({ label: 'พอใช้ / ต้องเฝ้าระวัง', advice: 'ทบทวนปัญหารายมิติ แล้วทำแผนปรับปรุง' });
    expect(a(30)).toMatchObject({ label: 'ไม่คุ้มค่า', advice: 'พิจารณาลดการลงทุน ย้ายใช้งาน ทดแทน หรือจำหน่าย' });
  });
});

describe('เกณฑ์รายมิติ', () => {
  it('< 50 = ต่ำ, 50–59.99 = เฝ้าระวัง, ≥ 60 = ผ่าน พร้อมความหมายและสิ่งที่ควรทำ', () => {
    const a = assessValue({ utilityScore: 70, scores: scores({ utilization: 49.99, satisfaction: 50, strategic: 60 }), paybackYears: 2 }, { usefulLifeYears: 10 });
    const by = Object.fromEntries(a.dimensions.map((d) => [d.key, d]));
    expect(by.utilization).toMatchObject({ status: 'low', meaning: 'ใช้งานน้อย', actions: 'เพิ่มข้อบ่งใช้ ย้ายไปหน่วยที่ใช้มากกว่า ทบทวนว่าจำเป็นต้องมีหรือไม่' });
    expect(by.satisfaction).toMatchObject({ status: 'watch', meaning: 'ผู้ใช้ไม่พอใจ' });
    expect(by.strategic!.status).toBe('ok');
    expect(by.strategic!.actions).toBeUndefined();
  });
});

describe('กฎเสริม (override)', () => {
  it('Reliability หรือ Clinical < 40 → ธงแดงทันที แม้คะแนนรวมสูง', () => {
    const a = assessValue({ utilityScore: 85, scores: scores({ reliability: 39.9 }), paybackYears: 1 }, { usefulLifeYears: 10 });
    expect(a.level).toBe('very_worth');
    expect(a.flags.filter((f) => f.severity === 'red').map((f) => f.rule)).toEqual(['safety']);
    expect(a.flags[0]!.text).toMatch(/Reliability Score 39\.9 < 40: กระทบความปลอดภัยผู้ป่วย/);
    expect(assessValue({ utilityScore: 85, scores: scores({ clinical: 20, reliability: 20 }), paybackYears: 1 }, { usefulLifeYears: 10 }).flags.filter((f) => f.rule === 'safety')).toHaveLength(2);
    expect(assessValue({ utilityScore: 85, scores: scores({ reliability: 40 }), paybackYears: 1 }, { usefulLifeYears: 10 }).flags).toEqual([]);
  });
  it('Payback เกินอายุการใช้งานตามเกณฑ์ → ไม่คุ้มทุน', () => {
    const a = assessValue({ utilityScore: 70, scores: scores(), paybackYears: 12.5 }, { usefulLifeYears: 10 });
    expect(a.flags).toEqual([expect.objectContaining({ severity: 'red', rule: 'payback_over_life' })]);
    expect(a.flags[0]!.text).toMatch(/12\.5 ปี เกินอายุการใช้งานตามเกณฑ์ 10 ปี: ไม่คุ้มทุน/);
    expect(assessValue({ utilityScore: 70, scores: scores(), paybackYears: 10 }, { usefulLifeYears: 10 }).flags).toEqual([]);
  });
  it('Payback = N/A → "ข้อมูลไม่เพียงพอ" และไม่สรุปผลด้านการเงินจากค่า 50', () => {
    const a = assessValue({ utilityScore: 60, scores: scores({ financial: 50 }), paybackYears: null }, { usefulLifeYears: 10 });
    expect(a.dimensions.find((d) => d.key === 'financial')).toMatchObject({ status: 'insufficient' });
    expect(a.dimensions.find((d) => d.key === 'financial')!.actions).toBeUndefined();
    expect(a.flags).toEqual([expect.objectContaining({ severity: 'info', rule: 'payback_na' })]);
    expect(a.flags[0]!.text).toMatch(/ข้อมูลด้านการเงินไม่เพียงพอ/);
  });
  it('ไม่มีอายุการใช้งานตามเกณฑ์ → แจ้งว่าเทียบไม่ได้ (ไม่สรุปว่าคุ้มทุน)', () => {
    expect(assessValue({ utilityScore: 70, scores: scores(), paybackYears: 30 }).flags).toEqual([expect.objectContaining({ severity: 'info', rule: 'no_useful_life' })]);
  });
});
