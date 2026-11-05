/**
 * ตัวช่วยร่วมของ e2e: เปิด Chromium, เข้าสู่ระบบแบบจำลอง, ตรวจผล และเก็บ JavaScript error
 * ใช้ playwright-core กับ Chromium ของเครื่อง (PDF_CHROMIUM_PATH ใน container ของ API)
 */
const { chromium } = require('playwright-core');

exports.base = process.argv[2] || 'http://localhost:5173';
exports.out = process.argv[3] || '.';

exports.ok = (c, m) => {
  if (!c) throw new Error('FAIL: ' + m);
  console.log('ok -', m);
};

exports.start = async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PDF_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const errors = [];
  /** หน้าใหม่ (บริบทแยก = ผู้ใช้แยก) ที่เข้าสู่ระบบด้วย Provider ID จำลองแล้ว */
  const page = async (pid, { width = 1440, downloads = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'th-TH', acceptDownloads: downloads });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // 401 จาก /api/auth/me ก่อนเข้าสู่ระบบ และ 4xx ที่หน้าจอตั้งใจแสดงเป็นข้อความ เป็นพฤติกรรมปกติ
    p.on('console', (m) => m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    p.on('dialog', (d) => d.accept());
    if (pid) {
      await p.goto(`${exports.base}/login`);
      await p.selectOption('#pid', pid);
      await p.click('text=เข้าสู่ระบบแบบจำลอง');
      await p.waitForURL((u) => !u.pathname.startsWith('/login'));
    }
    return p;
  };
  const finish = async () => {
    exports.ok(errors.length === 0, `ไม่มี JavaScript error (${errors.join(' | ')})`);
    await browser.close();
  };
  return { browser, page, finish };
};

/** id ของครุภัณฑ์จากรหัส (ผ่าน API ด้วยสิทธิ์ของผู้ใช้ในหน้านั้น) */
exports.equipmentId = (p, code) =>
  p.evaluate(async (c) => {
    const r = await (await fetch(`/api/equipment?q=${encodeURIComponent(c)}`)).json();
    return (r.rows ?? r).find((e) => e.code === c)?.id;
  }, code);

exports.run = (fn) => fn().catch((e) => { console.error(e.message); process.exit(1); });
