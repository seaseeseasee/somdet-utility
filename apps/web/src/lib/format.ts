export const baht = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** แสดงวันที่แบบไทย (พ.ศ.) จาก 'YYYY-MM-DD' หรือ ISO */
export const thDate = (s: string | null | undefined, withTime = false) => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return d.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
};

export const CURRENT_BE_YEAR = new Date().getFullYear() + 543;
/** ปีงบประมาณล่าสุดที่สิ้นสุดแล้ว (ปีงบสิ้นสุด 30 ก.ย.) */
export const latestFiscalYear = () => CURRENT_BE_YEAR - (new Date().getMonth() >= 9 ? 0 : 1);
/** ล้านบาท ทศนิยมไม่เกิน 1 ตำแหน่ง */
export const mb = (v: number) => (v / 1e6).toLocaleString('th-TH', { maximumFractionDigits: 1 });
/** ตัวเลขทั่วไป ทศนิยมไม่เกิน d ตำแหน่ง (ว่าง = —) */
export const num = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d }));
export const ageYears = (purchaseYearBe: number) => Math.max(CURRENT_BE_YEAR - purchaseYearBe, 1);

export const STATUS: Record<string, { label: string; tone: 'g' | 'b' | 'w' | 'r' | 'n' }> = {
  ready: { label: 'พร้อมใช้', tone: 'b' },
  in_use: { label: 'ใช้งาน', tone: 'g' },
  repair: { label: 'ส่งซ่อม', tone: 'w' },
  suspended: { label: 'งดใช้', tone: 'r' },
  pending_disposal: { label: 'รอจำหน่าย', tone: 'r' },
  disposed: { label: 'จำหน่ายแล้ว', tone: 'n' },
};
export const MAINT_PLAN: Record<string, string> = { yes: 'มี', none: 'ไม่มี', in_progress: 'อยู่ระหว่างจัดทำ' };
