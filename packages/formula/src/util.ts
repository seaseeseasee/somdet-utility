/** ตัวช่วยภายในแพ็กเกจ (ไม่ export ออกนอกแพ็กเกจ) */
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
