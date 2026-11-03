import { randomBytes } from 'node:crypto';
import type { FormulaSet } from '@mu/formula';
import type { ParsedSettings, PreviewSheet } from './parse.js';

/** Preview ที่ยังไม่ยืนยัน — ผูกกับผู้ใช้ที่อัปโหลด (ไม่เก็บเนื้อหาไฟล์) */
export interface PendingImport {
  userId: string; hospitalId: string; filename: string; sha: string; createdAt: number;
  sheets: PreviewSheet[]; fileSettings: ParsedSettings | null; activeSettings: FormulaSet & { id: string };
}

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING = 200;

/**
 * ที่เก็บ Preview ในหน่วยความจำของ API (หมดอายุ 30 นาที, สูงสุด 200 รายการ)
 * รองรับ API เครื่องเดียว — ถ้ารันหลายเครื่องต้องย้ายไปเก็บในฐานข้อมูล
 */
class PendingStore {
  private items = new Map<string, PendingImport>();

  private sweep() {
    for (const [k, v] of this.items) if (Date.now() - v.createdAt > PREVIEW_TTL_MS) this.items.delete(k);
    while (this.items.size > MAX_PENDING) this.items.delete(this.items.keys().next().value!);
  }

  add(p: Omit<PendingImport, 'createdAt'>): string {
    this.sweep();
    const token = randomBytes(24).toString('base64url');
    this.items.set(token, { ...p, createdAt: Date.now() });
    return token;
  }

  /** คืน Preview ของผู้ใช้คนนี้ที่ยังไม่หมดอายุ */
  get(token: string, userId: string): PendingImport | null {
    const p = this.items.get(token);
    return p && p.userId === userId && Date.now() - p.createdAt <= PREVIEW_TTL_MS ? p : null;
  }

  delete(token: string) {
    this.items.delete(token);
  }
}

export const pendingImports = new PendingStore();
