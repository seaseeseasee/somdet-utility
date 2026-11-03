-- 006: ข้อมูลที่นำเข้าจาก Excel สร้างเป็นครุภัณฑ์ในทะเบียน
-- ครุภัณฑ์ที่สร้างจากไฟล์ใช้ค่าชั่วคราวในช่องที่ไฟล์ไม่มี (รหัส IMP-..., หน่วยงาน "ไม่ระบุหน่วยงาน") และติดธงรอกรอกข้อมูลเพิ่ม
-- คะแนนใช้ข้อมูลสะสมจากไฟล์จนกว่าครุภัณฑ์นั้นจะมีข้อมูลรายปีที่ยืนยันแล้ว

ALTER TABLE equipment
  ADD COLUMN details_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN imported_batch_id uuid REFERENCES utility_import_batch(id);

ALTER TABLE utility_record
  ADD COLUMN equipment_id uuid REFERENCES equipment(id) ON DELETE SET NULL;
CREATE INDEX utility_record_equipment_idx ON utility_record (equipment_id) WHERE deleted_at IS NULL;

ALTER TABLE utility_import_batch ADD COLUMN registered_count integer NOT NULL DEFAULT 0;
