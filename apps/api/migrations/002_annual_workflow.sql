-- 002: ขั้นตอนบันทึก–ตรวจ–ยืนยันข้อมูลรายปี และรอบการประเมิน (Sprint 3)
ALTER TABLE annual_record
  ADD COLUMN change_reason text,                      -- เหตุผลเมื่อมีข้อสังเกต (ค่าเปลี่ยนจากปีก่อนมาก)
  ADD COLUMN inspection_note text,                    -- บันทึกผลตรวจสภาพเครื่อง (N-04)
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES app_user(id),
  ADD COLUMN approved_at timestamptz,
  ALTER COLUMN other_cost SET DEFAULT 0;

CREATE INDEX annual_record_status_idx ON annual_record (hospital_id, status);
CREATE INDEX review_action_record_idx ON review_action (annual_record_id, at DESC);

ALTER TABLE assessment_cycle
  ADD COLUMN created_by uuid REFERENCES app_user(id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN closed_at timestamptz;

ALTER TABLE assessment_task
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT assessment_task_reasons_check
    CHECK (reasons <@ ARRAY['annual','end_of_life','new','calibration_due']::text[] AND cardinality(reasons) > 0);
