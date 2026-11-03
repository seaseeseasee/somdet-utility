/**
 * ชุดสูตร Utility Score v1.0
 *
 * ที่มา: ชีต "ข้อมูลครุภัณฑ์" ของ Utility_Analysis_ครุภัณฑ์การแพทย์.xlsx (คอลัมน์ E, N–X และชีต "สมมติฐาน")
 * ร่วมกับการตัดสินใจ D-01 ถึง D-15 และ N-06 ใน docs/Phase1-Analysis-Design.md ข้อ 1.10
 *
 * ห้ามแก้สูตร น้ำหนัก หรือเกณฑ์ในไฟล์นี้โดยไม่ได้รับอนุมัติ หากต้องเปลี่ยน ให้สร้างชุดสูตรเวอร์ชันใหม่
 * ทุกฟังก์ชันเป็น Pure Function เพื่อให้ทดสอบเทียบกับค่าใน Excel ได้
 */

export * from './formula-set.js';
export * from './cumulative.js';
export * from './annual.js';
export * from './utilization.js';
export * from './value.js';
