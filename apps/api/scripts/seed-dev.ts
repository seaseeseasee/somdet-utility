/**
 * ข้อมูลตัวอย่าง (DEMO) สำหรับเครื่องพัฒนาเท่านั้น — ไม่ใช่ข้อมูลจริงของหน่วยงาน
 * ใช้: DATABASE_ADMIN_URL=... npm run seed -w @mu/api
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const DEMO = {
  hospitals: [
    { hcode: 'DEMOA', name: 'โรงพยาบาลตัวอย่าง A (DEMO)', province: 'จังหวัดตัวอย่าง 1' },
    { hcode: 'DEMOB', name: 'โรงพยาบาลตัวอย่าง B (DEMO)', province: 'จังหวัดตัวอย่าง 2' },
  ],
  users: [
    { pid: 'PID-DEMO-CA', name: 'ผู้ดูแลส่วนกลางตัวอย่าง', h: null, roles: ['central_admin'] },
    { pid: 'PID-DEMO-CE', name: 'ผู้บริหารส่วนกลางตัวอย่าง', h: null, roles: ['central_executive'] },
    { pid: 'PID-DEMO-A-ADMIN', name: 'ผู้ดูแลตัวอย่าง A', h: 'DEMOA', roles: ['hospital_admin'] },
    { pid: 'PID-DEMO-A-ENTRY', name: 'เจ้าหน้าที่ตัวอย่าง A', h: 'DEMOA', roles: ['data_entry'] },
    { pid: 'PID-DEMO-A-REVIEW', name: 'ผู้ตรวจตัวอย่าง A', h: 'DEMOA', roles: ['reviewer'] },
    { pid: 'PID-DEMO-A-EXEC', name: 'ผู้บริหารตัวอย่าง A', h: 'DEMOA', roles: ['executive'] },
    { pid: 'PID-DEMO-A-PENDING', name: 'ผู้ใช้ใหม่ตัวอย่าง A', h: 'DEMOA', roles: [] },
    { pid: 'PID-DEMO-B-ADMIN', name: 'ผู้ดูแลตัวอย่าง B', h: 'DEMOB', roles: ['hospital_admin'] },
    { pid: 'PID-DEMO-B-ENTRY', name: 'เจ้าหน้าที่ตัวอย่าง B', h: 'DEMOB', roles: ['data_entry'] },
  ],
  departments: {
    DEMOA: ['กลุ่มงานรังสีวิทยา', 'หอผู้ป่วยวิกฤต', 'ศูนย์ส่องกล้อง', 'หน่วยไตเทียม', 'กลุ่มงานพยาธิวิทยา'],
    DEMOB: ['กลุ่มงานรังสีวิทยา', 'กลุ่มงานจิตเวช'],
  } as Record<string, string[]>,
  // [hcode, code, name, type, dept, brand, model, sn, year, price, status]
  equipment: [
    ['DEMOA', 'DEMO-001', 'เครื่อง CT Scan', 'รังสีวินิจฉัย', 'กลุ่มงานรังสีวิทยา', 'DemoMed', 'CT-128', 'DM-CT-0001', 2566, 25000000, 'in_use'],
    ['DEMOA', 'DEMO-002', 'เครื่อง Ultrasound', 'รังสีวินิจฉัย', 'กลุ่มงานรังสีวิทยา', 'DemoSono', 'US-5', 'DM-US-0002', 2565, 3500000, 'in_use'],
    ['DEMOA', 'DEMO-003', 'เครื่อง Ventilator', 'ช่วยชีวิต', 'หอผู้ป่วยวิกฤต', 'DemoAir', 'V-300', 'DM-VT-0003', 2567, 1800000, 'repair'],
    ['DEMOA', 'DEMO-004', 'เครื่อง MRI 1.5T', 'รังสีวินิจฉัย', 'กลุ่มงานรังสีวิทยา', 'DemoMag', 'MR-15', 'DM-MR-0004', 2564, 32000000, 'in_use'],
    ['DEMOA', 'DEMO-005', 'เครื่องเอกซเรย์ดิจิทัล', 'รังสีวินิจฉัย', 'กลุ่มงานรังสีวิทยา', 'DemoRay', 'DR-2', 'DM-XR-0005', 2565, 4500000, 'in_use'],
    ['DEMOA', 'DEMO-006', 'ชุดกล้องส่องตรวจทางเดินอาหาร', 'ส่องตรวจ', 'ศูนย์ส่องกล้อง', 'DemoScope', 'ES-7', 'DM-ES-0006', 2566, 5200000, 'in_use'],
    ['DEMOA', 'DEMO-007', 'เครื่องไตเทียม', 'บำบัดรักษา', 'หน่วยไตเทียม', 'DemoKid', 'HD-4', 'DM-HD-0007', 2563, 1200000, 'in_use'],
    ['DEMOA', 'DEMO-008', 'เครื่องวิเคราะห์ภูมิคุ้มกันอัตโนมัติ', 'ห้องปฏิบัติการ', 'กลุ่มงานพยาธิวิทยา', 'DemoLab', 'IA-9', 'DM-IA-0008', 2562, 2800000, 'suspended'],
    ['DEMOB', 'DEMO-B01', 'เครื่องเอกซเรย์ดิจิทัล', 'รังสีวินิจฉัย', 'กลุ่มงานรังสีวิทยา', 'DemoRay', 'DR-2', 'DM-XR-B001', 2566, 4200000, 'in_use'],
    ['DEMOB', 'DEMO-B02', 'เครื่องกระตุ้นสมองด้วยสนามแม่เหล็ก', 'กระตุ้นสมอง/จิตเวช', 'กลุ่มงานจิตเวช', 'DemoNeuro', 'TMS-1', 'DM-TMS-B002', 2568, 2500000, 'in_use'],
  ] as const,
};

export async function seedDemo(adminUrl: string, log = console.log) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.scope','all',true)");
    const hid: Record<string, string> = {};
    for (const h of DEMO.hospitals)
      hid[h.hcode] = (
        await c.query(
          `INSERT INTO hospital (hcode, name, province) VALUES ($1,$2,$3)
           ON CONFLICT (hcode) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [h.hcode, h.name, h.province],
        )
      ).rows[0].id;
    const dep: Record<string, string> = {};
    for (const [hc, names] of Object.entries(DEMO.departments))
      for (const n of names)
        dep[`${hc}/${n}`] = (
          await c.query(
            `INSERT INTO department (hospital_id, name) VALUES ($1,$2)
             ON CONFLICT (hospital_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [hid[hc], n],
          )
        ).rows[0].id;
    const uid: Record<string, string> = {};
    for (const u of DEMO.users) {
      uid[u.pid] = (
        await c.query(
          `INSERT INTO app_user (provider_id, name, hospital_id, status) VALUES ($1,$2,$3,$4)
           ON CONFLICT (provider_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [u.pid, u.name, u.h ? hid[u.h] : null, u.roles.length ? 'active' : 'pending'],
        )
      ).rows[0].id;
      for (const r of u.roles) await c.query('INSERT INTO user_role VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid[u.pid], r]);
    }
    const types = Object.fromEntries((await c.query('SELECT id, name FROM equipment_type')).rows.map((r) => [r.name, r.id]));
    for (const [hc, code, name, type, d, brand, model, sn, year, price, status] of DEMO.equipment) {
      const by = uid[hc === 'DEMOA' ? 'PID-DEMO-A-ENTRY' : 'PID-DEMO-B-ENTRY'];
      await c.query(
        `INSERT INTO equipment (hospital_id, code, name, type_id, department_id, brand, model, serial_no, purchase_year_be,
           purchase_price, received_date, start_date, status, status_note, maintenance_plan, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,'yes',$14,$14)
         ON CONFLICT (hospital_id, code) DO NOTHING`,
        [hid[hc], code, name, types[type], dep[`${hc}/${d}`], brand, model, sn, year, price, `${year - 543}-01-15`, status,
         status === 'repair' || status === 'suspended' ? 'ข้อมูลตัวอย่าง (DEMO)' : null, by],
      );
    }
    await c.query('COMMIT');
    log(`seed DEMO: ${DEMO.hospitals.length} โรงพยาบาล, ${DEMO.users.length} ผู้ใช้, ${DEMO.equipment.length} ครุภัณฑ์`);
    return { hid, uid, dep, types };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('ต้องกำหนด DATABASE_ADMIN_URL');
  await seedDemo(url);
}
