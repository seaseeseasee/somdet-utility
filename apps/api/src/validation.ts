import { z } from 'zod';

/** Schema ที่ใช้ร่วมกันหลาย route */
export const Uuid = z.string().uuid();

/** ปี พ.ศ. (รับจาก query/body ที่เป็นข้อความได้) */
export const YearBe = z.coerce.number().int().min(2500, 'ปี พ.ศ. ต้องอยู่ระหว่าง 2500–2700').max(2700, 'ปี พ.ศ. ต้องอยู่ระหว่าง 2500–2700');

/** วันที่รูปแบบ YYYY-MM-DD (ค.ศ.) */
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ YYYY-MM-DD (ค.ศ.)');
