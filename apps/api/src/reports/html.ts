import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REC, SECTION_LABEL, thaiDate, type ReportData } from './data.js';

const require = createRequire(import.meta.url);

/** ฝังฟอนต์ไทย (IBM Plex Sans Thai, OFL) ในรายงาน เพื่อไม่ต้องพึ่งอินเทอร์เน็ตและพิมพ์ภาษาไทยถูกต้อง */
let fontCss: string | null = null;
function fonts() {
  if (fontCss) return fontCss;
  const dir = path.join(path.dirname(require.resolve('@fontsource/ibm-plex-sans-thai/package.json')), 'files');
  fontCss = [400, 600, 700]
    .flatMap((w) =>
      (['thai', 'latin'] as const).map((sub) => {
        const b64 = readFileSync(path.join(dir, `ibm-plex-sans-thai-${sub}-${w}-normal.woff2`)).toString('base64');
        const range = sub === 'thai' ? 'U+0E01-0E5B, U+200C-200D, U+25CC' : 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
        return `@font-face{font-family:'Plex Thai';font-weight:${w};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range}}`;
      }),
    )
    .join('\n');
  return fontCss;
}

/** ฟอนต์สำหรับส่วนท้ายกระดาษของ PDF (Chromium ไม่ส่งต่อฟอนต์ของเนื้อหาไปยัง footer) */
export function footerFontCss() {
  return fonts().split('\n').filter((l) => l.includes('font-weight:400')).join('\n');
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** ตัดข้อความตามตัวอักษรที่มองเห็น (grapheme) ไม่ให้สระ/วรรณยุกต์ไทยหลุดจากพยัญชนะ */
const seg = new Intl.Segmenter('th', { granularity: 'grapheme' });
export function truncate(text: string, max: number) {
  const g = [...seg.segment(text)].map((x) => x.segment);
  return g.length <= max ? text : `${g.slice(0, max - 1).join('')}…`;
}
const n = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const baht = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const BAND: Record<string, string> = { high: '#1b8a55', good: '#2f7bd8', medium: '#c98f00', low: '#c2302b' };
const BAND_BG: Record<string, string> = { high: '#e5f5ec', good: '#e6f0fc', medium: '#fff5d6', low: '#fde9e7' };

/** กราฟแท่งแนวนอน (SVG) — วาดจากสเกลเดียวกันทุกแท่ง */
function barChart(d: ReportData) {
  const rows = [...d.rows].sort((a, b) => b.breakdown.utilityScore - a.breakdown.utilityScore).slice(0, 25);
  if (!rows.length) return '';
  const labelW = 230, plotW = 420, rowH = 20, top = 8, h = top + rows.length * rowH + 26;
  const x = (v: number) => labelW + (v / 100) * plotW;
  const ticks = [0, 20, 40, 60, 80, 100]
    .map((t) => `<line x1="${x(t)}" y1="${top}" x2="${x(t)}" y2="${h - 22}" stroke="#e3e9f1"/><text x="${x(t)}" y="${h - 8}" font-size="10" text-anchor="middle" fill="#4a5a72">${t}</text>`)
    .join('');
  const bars = rows
    .map((r, i) => {
      const y = top + i * rowH;
      const v = r.breakdown.utilityScore;
      const label = truncate(`${r.code} ${r.name}`, 36);
      return `<text x="${labelW - 6}" y="${y + 13}" font-size="10.5" text-anchor="end" fill="#16243a">${esc(label)}</text>
        <rect x="${x(0)}" y="${y + 3}" width="${(v / 100) * plotW}" height="${rowH - 7}" rx="2" fill="${BAND[r.breakdown.recommendation]}"/>
        <text x="${x(v) + 4}" y="${y + 13}" font-size="10" fill="#16243a">${n(v)}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${labelW + plotW + 40} ${h}" width="100%" role="img" aria-label="กราฟ Utility Score รายครุภัณฑ์">${ticks}${bars}</svg>
    ${d.rows.length > 25 ? `<p class="note">แสดง 25 อันดับแรกจาก ${d.rows.length} รายการ</p>` : ''}`;
}

export function renderReportHtml(d: ReportData): string {
  const has = (s: string) => d.sections.includes(s as never);
  const k = d.kpis;
  const multi = d.multiHospital;
  const kpi = `<div class="kpis">
    ${[
      ['ครุภัณฑ์ทั้งหมด', `${k.equipment} รายการ`, `มีคะแนน ${k.scored} รายการ`],
      ['มูลค่ารวม', `${n(k.totalValue / 1e6)} ล้านบาท`, 'ตามราคาจัดซื้อ'],
      ['Utility Score เฉลี่ย', n(k.averageScore), `ธงเตือน ${k.warning} รายการ`],
      ['ซื้อเพิ่ม/อัปเกรด (≥80)', `${k.high} รายการ`, `คงสภาพ (60–79) ${k.good} รายการ`],
      ['ทบทวนแผน (40–59)', `${k.medium} รายการ`, ''],
      ['พิจารณาทดแทน (<40)', `${k.low} รายการ`, ''],
    ].map(([l, v, s]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('')}
  </div>`;
  const ranking = `<h2>ตารางจัดอันดับและข้อเสนอแนะ</h2>
    <table><thead><tr><th class="c">อันดับ</th><th>รายการ</th>${multi ? '<th>โรงพยาบาล</th>' : ''}<th>หน่วยงาน</th><th class="r">ราคา (บาท)</th><th class="c">Score</th><th>ข้อเสนอแนะ</th></tr></thead>
    <tbody>${d.rows.map((r) => `<tr><td class="c">${r.rank ?? '—'}</td><td><b>${esc(r.name)}</b><br><span class="m">${esc(r.code)}${r.breakdown.warning ? ' · <span class="warn">ธงเตือน</span>' : ''}</span></td>${multi ? `<td>${esc(r.hospital)}</td>` : ''}<td>${esc(r.department)}</td><td class="r">${baht(r.purchasePrice)}</td>
      <td class="c"><span class="sc" style="background:${BAND_BG[r.breakdown.recommendation]};color:${BAND[r.breakdown.recommendation]}">${n(r.breakdown.utilityScore)}</span></td><td>${esc(r.breakdown.recommendationText)}</td></tr>`).join('')}</tbody></table>
    ${multi ? '<p class="note">อันดับคิดภายในแต่ละโรงพยาบาล</p>' : ''}`;
  const factors = `<h2>คะแนนแยก 6 ปัจจัย</h2>
    <table class="sm"><thead><tr><th>รายการ</th><th class="r">Utilization<br>25%</th><th class="r">Clinical<br>20%</th><th class="r">Financial<br>20%</th><th class="r">Reliability<br>15%</th><th class="r">Satisfaction<br>10%</th><th class="r">Strategic<br>10%</th><th class="r">Payback<br>(ปี)</th><th class="r">ต้นทุน/เคส<br>(บาท)</th><th class="r">Utility<br>Score</th><th>ปีงบที่ใช้</th></tr></thead>
    <tbody>${d.rows.map((r) => { const s = r.breakdown.scores; return `<tr><td>${esc(r.code)}<br><span class="m">${esc(r.name)}</span></td>
      <td class="r">${n(s.utilization)}</td><td class="r">${n(s.clinical)}</td><td class="r">${n(s.financial)}</td><td class="r">${n(s.reliability)}</td><td class="r">${n(s.satisfaction)}</td><td class="r">${n(s.strategic)}</td>
      <td class="r">${r.breakdown.paybackYears === null ? 'N/A' : n(r.breakdown.paybackYears, 2)}</td><td class="r">${r.breakdown.costPerCase === null ? 'N/A' : baht(r.breakdown.costPerCase)}</td>
      <td class="r"><b>${n(r.breakdown.utilityScore, 2)}</b></td><td>${esc(r.years.join(', '))}</td></tr>`; }).join('')}</tbody></table>`;
  const annual = `<h2 class="pb">ภาคผนวก: ข้อมูลรายปีที่ใช้คำนวณ (ยืนยันแล้ว)</h2>
    <table class="sm"><thead><tr><th>รายการ</th><th class="c">ปีงบ</th><th class="r">ชม.พร้อมใช้</th><th class="r">ชม.ใช้จริง</th><th class="r">ชม.หยุด</th><th class="r">เคส</th><th class="r">ค่าบำรุงรักษา</th><th class="r">รายได้</th><th class="c">คะแนน 1–5<br>C/S/St</th></tr></thead>
    <tbody>${d.annual.map((a) => { const m = ['repairCost', 'partsCost', 'pmCost', 'calibrationCost', 'otherCost'].reduce((s, f) => s + Number(a[f] ?? 0), 0);
      return `<tr><td>${esc(a.code)}${multi ? `<br><span class="m">${esc(a.hospital)}</span>` : ''}</td><td class="c">${esc(a.fiscalYear)}</td><td class="r">${n(a.maxAvailableHours as number, 0)}</td><td class="r">${n(a.actualHours as number, 0)}</td><td class="r">${n(a.downtimeHours as number, 0)}</td>
        <td class="r">${baht(Number(a.caseCount ?? 0))}</td><td class="r">${baht(m)}</td><td class="r">${a.noDirectRevenue ? 'ไม่มีรายได้ตรง' : baht(Number(a.revenue ?? 0))}</td><td class="c">${esc(a.clinicalRating)}/${esc(a.satisfactionRating)}/${esc(a.strategicRating)}</td></tr>`; }).join('')}</tbody></table>`;
  const w = (d.formulaDefinition.weights ?? {}) as Record<string, number>;
  const method = `<h2>วิธีคำนวณและเวอร์ชันสูตร</h2>
    <div class="method">
      <p><b>ชุดสูตร v${esc(d.formulaVersion)}</b> (อนุมัติแล้ว) · Utility Score = Utilization×${w.utilization} + Clinical×${w.clinical} + Financial×${w.financial} + Reliability×${w.reliability} + Satisfaction×${w.satisfaction} + Strategic×${w.strategic}</p>
      <ul>
        <li>Utilization = Σชั่วโมงใช้งานจริง ÷ Σชั่วโมงพร้อมใช้งาน × 100 · Reliability = 100 − Downtime % (Σชั่วโมงหยุด ÷ Σชั่วโมงพร้อมใช้ × 100)</li>
        <li>Clinical / Satisfaction / Strategic = คะแนน 1–5 ของปีล่าสุด × 20</li>
        <li>Payback = ราคาซื้อ ÷ (รายได้รวม ÷ MIN(อายุ, จำนวนปีที่มีข้อมูล)) · Financial = MIN(100, MAX(0, 100 − Payback × 15)) · ไม่มีรายได้ตรง = 50</li>
        <li>ใช้เฉพาะข้อมูลรายปีที่ยืนยันแล้ว ปีงบ ${d.window.from}–${d.window.to} · รายการที่ข้อมูลไม่ครบไม่ได้รับคะแนน</li>
        <li>เกณฑ์: 80–100 ${esc(REC.high)} · 60–79 ${esc(REC.good)} · 40–59 ${esc(REC.medium)} · ต่ำกว่า 40 ${esc(REC.low)} · ธงเตือน: Utilization &lt; 40% หรือ Score &lt; 50</li>
      </ul>
    </div>`;
  const notScored = d.notScored.length
    ? `<h2>รายการที่ยังไม่มีคะแนน (${d.notScored.length})</h2><table class="sm"><thead><tr><th>รายการ</th>${multi ? '<th>โรงพยาบาล</th>' : ''}<th>เหตุผล</th></tr></thead><tbody>${d.notScored
        .map((r) => `<tr><td>${esc(r.code)} ${esc(r.name)}</td>${multi ? `<td>${esc(r.hospital)}</td>` : ''}<td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const sig = (label: string, who?: string) => `<div><div class="line">${esc(who ?? '')}</div>${esc(label)}<br><span class="m">วันที่ ........./........./.........</span></div>`;

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
    ${fonts()}
    @page { size: A4; margin: 16mm 14mm 18mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Plex Thai', Tahoma, sans-serif; color: #16243a; font-size: 11.5px; line-height: 1.5; margin: 0; }
    h1 { font-size: 19px; color: #0a2e5c; text-align: center; margin: 0; }
    h2 { font-size: 14px; color: #0a2e5c; margin: 16px 0 6px; break-after: avoid; }
    .sub { text-align: center; color: #4a5a72; font-size: 12px; }
    .meta { display: flex; justify-content: space-between; gap: 12px; font-size: 10.5px; color: #4a5a72; border-bottom: 2px solid #0a2e5c; padding-bottom: 6px; margin: 10px 0 12px; }
    .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .kpi { border: 1px solid #dce5f0; border-radius: 6px; padding: 7px 10px; break-inside: avoid; }
    .kpi .l { color: #4a5a72; font-size: 10.5px; } .kpi .v { font-size: 16px; font-weight: 700; color: #0a2e5c; } .kpi .s { font-size: 10px; color: #6b7a90; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th { background: #eef4fb; text-align: left; font-weight: 600; font-size: 10.5px; padding: 5px 6px; border-bottom: 1px solid #c9d6e6; }
    td { padding: 5px 6px; border-bottom: 1px solid #edf2f8; vertical-align: top; }
    tr { break-inside: avoid; }
    table.sm { font-size: 10px; } table.sm th { font-size: 9.5px; }
    .r { text-align: right; } .c { text-align: center; } .m { color: #6b7a90; font-size: 10px; }
    .sc { display: inline-block; min-width: 40px; padding: 1px 6px; border-radius: 5px; font-weight: 700; }
    .warn { color: #c2302b; font-weight: 600; }
    .note { color: #6b7a90; font-size: 10px; margin: 4px 0; }
    .method { border: 1px solid #dce5f0; border-radius: 6px; padding: 6px 12px; font-size: 10.5px; break-inside: avoid; }
    .method ul { margin: 4px 0; padding-left: 18px; }
    .sig { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 28px; text-align: center; font-size: 11px; break-inside: avoid; }
    .sig .line { border-bottom: 1px dotted #8a9ab0; height: 26px; margin-bottom: 4px; display: flex; align-items: flex-end; justify-content: center; }
    .pb { break-before: page; }
    .demo { color: #9a6d00; }
    @media screen { body { padding: 28px 32px; } }
  </style></head><body>
    <h1>${esc(d.title)}</h1>
    <div class="sub">${esc(d.subtitle)}</div>
    <div class="meta"><span>หน่วยงาน: <b>${esc(d.scopeLabel)}</b></span><span>ชุดสูตร v${esc(d.formulaVersion)} · ปีวิเคราะห์ ${d.year}</span><span>จัดทำ ${esc(thaiDate(d.generatedAt, true))} · โดย ${esc(d.generatedBy)}</span></div>
    ${has('kpi') ? kpi : ''}
    ${has('chart') ? `<h2>Utility Score รายครุภัณฑ์</h2>${barChart(d) || '<p class="note">ยังไม่มีรายการที่มีคะแนน</p>'}` : ''}
    ${has('ranking') ? ranking : ''}
    ${has('factors') ? factors : ''}
    ${notScored}
    ${has('method') ? method : ''}
    <div class="sig">${sig('ผู้จัดทำ', d.signatures.preparedBy)}${sig('ผู้ตรวจสอบ', d.signatures.reviewedBy)}${sig('ผู้อนุมัติ', d.signatures.approvedBy)}</div>
    ${has('annual') ? annual : ''}
    <p class="note">ส่วนที่แสดง: ${d.sections.map((s) => esc(SECTION_LABEL[s])).join(' · ')} · ตัวเลขทั้งหมดมาจากข้อมูลที่ยืนยันแล้วในระบบ ณ เวลาที่จัดทำรายงาน</p>
  </body></html>`;
}
