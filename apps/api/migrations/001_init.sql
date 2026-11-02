-- 001_init: โครงสร้างฐานข้อมูลหลัก (เฟสที่ 1)
-- ทุกตารางที่เป็นข้อมูลของโรงพยาบาลมี hospital_id และเปิด Row-Level Security
-- แอปเชื่อมต่อด้วย role ที่ไม่ใช่ owner (mu_app) และตั้งค่า app.scope / app.hospital_id ในทุก transaction

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------ master
CREATE TABLE hospital (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hcode       text NOT NULL UNIQUE CHECK (hcode ~ '^[0-9A-Za-z]{3,10}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  province    text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE department (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES hospital(id),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  UNIQUE (hospital_id, name)
);

CREATE TABLE equipment_type (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL UNIQUE
);

-- ------------------------------------------------------------------ users
CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    text NOT NULL UNIQUE CHECK (length(provider_id) BETWEEN 3 AND 100),
  name           text NOT NULL,
  hospital_id    uuid REFERENCES hospital(id),           -- NULL = ผู้ใช้ส่วนกลาง
  department_id  uuid REFERENCES department(id),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE user_role (
  user_id  uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role     text NOT NULL CHECK (role IN ('central_admin','central_executive','hospital_admin','data_entry','reviewer','executive')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE session (
  token_hash  text PRIMARY KEY,                 -- sha256 ของ token (ไม่เก็บ token จริง)
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          inet,
  user_agent  text
);
CREATE INDEX session_user_idx ON session(user_id);

-- ------------------------------------------------------------------ equipment
CREATE TABLE equipment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id        uuid NOT NULL REFERENCES hospital(id),
  code               text NOT NULL CHECK (length(code) BETWEEN 1 AND 50),
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  type_id            uuid NOT NULL REFERENCES equipment_type(id),
  department_id      uuid NOT NULL REFERENCES department(id),
  brand              text NOT NULL,
  model              text NOT NULL,
  serial_no          text NOT NULL,
  purchase_year_be   integer NOT NULL CHECK (purchase_year_be BETWEEN 2500 AND 2700),
  budget_year_be     integer CHECK (budget_year_be BETWEEN 2500 AND 2700),
  purchase_price     numeric(14,2) NOT NULL CHECK (purchase_price > 0),
  contract_no        text,
  funding_source     text,
  received_date      date NOT NULL,
  start_date         date NOT NULL,
  useful_life_years  integer CHECK (useful_life_years > 0),
  status             text NOT NULL CHECK (status IN ('ready','in_use','repair','suspended','pending_disposal','disposed')),
  maintenance_plan   text NOT NULL DEFAULT 'none' CHECK (maintenance_plan IN ('yes','none','in_progress')),
  status_note        text,
  created_by         uuid NOT NULL REFERENCES app_user(id),
  updated_by         uuid NOT NULL REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  UNIQUE (hospital_id, code),
  UNIQUE (hospital_id, serial_no),
  CHECK (start_date >= received_date)
);
CREATE INDEX equipment_hospital_idx ON equipment(hospital_id, status);

-- ------------------------------------------------------------------ annual data (ใช้งานใน Sprint 3)
CREATE TABLE annual_record (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES hospital(id),
  equipment_id         uuid NOT NULL REFERENCES equipment(id),
  fiscal_year_be       integer NOT NULL CHECK (fiscal_year_be BETWEEN 2500 AND 2700),
  available_days       numeric(5,1), actual_days numeric(5,1),
  max_available_hours  numeric(7,1), actual_hours numeric(7,1),
  use_count            integer, case_count integer,
  repair_cost numeric(14,2), parts_cost numeric(14,2), pm_cost numeric(14,2),
  calibration_cost numeric(14,2), other_cost numeric(14,2),
  revenue              numeric(14,2), no_direct_revenue boolean NOT NULL DEFAULT false,
  repair_days numeric(5,1), breakdown_count integer, downtime_hours numeric(7,1),
  clinical_rating numeric(2,1) CHECK (clinical_rating BETWEEN 1 AND 5),
  satisfaction_rating numeric(2,1) CHECK (satisfaction_rating BETWEEN 1 AND 5),
  strategic_rating numeric(2,1) CHECK (strategic_rating BETWEEN 1 AND 5),
  rating_rationale     text,
  clinical_necessity   text CHECK (clinical_necessity IN ('high','medium','low')),
  condition            text CHECK (condition IN ('good','fair','broken')),
  inspected_at date, inspected_by uuid REFERENCES app_user(id),
  safety_event boolean, safety_detail text,
  recall_status text CHECK (recall_status IN ('none','past','ongoing')),
  unit_recommendation text CHECK (unit_recommendation IN ('continue','increase_use','repair','reallocate','replace','decommission')),
  rationale text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','locked')),
  created_by uuid NOT NULL REFERENCES app_user(id), updated_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (equipment_id, fiscal_year_be)
);

CREATE TABLE maintenance_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital(id),
  annual_record_id uuid NOT NULL REFERENCES annual_record(id) ON DELETE CASCADE,
  event_date date NOT NULL, kind text NOT NULL CHECK (kind IN ('repair','pm','calibration','other')),
  detail text, cost numeric(14,2) CHECK (cost >= 0), work_order_no text
);

CREATE TABLE review_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital(id),
  annual_record_id uuid NOT NULL REFERENCES annual_record(id),
  action text NOT NULL CHECK (action IN ('submit','approve','reject','unlock','lock')),
  reason text, actor_id uuid NOT NULL REFERENCES app_user(id), at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital(id),
  owner_type text NOT NULL CHECK (owner_type IN ('equipment','annual_record')),
  owner_id uuid NOT NULL,
  filename text NOT NULL, mime text NOT NULL, size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL, storage_key text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES app_user(id), uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ formula & scores
CREATE TABLE formula_set (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  definition jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','approved','retired')),
  approved_by uuid REFERENCES app_user(id), approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE score_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital(id),
  equipment_id uuid NOT NULL REFERENCES equipment(id),
  formula_set_id uuid NOT NULL REFERENCES formula_set(id),
  basis text NOT NULL CHECK (basis IN ('cumulative','annual')),
  period_from integer NOT NULL, period_to integer NOT NULL,
  inputs_snapshot jsonb NOT NULL, breakdown jsonb NOT NULL,
  utility_score numeric(9,6) NOT NULL, recommendation text NOT NULL, warning boolean NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ assessment cycle (ใช้งานใน Sprint 3)
CREATE TABLE assessment_cycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital(id),
  fiscal_year_be integer NOT NULL, opens_at date NOT NULL, closes_at date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  UNIQUE (hospital_id, fiscal_year_be), CHECK (closes_at >= opens_at)
);

CREATE TABLE assessment_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital(id),
  cycle_id uuid NOT NULL REFERENCES assessment_cycle(id),
  equipment_id uuid NOT NULL REFERENCES equipment(id),
  reasons text[] NOT NULL,
  assignee_id uuid REFERENCES app_user(id), due_date date NOT NULL,
  annual_record_id uuid REFERENCES annual_record(id),
  UNIQUE (cycle_id, equipment_id)
);

-- ------------------------------------------------------------------ audit (append-only + hash chain)
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  hospital_id uuid REFERENCES hospital(id),
  actor_id    uuid REFERENCES app_user(id),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  at          timestamptz NOT NULL DEFAULT now(),
  prev_hash   text NOT NULL,
  hash        text NOT NULL
);
CREATE INDEX audit_entity_idx ON audit_log(entity, entity_id);
CREATE INDEX audit_hospital_idx ON audit_log(hospital_id, at DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log เป็นแบบเพิ่มได้อย่างเดียว ห้ามแก้ไขหรือลบ'; END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ------------------------------------------------------------------ Row-Level Security
-- app.scope = 'all' (ผู้ใช้ส่วนกลาง) หรือ 'hospital' (เห็นเฉพาะ app.hospital_id)
CREATE FUNCTION app_can_see(h uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.scope', true) = 'all'
      OR (current_setting('app.scope', true) = 'hospital'
          AND h = nullif(current_setting('app.hospital_id', true), '')::uuid)
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['department','equipment','annual_record','maintenance_event','review_action',
                           'attachment','score_result','assessment_cycle','assessment_task']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant ON %I USING (app_can_see(hospital_id)) WITH CHECK (app_can_see(hospital_id))', t);
  END LOOP;
END $$;

ALTER TABLE hospital ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospital FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON hospital FOR SELECT USING (app_can_see(id) OR current_setting('app.scope', true) = 'auth');
CREATE POLICY central_write ON hospital FOR ALL USING (current_setting('app.scope', true) = 'all')
  WITH CHECK (current_setting('app.scope', true) = 'all');

-- ผู้ใช้: ส่วนกลางเห็นทุกคน ผู้ใช้ รพ. เห็นเฉพาะคนใน รพ. เดียวกัน ส่วนขั้นตอน login (scope = 'auth') ค้นหาด้วย provider_id ได้
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON app_user
  USING (current_setting('app.scope', true) IN ('all','auth') OR app_can_see(hospital_id))
  WITH CHECK (current_setting('app.scope', true) IN ('all','auth') OR app_can_see(hospital_id));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY read_tenant ON audit_log FOR SELECT USING (app_can_see(hospital_id));
CREATE POLICY insert_any ON audit_log FOR INSERT WITH CHECK (true);

-- ------------------------------------------------------------------ seed: ชุดสูตร v1.0 (อนุมัติ 2 พ.ย. 2569)
INSERT INTO formula_set (version, definition, status, approved_at) VALUES (
  '1.0',
  '{"weights":{"utilization":0.25,"clinical":0.2,"financial":0.2,"reliability":0.15,"satisfaction":0.1,"strategic":0.1},
    "paybackPenalty":15,"noRevenueFinancialScore":50,"ratingMultiplier":20,
    "thresholds":{"high":80,"good":60,"medium":40},"warning":{"utilizationBelow":40,"scoreBelow":50},
    "source":"Utility_Analysis_ครุภัณฑ์การแพทย์.xlsx + decisions D-01..D-15, N-06"}'::jsonb,
  'approved', now());

INSERT INTO equipment_type (name) VALUES
  ('รังสีวินิจฉัย'),('ห้องปฏิบัติการ'),('ช่วยชีวิต'),('บำบัดรักษา'),('ส่องตรวจ'),('กระตุ้นสมอง/จิตเวช'),('อื่น ๆ');
