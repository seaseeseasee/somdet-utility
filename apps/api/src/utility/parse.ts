import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { HttpError } from '../errors.js';
import { canRegister } from './register.js';
import { missingFields, scoreDataset, settingsProblems, type ScoringSettings, type UtilityInput } from './score.js';

/**
 * อ่านไฟล์ Utility_Analysis_...xlsx (แบบฟอร์มต้นแบบ) ในหน่วยความจำ — ไม่รันมาโคร ไม่เชื่อค่าที่สูตรในไฟล์คำนวณไว้
 * ชีตข้อมูล: แถว 1 = ชื่อตาราง, แถว 3 = หัวตาราง, ข้อมูลเริ่มแถว 4 จนเจอแถวว่างหรือแถว "หมายเหตุ"
 */

export const LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 5000 };

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** รับเฉพาะ .xlsx: นามสกุล + signature ของ zip + ไม่มีมาโคร (vbaProject.bin) */
export function checkFile(buf: Buffer, filename: string) {
  if (!/\.xlsx$/i.test(filename)) throw new HttpError(400, 'รับเฉพาะไฟล์ .xlsx (ไม่รับ .xls หรือ .xlsm)');
  if (!buf.length) throw new HttpError(400, 'ไฟล์ว่าง');
  if (buf.length > LIMITS.maxBytes) throw new HttpError(413, `ไฟล์ใหญ่เกิน ${LIMITS.maxBytes / 1024 / 1024} MB`);
  if (!buf.subarray(0, 4).equals(ZIP_SIGNATURE)) throw new HttpError(400, 'ไฟล์ไม่ใช่ .xlsx ที่ถูกต้อง');
  // ชื่อไฟล์ใน zip ไม่ถูกบีบอัด จึงค้นจากข้อมูลดิบได้
  if (buf.includes('vbaProject.bin')) throw new HttpError(400, 'ไฟล์มีมาโคร ระบบไม่รับไฟล์ที่มีมาโคร');
}

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** รวมช่องว่างและการขึ้นบรรทัดใหม่ ตัดอักขระควบคุม */
export const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

type Cell =
  | { kind: 'empty' }
  | { kind: 'value'; v: string | number }
  | { kind: 'formula'; result: unknown }
  | { kind: 'error'; text: string }
  | { kind: 'other' };

function readCell(c: ExcelJS.Cell): Cell {
  const v = c.value;
  if (v === null || v === undefined) return { kind: 'empty' };
  if (typeof v === 'number') return { kind: 'value', v };
  if (typeof v === 'string') return v.trim() === '' ? { kind: 'empty' } : { kind: 'value', v };
  if (typeof v === 'boolean' || v instanceof Date) return { kind: 'other' };
  if ('formula' in v || 'sharedFormula' in v) return { kind: 'formula', result: (v as { result?: unknown }).result };
  if ('error' in v) return { kind: 'error', text: String((v as ExcelJS.CellErrorValue).error) };
  if ('richText' in v) {
    const t = (v as ExcelJS.CellRichTextValue).richText.map((x) => x.text).join('');
    return t.trim() === '' ? { kind: 'empty' } : { kind: 'value', v: t };
  }
  if ('text' in v) return { kind: 'value', v: String((v as ExcelJS.CellHyperlinkValue).text) };
  return { kind: 'other' };
}

const isBlank = (c: Cell) =>
  c.kind === 'empty' || (c.kind === 'formula' && (c.result === null || c.result === undefined || c.result === ''));
const textOf = (c: Cell) => (c.kind === 'value' ? clean(String(c.v)) : c.kind === 'formula' && typeof c.result === 'string' ? clean(c.result) : '');

/** อ่านช่องตัวเลขที่ผู้ใช้กรอก — สูตรหรือค่า error ในช่องกรอกถือเป็นข้อผิดพลาดของแถว */
function readNumber(c: Cell, label: string, opt: { int?: boolean; min?: number; max?: number }, errors: string[]): number | null {
  if (c.kind === 'empty') return null;
  if (c.kind === 'formula') return errors.push(`${label}: เป็นสูตร ต้องเป็นค่าที่กรอก`), null;
  if (c.kind === 'error') return errors.push(`${label}: ค่าในไฟล์ผิดพลาด (${c.text})`), null;
  if (c.kind === 'other') return errors.push(`${label}: ไม่ใช่ตัวเลข`), null;
  let n: number;
  if (typeof c.v === 'number') n = c.v;
  else {
    const s = c.v.replace(/[,\s]/g, '');
    if (s === '') return null;
    n = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
  }
  if (!Number.isFinite(n)) return errors.push(`${label}: ไม่ใช่ตัวเลข ("${clean(String(c.v)).slice(0, 30)}")`), null;
  if (opt.int && !Number.isInteger(n)) return errors.push(`${label}: ต้องเป็นจำนวนเต็ม`), null;
  if (opt.min !== undefined && n < opt.min) return errors.push(`${label}: ต้องไม่น้อยกว่า ${opt.min}`), null;
  if (opt.max !== undefined && n > opt.max) return errors.push(`${label}: ต้องไม่เกิน ${opt.max}`), null;
  return n;
}

/** หัวตารางแถว 3 ที่ใช้ระบุว่าเป็นชีตข้อมูล (เทียบหลัง normalize) */
const HEADER_CHECK: [string, (h: string) => boolean][] = [
  ['B', (h) => h === 'รายการครุภัณฑ์'],
  ['C', (h) => h.startsWith('ปีที่ซื้อ')],
  ['D', (h) => h.startsWith('ราคาซื้อ')],
  ['F', (h) => h.includes('Utilization')],
  ['G', (h) => h.startsWith('จำนวนเคส')],
  ['H', (h) => h.startsWith('ค่าบำรุงรักษา')],
  ['I', (h) => h.startsWith('Downtime')],
  ['J', (h) => h.startsWith('รายได้')],
  ['K', (h) => h.includes('ทางคลินิก')],
  ['L', (h) => h.includes('ความพึงพอใจ')],
  ['M', (h) => h.includes('เชิงกลยุทธ์')],
];

const isDataSheet = (ws: ExcelJS.Worksheet) => HEADER_CHECK.every(([col, ok]) => ok(textOf(readCell(ws.getCell(`${col}3`)))));
const isExampleSheet = (name: string) => clean(name).startsWith('ตัวอย่าง');

export interface ParsedRow {
  sourceRow: number;
  /** ลำดับตามแถวจริงที่อ่านได้ (ไม่ใช้คอลัมน์ A ซึ่งบางแถวเป็นสูตร) */
  seqNo: number;
  name: string;
  input: UtilityInput;
  errors: string[];
  warnings: string[];
  /** Utility Score ที่สูตรในไฟล์คำนวณไว้ (V) — ใช้เทียบเพื่อเตือนเท่านั้น */
  cachedScore: number | null;
}

export interface ParsedSheet {
  sheet: string;
  title: string;
  isExample: boolean;
  rows: ParsedRow[];
}

export interface ParsedSettings {
  values: ScoringSettings | null;
  problems: string[];
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  /** ชีตที่ไม่ใช่ชีตข้อมูลและไม่ได้นำเข้า */
  ignoredSheets: string[];
  settings: ParsedSettings | null;
}

function parseDataSheet(ws: ExcelJS.Worksheet): ParsedSheet {
  const title = textOf(readCell(ws.getCell('A1'))) || clean(ws.name);
  const rows: ParsedRow[] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = Object.fromEntries('ABCDEFGHIJKLM'.split('').map((col) => [col, readCell(row.getCell(col))])) as Record<string, Cell>;
    if (textOf(cells.A!).startsWith('หมายเหตุ') || textOf(cells.B!).startsWith('หมายเหตุ')) break;
    if (Object.values(cells).every(isBlank)) break;
    if (rows.length >= LIMITS.maxRows) throw new HttpError(400, `ไฟล์มีข้อมูลเกิน ${LIMITS.maxRows} แถว`);

    const errors: string[] = [];
    const warnings: string[] = [];
    let name = '';
    if (cells.B!.kind === 'formula') errors.push('รายการครุภัณฑ์: เป็นสูตร ต้องเป็นค่าที่กรอก');
    else if (cells.B!.kind === 'error') errors.push(`รายการครุภัณฑ์: ค่าในไฟล์ผิดพลาด (${cells.B!.text})`);
    else name = textOf(cells.B!).slice(0, 500);
    if (!name && !errors.length) errors.push('ไม่มีชื่อรายการครุภัณฑ์');

    const input: UtilityInput = {
      purchaseYearBe: readNumber(cells.C!, 'ปีที่ซื้อ (พ.ศ.)', { int: true, min: 2500, max: 2700 }, errors),
      purchasePrice: readNumber(cells.D!, 'ราคาซื้อ', { min: 0 }, errors),
      utilizationPct: readNumber(cells.F!, 'Utilization (%)', { min: 0, max: 100 }, errors),
      totalCases: readNumber(cells.G!, 'จำนวนเคสสะสม', { int: true, min: 0 }, errors),
      maintenanceCostTotal: readNumber(cells.H!, 'ค่าบำรุงรักษาสะสม', { min: 0 }, errors),
      downtimePct: readNumber(cells.I!, 'Downtime (%)', { min: 0, max: 100 }, errors),
      revenueTotal: readNumber(cells.J!, 'รายได้สะสม', { min: 0 }, errors),
      clinicalRating: readNumber(cells.K!, 'คะแนนผลลัพธ์ทางคลินิก', { min: 1, max: 5 }, errors),
      satisfactionRating: readNumber(cells.L!, 'คะแนนความพึงพอใจ', { min: 1, max: 5 }, errors),
      strategicRating: readNumber(cells.M!, 'คะแนนมูลค่าเชิงกลยุทธ์', { min: 1, max: 5 }, errors),
    };
    if (cells.H!.kind === 'empty') warnings.push('ค่าบำรุงรักษาว่าง ใช้ 0');
    if (cells.G!.kind === 'empty') warnings.push('จำนวนเคสว่าง ใช้ 0 (ต้นทุนต่อเคส = N/A)');
    if (!errors.some((e) => e.startsWith('รายได้')) && !input.revenueTotal) warnings.push('ไม่มีข้อมูลรายได้ (Financial Score = 50)');

    const v = readCell(row.getCell('V'));
    const cachedScore = v.kind === 'formula' && typeof v.result === 'number' ? v.result : v.kind === 'value' && typeof v.v === 'number' ? v.v : null;
    rows.push({ sourceRow: r, seqNo: rows.length + 1, name, input, errors, warnings, cachedScore });
  }
  return { sheet: ws.name, title, isExample: isExampleSheet(ws.name), rows };
}

/** ชีต "สมมติฐาน": B4:B9 น้ำหนัก, B10 ตัวคูณ Payback, B11 ปีปัจจุบัน (พ.ศ.) */
function parseSettingsSheet(ws: ExcelJS.Worksheet): ParsedSettings {
  const problems: string[] = [];
  const num = (addr: string, label: string) => {
    const c = readCell(ws.getCell(addr));
    if (c.kind === 'formula') return typeof c.result === 'number' ? c.result : (problems.push(`${label} (${addr}): สูตรไม่มีค่าที่คำนวณได้`), NaN);
    return readNumber(c, `${label} (${addr})`, {}, problems) ?? NaN;
  };
  const values: ScoringSettings = {
    weights: {
      utilization: num('B4', 'น้ำหนัก Utilization'),
      clinical: num('B5', 'น้ำหนัก Clinical'),
      financial: num('B6', 'น้ำหนัก Financial'),
      reliability: num('B7', 'น้ำหนัก Reliability'),
      satisfaction: num('B8', 'น้ำหนัก Satisfaction'),
      strategic: num('B9', 'น้ำหนัก Strategic'),
    },
    paybackPenalty: num('B10', 'ตัวคูณ Payback'),
    currentYearBe: (() => {
      const y = num('B11', 'ปีปัจจุบัน');
      return Number.isNaN(y) ? null : y;
    })(),
  };
  problems.push(...settingsProblems(values));
  return problems.length ? { values: null, problems: [...new Set(problems)] } : { values, problems };
}

export async function parseWorkbook(buf: Buffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, 'อ่านไฟล์ Excel ไม่ได้ ไฟล์อาจเสียหายหรือไม่ใช่ .xlsx');
  }
  const sheets: ParsedSheet[] = [];
  const ignoredSheets: string[] = [];
  let settings: ParsedSettings | null = null;
  let total = 0;
  for (const ws of wb.worksheets) {
    if (clean(ws.name) === 'สมมติฐาน') settings = parseSettingsSheet(ws);
    else if (isDataSheet(ws)) {
      const s = parseDataSheet(ws);
      total += s.rows.length;
      if (total > LIMITS.maxRows) throw new HttpError(400, `ไฟล์มีข้อมูลเกิน ${LIMITS.maxRows} แถว`);
      sheets.push(s);
    } else ignoredSheets.push(ws.name);
  }
  if (!sheets.length) throw new HttpError(400, 'ไม่พบชีตข้อมูลตามแบบฟอร์ม (หัวตารางแถว 3: รายการครุภัณฑ์, ปีที่ซื้อ, ราคาซื้อ, ...)');
  return { sheets, ignoredSheets, settings };
}

// ---------------------------------------------------------------- Preview

export type RowStatus = 'ok' | 'warning' | 'incomplete' | 'error';

export interface PreviewRow extends ParsedRow {
  status: RowStatus;
  /** จะสร้างเป็นครุภัณฑ์ในทะเบียนเมื่อยืนยัน */
  register: boolean;
  missing: string[];
  utilityScore: number | null;
  rank: number | null;
  recommendation: string | null;
  paybackYears: number | null;
  financialScore: number | null;
}

export interface PreviewSheet {
  sheet: string;
  title: string;
  isExample: boolean;
  /** ค่าเริ่มต้นของการเลือกนำเข้า (ชีตตัวอย่างไม่เลือก) */
  selected: boolean;
  rows: PreviewRow[];
  summary: Record<RowStatus, number>;
}

const FIELD_LABEL: [keyof UtilityInput, string][] = [
  ['purchaseYearBe', 'ปีที่ซื้อ'], ['purchasePrice', 'ราคาซื้อ'], ['utilizationPct', 'Utilization'], ['totalCases', 'จำนวนเคส'],
  ['maintenanceCostTotal', 'ค่าบำรุงรักษา'], ['downtimePct', 'Downtime'], ['revenueTotal', 'รายได้'], ['clinicalRating', 'คะแนนคลินิก'],
  ['satisfactionRating', 'คะแนนความพึงพอใจ'], ['strategicRating', 'คะแนนกลยุทธ์'],
];
const key = (s: string) => clean(s).toLowerCase();

/** ตรวจและคำนวณคะแนนสำหรับ Preview (ยังไม่เขียนฐานข้อมูล) */
export function buildPreview(wb: ParsedWorkbook, settings: ScoringSettings, now = new Date()): PreviewSheet[] {
  const out = wb.sheets.map((s): PreviewSheet => {
    const usable = s.rows.filter((r) => !r.errors.length);
    const scored = new Map(scoreDataset(usable.map((r) => ({ ...r.input, ref: r })), settings, now).map((x) => [x.row.ref, x]));

    // ชื่อ+ปี+ราคาซ้ำในชีตเดียวกัน — เตือนเท่านั้น ให้ผู้ใช้ตัดสินใจเอง
    const dupKey = (r: ParsedRow) => `${key(r.name)}|${r.input.purchaseYearBe}|${r.input.purchasePrice}`;
    const dupCount = new Map<string, number[]>();
    for (const r of s.rows) if (r.name) dupCount.set(dupKey(r), [...(dupCount.get(dupKey(r)) ?? []), r.sourceRow]);

    const rows = s.rows.map((r): PreviewRow => {
      const missing = r.errors.length ? [] : missingFields(r.input);
      // แถวที่ไม่ครบไม่คำนวณคะแนน จึงไม่ต้องเตือนเรื่องช่องว่างที่ใช้ค่าแทน
      const warnings = missing.length ? [] : [...r.warnings];
      const x = scored.get(r);
      const dups = dupCount.get(dupKey(r)) ?? [];
      if (r.name && dups.length > 1) warnings.push(`ชื่อ+ปี+ราคาซ้ำกับแถว ${dups.filter((n) => n !== r.sourceRow).join(', ')} ตรวจสอบว่าเป็นคนละเครื่องหรือไม่`);
      if (x?.score && r.cachedScore !== null && Math.abs(r.cachedScore - x.score.utilityScore) > 0.01)
        warnings.push(`สูตรในไฟล์ผิดปกติ: ไฟล์คำนวณได้ ${r.cachedScore.toFixed(2)} แต่ค่าที่ถูกต้อง = ${x.score.utilityScore.toFixed(2)}`);
      const register = !r.errors.length && canRegister(r.input);
      if (!r.errors.length && !register) warnings.push('ไม่สร้างในทะเบียนครุภัณฑ์ เพราะไม่มีปีที่ซื้อหรือราคาซื้อ (เก็บไว้เป็นข้อมูลนำเข้าเท่านั้น)');
      const status: RowStatus = r.errors.length ? 'error' : missing.length ? 'incomplete' : warnings.length ? 'warning' : 'ok';
      return {
        ...r,
        warnings,
        status,
        register,
        missing,
        utilityScore: x?.score?.utilityScore ?? null,
        rank: x?.rank ?? null,
        recommendation: x?.score?.recommendationText ?? null,
        paybackYears: x?.score?.paybackYears ?? null,
        financialScore: x?.score?.scores.financial ?? null,
      };
    });
    return { sheet: s.sheet, title: s.title, isExample: s.isExample, selected: !s.isExample, rows, summary: summarize(rows) };
  });

  // ชื่อเครื่องเดียวกันในหลายชีต (ไม่นับชีตตัวอย่าง) แต่ค่าต่างกัน
  const real = out.filter((s) => !s.isExample);
  for (const s of real)
    for (const r of s.rows) {
      if (!r.name) continue;
      for (const o of real) {
        if (o === s) continue;
        const same = o.rows.filter((x) => key(x.name) === key(r.name));
        if (!same.length) continue;
        // เทียบกับแถวที่ใกล้เคียงที่สุด (ต่างกันน้อยช่องที่สุด) เพื่อไม่เตือนเกินเมื่อชื่อซ้ำหลายแถว
        const diffs = same
          .map((x) => FIELD_LABEL.filter(([k]) => x.input[k] !== r.input[k]).map(([k, l]) => `${l} ${r.input[k] ?? 'ว่าง'} ในชีตนี้ แต่ ${x.input[k] ?? 'ว่าง'} ในชีต "${o.sheet}" แถว ${x.sourceRow}`))
          .sort((a, b) => a.length - b.length)[0]!;
        if (diffs.length) {
          r.warnings.push(`ชื่อเดียวกันในชีต "${o.sheet}" แต่ค่าต่างกัน: ${diffs.join('; ')}`);
          if (r.status === 'ok') r.status = 'warning';
        }
      }
    }
  for (const s of out) s.summary = summarize(s.rows);
  return out;
}

function summarize(rows: PreviewRow[]): Record<RowStatus, number> {
  const s: Record<RowStatus, number> = { ok: 0, warning: 0, incomplete: 0, error: 0 };
  for (const r of rows) s[r.status]++;
  return s;
}
