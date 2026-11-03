import { useCallback, useEffect, useState } from 'react';
import { api, type Option } from './api';

/**
 * โหลดข้อมูลด้วย GET แบบเดียวกันทุกหน้า: คืนข้อมูล ข้อผิดพลาด และสถานะกำลังโหลด
 * url = null คือยังไม่โหลด · refreshKey เปลี่ยน = โหลดใหม่ · ไม่ใช้ผลของคำขอเก่าที่ตอบกลับช้ากว่า
 */
export function useApi<T>(url: string | null, refreshKey?: unknown) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: Boolean(url) });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get<T>(url).then(
      (data) => { if (!stale) setState({ data, error: null, loading: false }); },
      (e: Error) => { if (!stale) setState({ data: null, error: e.message, loading: false }); },
    );
    return () => { stale = true; };
  }, [url, tick, refreshKey]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/**
 * รายการตัวเลือก (โรงพยาบาล หน่วยงาน ประเภท) สำหรับ dropdown — โหลดไม่ได้ = รายการว่าง
 * ตัวกรองยังใช้ได้ด้วยค่าเริ่มต้น "ทั้งหมด" จึงไม่ขัดจังหวะผู้ใช้ด้วยข้อความ error
 */
export function useOptions(url: string | null): Option[] {
  return useApi<Option[]>(url).data ?? [];
}

/** เวอร์ชันชุดสูตรที่ใช้อยู่ (ข้อมูลประกอบการแสดงผล — โหลดไม่ได้ = ไม่แสดง) */
export function useFormulaVersion(refreshKey?: unknown, enabled = true): string | null {
  return useApi<{ version: string }>(enabled ? '/api/formula-sets/current' : null, refreshKey).data?.version ?? null;
}
