-- 003: ชุดสูตร v1.1 (D-16, อนุมัติ 2 พ.ย. 2569) และการเก็บผลประเมินเมื่อปิดรอบ
UPDATE formula_set SET status = 'retired' WHERE version = '1.0';
INSERT INTO formula_set (version, definition, status, approved_at) VALUES (
  '1.1',
  '{"weights":{"utilization":0.25,"clinical":0.2,"financial":0.2,"reliability":0.15,"satisfaction":0.1,"strategic":0.1},
    "paybackPenalty":15,"paybackDivisor":"min_age_data_years","noRevenueFinancialScore":50,"ratingMultiplier":20,
    "thresholds":{"high":80,"good":60,"medium":40},"warning":{"utilizationBelow":40,"scoreBelow":50},
    "change":"D-16: ตัวหาร Payback = MIN(อายุตามสูตร Excel, จำนวนปีที่มีข้อมูล)",
    "source":"Utility_Analysis_ครุภัณฑ์การแพทย์.xlsx + decisions D-01..D-16, N-06"}'::jsonb,
  'approved', now());

ALTER TABLE score_result
  ADD COLUMN cycle_id uuid REFERENCES assessment_cycle(id),
  ADD COLUMN analysis_year integer,
  ADD COLUMN rank integer;
CREATE INDEX score_result_equipment_idx ON score_result (equipment_id, computed_at DESC);
