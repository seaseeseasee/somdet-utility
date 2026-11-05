-- 008: ลบตารางที่เลิกใช้แล้ว (ไม่มีโค้ดเขียนข้อมูลลง และไม่มีข้อมูลนอกจากค่าเริ่มต้นของ scoring_settings)
-- - scoring_settings: แทนด้วย formula_set ตั้งแต่ migration 007
-- - score_result: คะแนนคำนวณตอนอ่านจากข้อมูลรายปี/ข้อมูลนำเข้า ไม่เก็บผลไว้
-- - assessment_cycle / assessment_task: เลิกใช้รอบประเมิน (กรอกข้อมูลรายปีได้ทุกเมื่อ)

DROP TABLE assessment_task;
DROP TABLE score_result;
DROP TABLE assessment_cycle;
DROP TABLE scoring_settings;
