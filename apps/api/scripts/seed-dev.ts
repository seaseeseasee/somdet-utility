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
    // แต่ละโรงพยาบาลมีเจ้าหน้าที่ 1 คน
    { pid: 'PID-DEMO-A-ENTRY', name: 'เจ้าหน้าที่ตัวอย่าง A', h: 'DEMOA', roles: ['data_entry'] },
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
  // [code, Utilization %, เคส/ปี, ค่าบำรุงรักษา/ปี, Downtime %, รายได้/ปี, Clinical, Satisfaction, Strategic] — ตัวเลขตัวอย่าง (DEMO)
  annual: [
    ['DEMO-001', 78, 3200, 400000, 3, 7100000, 4, 4, 4],
    ['DEMO-002', 45, 1100, 110000, 8, 560000, 3, 3, 3],
    ['DEMO-003', 30, 400, 75000, 15, 0, 3, 2, 3],
    ['DEMO-004', 85, 3000, 500000, 4, 12400000, 5, 4, 5],
    ['DEMO-005', 88, 7500, 75000, 2, 2250000, 4, 4, 4],
    ['DEMO-006', 60, 800, 170000, 5, 670000, 4, 3, 4],
    ['DEMO-007', 70, 1200, 80000, 6, 720000, 4, 4, 4],
    ['DEMO-008', 25, 430, 130000, 22, 57000, 2, 2, 2],
  ] as const,
};

export async function seedDemo(adminUrl: string, log = console.log, opts: { annual?: boolean } = {}) {
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
    let annual = 0;
    if (opts.annual) {
      // ข้อมูลรายปีตัวอย่าง (DEMO) ที่เจ้าหน้าที่ยืนยันแล้ว ปีงบ 2565–2568 เพื่อให้หน้าผลวิเคราะห์มีข้อมูล (ปี 2569 เว้นไว้ทดลองกรอก)
      for (const [code, util, casesPerYear, maintPerYear, down, revenuePerYear, k, l, m] of DEMO.annual) {
        const e = (await c.query('SELECT id, hospital_id, purchase_year_be, created_by FROM equipment WHERE code = $1 AND hospital_id = $2', [code, hid.DEMOA])).rows[0];
        for (let fy = Math.max(2565, e.purchase_year_be); fy <= 2568; fy++) {
          const drift = 1 + (fy - 2566) * 0.03;
          const hours = 2500;
          await c.query(
            `INSERT INTO annual_record (hospital_id, equipment_id, fiscal_year_be, available_days, actual_days, max_available_hours, actual_hours,
               use_count, case_count, repair_cost, parts_cost, pm_cost, calibration_cost, other_cost, revenue, no_direct_revenue,
               repair_days, breakdown_count, downtime_hours, clinical_rating, satisfaction_rating, strategic_rating, rating_rationale,
               clinical_necessity, condition, inspected_at, safety_event, recall_status, unit_recommendation, rationale,
               status, created_by, updated_by, approved_by, approved_at, submitted_at)
             VALUES ($1,$2,$3,250,$4,$5,$6,$7,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,$16,$17,$18,$19,'ข้อมูลตัวอย่าง (DEMO)',
               'high','good',$20,false,'none','continue','ข้อมูลตัวอย่าง (DEMO)','approved',$21,$21,$21,now(),now())
             ON CONFLICT (equipment_id, fiscal_year_be) DO NOTHING`,
            [e.hospital_id, e.id, fy, Math.round(250 * Math.min(1, (util / 100) * 1.1)), hours, Math.round(hours * Math.min(0.98, (util / 100) * drift)),
             Math.round(casesPerYear * drift), Math.round(maintPerYear * 0.5), Math.round(maintPerYear * 0.2), Math.round(maintPerYear * 0.2), Math.round(maintPerYear * 0.1),
             revenuePerYear, revenuePerYear === 0, Math.round(down * 2.5), Math.max(1, Math.round(down / 3)), Math.round(hours * down / 100), k, l, m,
             `${fy - 543}-10-05`, e.created_by],
          );
          annual++;
        }
      }
    }
    await c.query('COMMIT');
    log(`seed DEMO: ${DEMO.hospitals.length} โรงพยาบาล, ${DEMO.users.length} ผู้ใช้, ${DEMO.equipment.length} ครุภัณฑ์${opts.annual ? `, ข้อมูลรายปี ${annual} รายการ` : ''}`);
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
  await seedDemo(url, console.log, { annual: process.argv.includes('--annual') });
}
