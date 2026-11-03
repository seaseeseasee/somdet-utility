-- 007: ผู้ดูแลระบบส่วนกลางสร้างชุดสูตรเวอร์ชันใหม่ได้จากหน้า "สมมติฐานและน้ำหนักคะแนน"
-- ชุดสูตรเดียวใช้กับทั้งข้อมูลรายปีและข้อมูลที่นำเข้าจาก Excel (แทน scoring_settings ซึ่งเลิกใช้แล้ว เก็บไว้เป็นประวัติ)
-- เวอร์ชันเดิมห้ามแก้ definition: แอปเพิ่มเวอร์ชันใหม่ได้และเปลี่ยนสถานะเวอร์ชันเก่าเป็น retired เท่านั้น (สิทธิ์กำหนดใน migrate.ts)

CREATE UNIQUE INDEX formula_set_one_approved ON formula_set ((true)) WHERE status = 'approved';

ALTER TABLE formula_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE formula_set FORCE ROW LEVEL SECURITY;
CREATE POLICY read_any ON formula_set FOR SELECT USING (true);
CREATE POLICY central_write ON formula_set FOR ALL USING (current_setting('app.scope', true) = 'all')
  WITH CHECK (current_setting('app.scope', true) = 'all');

-- ปีปัจจุบันของข้อมูลนำเข้าเดิมย้ายมาอยู่ในชุดสูตร (null = ใช้ปีปัจจุบันตามวันที่)
COMMENT ON TABLE scoring_settings IS 'เลิกใช้ตั้งแต่ migration 007 — ใช้ formula_set แทน';
