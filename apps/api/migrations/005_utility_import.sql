-- 005: นำเข้าข้อมูล Utility Analysis จากไฟล์ Excel (ข้อมูลสะสมรายเครื่องตามแบบฟอร์มต้นแบบ)
-- ไม่เก็บคะแนนที่คำนวณได้ (คำนวณตอนอ่านด้วย scoring_settings ที่เปิดใช้) ยกเว้นสำเนาค่าที่ใช้ตอนนำเข้าใน settings_snapshot

-- น้ำหนักและค่าคงที่สำหรับคำนวณคะแนนข้อมูลที่นำเข้า — ผู้ดูแลระบบส่วนกลางเป็นผู้เปิดใช้ มีชุดที่เปิดใช้ได้ชุดเดียว
CREATE TABLE scoring_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  w_utilization    numeric NOT NULL CHECK (w_utilization >= 0),
  w_clinical       numeric NOT NULL CHECK (w_clinical >= 0),
  w_financial      numeric NOT NULL CHECK (w_financial >= 0),
  w_reliability    numeric NOT NULL CHECK (w_reliability >= 0),
  w_satisfaction   numeric NOT NULL CHECK (w_satisfaction >= 0),
  w_strategic      numeric NOT NULL CHECK (w_strategic >= 0),
  payback_penalty  numeric NOT NULL CHECK (payback_penalty >= 0),
  -- NULL = ใช้ปีปัจจุบัน (พ.ศ.) ตามวันที่คำนวณ
  current_year_be  integer CHECK (current_year_be BETWEEN 2500 AND 2700),
  is_active        boolean NOT NULL DEFAULT false,
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('default','manual','import')),
  created_by       uuid REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (abs(w_utilization + w_clinical + w_financial + w_reliability + w_satisfaction + w_strategic - 1) < 0.000001)
);
CREATE UNIQUE INDEX scoring_settings_one_active ON scoring_settings ((true)) WHERE is_active;
-- ค่าเริ่มต้น = ชีต "สมมติฐาน" ของไฟล์ต้นแบบ (ตรงกับชุดสูตร v1.0)
INSERT INTO scoring_settings (w_utilization, w_clinical, w_financial, w_reliability, w_satisfaction, w_strategic, payback_penalty, is_active, source)
VALUES (0.25, 0.20, 0.20, 0.15, 0.10, 0.10, 15, true, 'default');

ALTER TABLE scoring_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY read_any ON scoring_settings FOR SELECT USING (true);
CREATE POLICY central_write ON scoring_settings FOR ALL USING (current_setting('app.scope', true) = 'all')
  WITH CHECK (current_setting('app.scope', true) = 'all');

-- การนำเข้าแต่ละครั้ง
CREATE TABLE utility_import_batch (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       uuid NOT NULL REFERENCES hospital(id),
  filename          text NOT NULL,
  file_sha256       text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by       uuid NOT NULL REFERENCES app_user(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  mode              text NOT NULL CHECK (mode IN ('append','replace')),
  sheets            text[] NOT NULL,
  settings_snapshot jsonb NOT NULL,
  row_count         integer NOT NULL,
  status            text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed'))
);
CREATE INDEX utility_import_batch_sha_idx ON utility_import_batch (hospital_id, file_sha256);

-- ข้อมูลรายเครื่องตามแถวในไฟล์ (เก็บเฉพาะช่องที่กรอก ไม่เก็บช่องสูตร E, N–X)
-- dataset = ชื่อชีต (ชื่อตารางแถว 1 ซ้ำกันได้ระหว่างชีต) อันดับคิดภายใน hospital + dataset
-- ต่อยอดฟิลด์ระดับเครื่อง (รหัส EQU/EQM, Serial, หน่วยงาน) ได้ภายหลังด้วยคอลัมน์ nullable
CREATE TABLE utility_record (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id            uuid NOT NULL REFERENCES hospital(id),
  batch_id               uuid NOT NULL REFERENCES utility_import_batch(id),
  dataset                text NOT NULL,
  dataset_title          text NOT NULL,
  source_sheet           text NOT NULL,
  source_row             integer NOT NULL,
  seq_no                 integer NOT NULL,
  name                   text NOT NULL,
  purchase_year_be       integer CHECK (purchase_year_be BETWEEN 2500 AND 2700),
  purchase_price         numeric(16,2) CHECK (purchase_price >= 0),
  utilization_pct        numeric CHECK (utilization_pct BETWEEN 0 AND 100),
  total_cases            integer CHECK (total_cases >= 0),
  maintenance_cost_total numeric(16,2) CHECK (maintenance_cost_total >= 0),
  downtime_pct           numeric CHECK (downtime_pct BETWEEN 0 AND 100),
  revenue_total          numeric(16,2) CHECK (revenue_total >= 0),
  clinical_rating        numeric CHECK (clinical_rating BETWEEN 1 AND 5),
  satisfaction_rating    numeric CHECK (satisfaction_rating BETWEEN 1 AND 5),
  strategic_rating       numeric CHECK (strategic_rating BETWEEN 1 AND 5),
  data_status            text NOT NULL CHECK (data_status IN ('complete','incomplete')),
  deleted_at             timestamptz
);
CREATE INDEX utility_record_dataset_idx ON utility_record (hospital_id, dataset) WHERE deleted_at IS NULL;
CREATE INDEX utility_record_batch_idx ON utility_record (batch_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['utility_import_batch','utility_record']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_can_see(hospital_id)) WITH CHECK (app_can_see(hospital_id))', t);
  END LOOP;
END $$;
