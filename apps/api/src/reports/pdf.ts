import { chromium, type Browser } from 'playwright-core';
import { footerFontCss } from './html.js';

/**
 * แปลง HTML เป็น PDF ด้วย Headless Chromium (รองรับการจัดวางสระ/วรรณยุกต์ภาษาไทยถูกต้อง)
 * ตั้งค่า PDF_CHROMIUM_PATH เมื่อติดตั้งบน Server ที่ใช้ Chromium ของระบบ
 * รายงานไม่โหลดทรัพยากรภายนอก (ฟอนต์ฝังในไฟล์) และบล็อกการเชื่อมต่อเครือข่ายทั้งหมด
 */
let browser: Promise<Browser> | null = null;

function getBrowser() {
  if (!browser) {
    browser = chromium
      .launch({ executablePath: process.env.PDF_CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .catch((e) => {
        browser = null;
        throw new Error(`เปิด Chromium สำหรับสร้าง PDF ไม่ได้: ${(e as Error).message.split('\n')[0]}`);
      });
  }
  return browser;
}

export async function htmlToPdf(html: string, footer: string): Promise<Buffer> {
  const b = await getBrowser();
  const ctx = await b.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<style>${footerFontCss()}</style><div style="font-size:8px;color:#6b7a90;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:'Plex Thai',Tahoma,sans-serif">
        <span>${footer.replace(/[<>&]/g, '')}</span><span>หน้า <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await ctx.close();
  }
}

export async function closePdfBrowser() {
  if (browser) {
    const b = await browser.catch(() => null);
    browser = null;
    await b?.close();
  }
}
