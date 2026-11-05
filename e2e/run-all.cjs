/**
 * รัน e2e ทั้งชุดตามลำดับ: node e2e/run-all.cjs [baseUrl] [outDir]
 * ต้องใช้ฐานข้อมูลที่ seed ใหม่แบบมีข้อมูลรายปี เพราะชุดทดสอบเพิ่ม/แก้ข้อมูล
 * (annual อยู่ท้ายสุดเพราะยืนยันข้อมูลปี 2569 ซึ่งเปลี่ยนคะแนน)
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
if (args[1]) fs.mkdirSync(args[1], { recursive: true });
const suites = ['smoke', 'scores', 'dashboards', 'reports', 'annual'];
const failed = [];
for (const s of suites) {
  console.log(`\n=== ${s}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, `${s}.cjs`), ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(s);
}
console.log(failed.length ? `\nไม่ผ่าน: ${failed.join(', ')}` : `\nผ่านทั้งหมด ${suites.length} ชุด`);
process.exit(failed.length ? 1 : 0);
