# ระบบวิเคราะห์ความคุ้มค่าครุภัณฑ์ทางการแพทย์ (Medical Equipment Utility Analysis)

Web Application สำหรับให้โรงพยาบาลบันทึกข้อมูลการใช้งาน ต้นทุน และผลลัพธ์ของครุภัณฑ์รายปี
คำนวณ Utility Score ตามชุดสูตรที่อนุมัติ (v1.0) และแสดงผลประกอบการตัดสินใจของผู้บริหาร

- เอกสารวิเคราะห์และออกแบบ: [`docs/Phase1-Analysis-Design.md`](docs/Phase1-Analysis-Design.md)
- ภาพ Mockup: [`docs/mockups/`](docs/mockups)

> ข้อมูลในระบบสำหรับพัฒนาเป็นข้อมูลตัวอย่าง (DEMO) ทั้งหมด ไม่ใช่ข้อมูลจริงของหน่วยงาน

## สถานะการพัฒนา

| Sprint | งาน | สถานะ |
|---|---|---|
| — | ชุดสูตร v1.0 + Golden Test เทียบกับ Excel | ✅ เสร็จ |
| 1 | โครงสร้างโปรเจกต์, ฐานข้อมูล, แยกข้อมูลรายโรงพยาบาล (RLS), สิทธิ์ตามบทบาท, Audit Log | ✅ เสร็จ |
| 2 | ทะเบียนครุภัณฑ์ (เพิ่ม/แก้ไข/ค้นหา/ประวัติ), จัดการผู้ใช้ | ✅ เสร็จ (ยังไม่มีการแนบไฟล์) |
| 3 | รอบประเมิน + รายการครบกำหนด + ฟอร์มรายปี + การตรวจยืนยัน | ⏳ ถัดไป |
| 4 | คำนวณ Score จากข้อมูลรายปี + หน้าผลวิเคราะห์ | ⏳ |
| 5 | Dashboard โรงพยาบาล + Dashboard ภาพรวมเครือข่าย + หน้ารายละเอียด 5 ปี | ⏳ |
| 6 | รายงาน PDF/Excel | ⏳ |
| 7 | เชื่อม Provider ID จริง (รอเอกสารจากผู้ดูแลระบบ), Security test, UAT | ⏳ |
| เฟส 2 | แผนจัดซื้อ/ทดแทนปีงบถัดไป | ⏳ |

**ยังไม่ได้เชื่อมต่อ Provider ID** ตอนนี้ใช้ "เข้าสู่ระบบแบบจำลอง" สำหรับพัฒนาเท่านั้น ซึ่งปิดเองเมื่อ `NODE_ENV=production`

## โครงสร้าง

```
packages/formula   ชุดสูตร Utility Score v1.0 (Pure TypeScript) + Golden Test เทียบกับค่าใน Excel
apps/api           Backend: Fastify + PostgreSQL (Row-Level Security แยกข้อมูลแต่ละโรงพยาบาล)
  migrations/      SQL migration
  scripts/         migrate.ts, seed-dev.ts (ข้อมูล DEMO)
  test/            Integration test กับ PostgreSQL จริง
apps/web           Frontend: React + Vite (ภาษาไทย, Responsive)
e2e/smoke.cjs      ทดสอบผ่านเบราว์เซอร์ (Playwright)
docs/              เอกสารวิเคราะห์ ออกแบบ และ Mockup
```

**เทคโนโลยี:** TypeScript ทั้งระบบ เพื่อใช้ชุดสูตรเดียวกันทั้งหน้าเว็บและ Server · Backend ใช้ Fastify 5 แทน NestJS ที่เสนอไว้ในเอกสารแผนพัฒนา (ข้อ 4.1) เพราะโค้ดน้อยกว่าและดูแลง่ายกว่าสำหรับขนาดระบบนี้ · ฐานข้อมูลใช้ SQL ตรงผ่าน `pg` (ไม่ใช้ ORM) เพื่อควบคุม Row-Level Security ได้เต็มที่

## เริ่มใช้งานใน VS Code

สิ่งที่ต้องมี: Node.js 20 ขึ้นไป, Docker Desktop (หรือ PostgreSQL 16)

1. เปิดโฟลเดอร์โปรเจกต์ใน VS Code แล้วติดตั้ง Extension ที่ระบบแนะนำ
2. เปิดฐานข้อมูล:

```bash
docker compose up -d
```

3. ติดตั้ง package:

```bash
npm install
```

4. สร้างไฟล์ตั้งค่า API:

```bash
cp apps/api/.env.example apps/api/.env
```

5. สร้างตารางและบัญชีแอป (อ่านค่าจาก `apps/api/.env`):

```bash
npm run db:migrate
```

6. ใส่ข้อมูลตัวอย่าง (DEMO):

```bash
npm run db:seed
```

7. เปิดระบบ: ใน VS Code ไปที่ **Run and Debug** แล้วเลือก **API + Web** หรือรัน 2 คำสั่งนี้ใน Terminal แยกกัน:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

8. เปิด http://localhost:5173 แล้วเลือกบัญชีตัวอย่างในกล่อง "โหมดพัฒนา"

| บัญชีตัวอย่าง | บทบาท |
|---|---|
| `PID-DEMO-A-ENTRY` | เจ้าหน้าที่บันทึกข้อมูล รพ.ตัวอย่าง A |
| `PID-DEMO-A-ADMIN` | ผู้ดูแลระบบ รพ.ตัวอย่าง A |
| `PID-DEMO-A-REVIEW` | ผู้ตรวจสอบ รพ.ตัวอย่าง A |
| `PID-DEMO-A-EXEC` | ผู้บริหาร รพ.ตัวอย่าง A |
| `PID-DEMO-B-ENTRY` | เจ้าหน้าที่บันทึกข้อมูล รพ.ตัวอย่าง B |
| `PID-DEMO-CA` | ผู้ดูแลระบบส่วนกลาง |
| `PID-DEMO-CE` | ผู้บริหารส่วนกลาง (ดูได้ทุกโรงพยาบาล) |

## การทดสอบ

ทดสอบสูตร (ไม่ต้องใช้ฐานข้อมูล):

```bash
npm test -w @mu/formula
```

ทดสอบ API (ต้องมี PostgreSQL ที่บัญชีสร้าง database ได้ ระบบสร้างและลบฐานข้อมูลทดสอบเอง):

```bash
TEST_PG_ADMIN_URL=postgres://mu_owner:dev_owner_password_change_me@localhost:5432/postgres npm test -w @mu/api
```

ทดสอบผ่านเบราว์เซอร์ (เปิด API + Web และ seed ข้อมูลใหม่ก่อน):

```bash
node e2e/smoke.cjs http://localhost:5173 .
```

## หลักการสำคัญที่ระบบบังคับใช้

- **สูตรตรงกับ Excel:** `packages/formula` ถอดสูตรจากชีต "ข้อมูลครุภัณฑ์" ตรงตัว และทดสอบเทียบกับค่าที่ Excel คำนวณไว้ 8 แถว ห้ามแก้สูตรโดยไม่สร้างเวอร์ชันใหม่
- **ข้อมูลไม่ครบไม่ได้คะแนน (D-08):** ระบบไม่คำนวณ และบอกว่าขาดข้อมูลอะไร
- **แยกข้อมูลรายโรงพยาบาล 2 ชั้น:** API กรองตามโรงพยาบาลของผู้ใช้ และ PostgreSQL Row-Level Security กันซ้ำ แอปเชื่อมต่อด้วยบัญชี `mu_app` ที่ไม่ใช่ owner
- **Audit Log แก้ไม่ได้:** เพิ่มได้อย่างเดียว (trigger + สิทธิ์) และมี hash chain ตรวจการแก้ไขย้อนหลังได้ที่ `GET /api/audit/verify`
- **ไม่เก็บรหัสผ่าน:** session เก็บเฉพาะ hash ของ token, cookie เป็น HttpOnly + SameSite=Strict, คำขอที่เปลี่ยนข้อมูลต้องมี header `x-mu-csrf`
- **แก้ไขพร้อมกัน:** ใช้ version ป้องกันการบันทึกทับข้อมูลที่ผู้อื่นเพิ่งแก้
