import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';

/** ใส่ , คั่นหลักพันให้ส่วนจำนวนเต็ม (ค่าที่ไม่ใช่ตัวเลขคงไว้ตามเดิม เพื่อให้การตรวจข้อมูลแจ้งผิดได้) */
export const groupDigits = (raw: string) => {
  const m = /^(-?)(\d+)(\.\d*)?$/.exec(raw);
  return m?.[2] ? (m[1] ?? '') + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] ?? '') : raw;
};

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | undefined;
  onChange: (e: { target: { value: string } }) => void;
};

/** ช่องกรอกจำนวนเงิน: แสดงแบบมีหลักพัน (2,500,000) แต่ส่งค่าออกเป็นตัวเลขล้วน (2500000) */
export function MoneyInput({ value, onChange, className, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  // จำนวนอักขระที่ไม่ใช่ , ก่อนเคอร์เซอร์ เพื่อคงตำแหน่งเคอร์เซอร์หลังใส่/ลบ ,
  const caret = useRef<number | null>(null);
  const shown = groupDigits(value ?? '');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caret.current === null || document.activeElement !== el) return;
    let left = caret.current, pos = 0;
    while (pos < shown.length && left > 0) { if (shown[pos] !== ',') left--; pos++; }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  }, [shown]);

  return (
    <input {...rest} ref={ref} inputMode="decimal" className={className} value={shown}
      onChange={(e) => {
        const v = e.target.value;
        caret.current = v.slice(0, e.target.selectionStart ?? v.length).replace(/,/g, '').length;
        onChange({ target: { value: v.replace(/,/g, '') } });
      }} />
  );
}
