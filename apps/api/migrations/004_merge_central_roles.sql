-- ยุบ "ผู้บริหารส่วนกลาง" รวมเข้ากับ "ผู้ดูแลระบบส่วนกลาง" (ผู้ดูแลส่วนกลางมีสิทธิ์ของผู้บริหารส่วนกลางครบอยู่แล้ว)
-- ค่า central_executive ยังอยู่ใน CHECK เพื่อให้ข้อมูลเก่าอ่านได้ แต่ไม่มีผู้ใช้คนใดใช้แล้ว
SELECT set_config('app.scope', 'all', true);

INSERT INTO user_role (user_id, role)
SELECT user_id, 'central_admin' FROM user_role WHERE role = 'central_executive'
ON CONFLICT DO NOTHING;

DELETE FROM user_role WHERE role = 'central_executive';
