import type { FactorScores, UtilAdvice, ValueAssessment } from './api';

export const BAND: Record<string, string> = { high: 'g', good: 'b', medium: 'w', low: 'r' };
export const bandOf = (v: number) => (v >= 80 ? 'high' : v >= 60 ? 'good' : v >= 40 ? 'medium' : 'low');
/** 6 ปัจจัย (น้ำหนักมาจากชุดสูตรที่ใช้อยู่ ผ่าน API) */
export const FACTORS: [keyof FactorScores, string][] = [
  ['utilization', 'Utilization'], ['clinical', 'Clinical'], ['financial', 'Financial'],
  ['reliability', 'Reliability'], ['satisfaction', 'Satisfaction'], ['strategic', 'Strategic'],
];
export const weightPct = (w: number | undefined) => (w === undefined ? '' : `${Number((w * 100).toFixed(4))}%`);
export const f1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const f2 = (v: number | null | undefined) => (v === null || v === undefined ? 'N/A' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function ScoreBadge({ v }: { v: number }) {
  return <span className={`score ${BAND[bandOf(v)]} num`}>{f1(v)}</span>;
}
/** สีระดับ Utilization: 5 เขียว · 4 น้ำเงิน · 3 เหลือง · 2 ส้ม · 1 แดง */
const UTIL_TONE: Record<number, string> = { 5: 'g', 4: 'b', 3: 'w', 2: 'o', 1: 'r' };
export function UtilChip({ u }: { u: UtilAdvice | null | undefined }) {
  if (!u) return <span className="chip n" title="ไม่มีข้อมูล Utilization หรือค่าผิดปกติ (ติดลบหรือเกิน 100%)">ไม่จัดระดับ</span>;
  return <span className={`chip ${UTIL_TONE[u.level]}`} title={u.advice}>ระดับ {u.level} {u.label}</span>;
}
export const ADVICE_DISCLAIMER = 'ข้อเสนอแนะเป็นข้อมูลประกอบการพิจารณาของผู้บริหาร ไม่ใช่การตัดสินใจอัตโนมัติ';

const VALUE_TONE: Record<ValueAssessment['level'], string> = { very_worth: 'g', worth: 'b', watch: 'w', not_worth: 'r' };
/** ระดับความคุ้มค่า (เกณฑ์เสริม) + ธงแดงจากกฎเสริม */
export function ValueChip({ a }: { a: ValueAssessment | null | undefined }) {
  if (!a) return null;
  const red = a.flags.filter((f) => f.severity === 'red');
  return (
    <span className="hrow" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <span className={`chip ${VALUE_TONE[a.level]}`} title={a.advice}>{a.label}</span>
      {red.length > 0 && <span className="chip r" title={red.map((f) => f.text).join('\n')}>ธงแดง {red.length}</span>}
    </span>
  );
}

/** ข้อความข้อเสนอแนะ 4 ระดับ (ตรงกับ RECOMMENDATION_TEXT ของชุดสูตร) */
export const REC_TEXT: Record<string, string> = {
  high: 'ซื้อเพิ่ม/อัปเกรดรุ่นใหม่', good: 'คงสภาพ ติดตามต่อเนื่อง', medium: 'ทบทวนแผนการใช้งาน/เพิ่ม Utilization', low: 'พิจารณาทดแทนหรือไม่จัดซื้อเพิ่ม',
};

export function RecChip({ level, text }: { level?: string; text?: string }) {
  return level ? <span className={`chip ${BAND[level]}`}>{text}</span> : null;
}
