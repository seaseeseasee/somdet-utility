import React, { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Equipment, type Option } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CURRENT_BE_YEAR, STATUS, thDate } from '../lib/format';

type Form = Record<string, string>;
const EMPTY: Form = {
  code: '', name: '', typeId: '', departmentId: '', brand: '', model: '', serialNo: '', purchaseYearBe: '', budgetYearBe: '',
  purchasePrice: '', contractNo: '', fundingSource: '', receivedDate: '', startDate: '', usefulLifeYears: '', status: 'in_use',
  maintenancePlan: 'none', statusNote: '',
};
const REQUIRED: [string, string][] = [
  ['code', 'รหัสครุภัณฑ์'], ['name', 'ชื่อครุภัณฑ์'], ['typeId', 'ประเภท'], ['departmentId', 'หน่วยงาน'], ['brand', 'ยี่ห้อ'],
  ['model', 'รุ่น'], ['serialNo', 'Serial Number'], ['purchaseYearBe', 'ปีที่จัดซื้อ'], ['purchasePrice', 'ราคาจัดซื้อ'],
  ['receivedDate', 'วันที่รับเข้า'], ['startDate', 'วันที่เริ่มใช้งาน'],
];

/** ตรวจฝั่งหน้าเว็บให้ตรงกับฝั่ง API (API ตรวจซ้ำอีกครั้งเสมอ) */
function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, l] of REQUIRED) if (!f[k]?.trim()) e[k] = `กรุณากรอก${l}`;
  const y = Number(f.purchaseYearBe);
  if (f.purchaseYearBe && !(Number.isInteger(y) && y >= 2500 && y <= 2700)) e.purchaseYearBe = 'ปี พ.ศ. ต้องอยู่ระหว่าง 2500–2700';
  if (f.purchasePrice && !(Number(f.purchasePrice) > 0)) e.purchasePrice = 'ราคาจัดซื้อต้องมากกว่า 0';
  if (f.usefulLifeYears && !(Number.isInteger(Number(f.usefulLifeYears)) && Number(f.usefulLifeYears) > 0)) e.usefulLifeYears = 'ต้องเป็นจำนวนเต็มมากกว่า 0';
  if (f.receivedDate && f.startDate && f.startDate < f.receivedDate) e.startDate = 'วันที่เริ่มใช้งานต้องไม่ก่อนวันที่รับเข้า';
  if ((f.status === 'repair' || f.status === 'suspended') && !f.statusNote?.trim()) e.statusNote = 'กรุณาระบุเหตุผลเมื่อสถานะเป็นซ่อมหรืองดใช้';
  return e;
}

const toBody = (f: Form) => ({
  ...f,
  purchaseYearBe: Number(f.purchaseYearBe),
  purchasePrice: Number(f.purchasePrice),
  budgetYearBe: f.budgetYearBe ? Number(f.budgetYearBe) : null,
  usefulLifeYears: f.usefulLifeYears ? Number(f.usefulLifeYears) : null,
  contractNo: f.contractNo || null,
  fundingSource: f.fundingSource || null,
  statusNote: f.statusNote || null,
});

function Field(p: { k: string; label: string; req?: boolean; cls?: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className={`fld ${p.cls ?? ''}`}>
      <label htmlFor={p.k}>
        {p.label} {p.req && <span className="req">*</span>}
      </label>
      {p.children}
      {p.error ? <span className="hint e">{p.error}</span> : p.hint && <span className="hint">{p.hint}</span>}
    </div>
  );
}

export function EquipmentForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [form, setForm] = useState<Form>(EMPTY);
  const [version, setVersion] = useState<number | null>(null);
  const [types, setTypes] = useState<Option[]>([]);
  const [depts, setDepts] = useState<Option[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  useEffect(() => {
    api.get<Option[]>('/api/equipment-types').then(setTypes);
    api.get<Option[]>('/api/departments').then(setDepts);
    if (id)
      api.get<Equipment>(`/api/equipment/${id}`).then((e) => {
        setForm({
          code: e.code, name: e.name, typeId: e.type_id, departmentId: e.department_id, brand: e.brand, model: e.model,
          serialNo: e.serial_no, purchaseYearBe: String(e.purchase_year_be), budgetYearBe: e.budget_year_be ? String(e.budget_year_be) : '',
          purchasePrice: String(e.purchase_price), contractNo: e.contract_no ?? '', fundingSource: e.funding_source ?? '',
          receivedDate: e.received_date, startDate: e.start_date, usefulLifeYears: e.useful_life_years ? String(e.useful_life_years) : '',
          status: e.status, maintenancePlan: e.maintenance_plan, statusNote: e.status_note ?? '',
        });
        setVersion(e.version);
        setLoadedAt(e.updated_at);
      });
  }, [id]);

  const set = (k: string) => (ev: { target: { value: string } }) => {
    const next = { ...form, [k]: ev.target.value };
    setForm(next);
    if (touched) setErrors(validate(next));
  };
  const clientErrors = useMemo(() => validate(form), [form]);
  const age = form.purchaseYearBe ? Math.max(CURRENT_BE_YEAR - Number(form.purchaseYearBe), 1) : null;
  const codeLocked = Boolean(id) && !can('equipment.code.change');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const v = validate(form);
    setErrors(v);
    setServerError(null);
    if (Object.keys(v).length) return;
    setSaving(true);
    try {
      const saved = id
        ? await api.put<Equipment>(`/api/equipment/${id}`, { ...toBody(form), version })
        : await api.post<Equipment>('/api/equipment', toBody(form));
      nav(`/equipment/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
        setErrors(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      } else setServerError('บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (!can('equipment.write')) return <div className="note red">ท่านไม่มีสิทธิ์เพิ่มหรือแก้ไขครุภัณฑ์</div>;
  if (id && version === null) return <div className="empty">กำลังโหลดข้อมูลครุภัณฑ์…</div>;

  const txt = (k: string) => (
    <input id={k} className={`in ${errors[k] ? 'err' : ''}`} value={form[k]} onChange={set(k)} aria-invalid={!!errors[k]} />
  );

  return (
    <form className="split" onSubmit={submit} noValidate>
      <div className="stack">
        <div className="card stack">
          <h3 className="sec-t"><span className="n">1</span>ข้อมูลพื้นฐาน</h3>
          <div className="grid-f">
            <Field k="code" label="รหัสครุภัณฑ์ (Code EQU/EQM)" req hint="ไม่ซ้ำภายในโรงพยาบาล" error={errors.code}>
              <input id="code" className={`in ${errors.code ? 'err' : ''}`} value={form.code} onChange={set('code')} readOnly={codeLocked} />
            </Field>
            <Field k="name" label="ชื่อครุภัณฑ์ (ตามทะเบียนพัสดุ)" req cls="span2" error={errors.name}>{txt('name')}</Field>
            <Field k="typeId" label="ประเภทครุภัณฑ์" req error={errors.typeId}>
              <select id="typeId" className={`in ${errors.typeId ? 'err' : ''}`} value={form.typeId} onChange={set('typeId')}>
                <option value="">— เลือก —</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field k="departmentId" label="หน่วยงานที่รับผิดชอบ" req error={errors.departmentId}>
              <select id="departmentId" className={`in ${errors.departmentId ? 'err' : ''}`} value={form.departmentId} onChange={set('departmentId')}>
                <option value="">— เลือก —</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field k="serialNo" label="Serial Number" req hint="ไม่ซ้ำภายในโรงพยาบาล" error={errors.serialNo}>{txt('serialNo')}</Field>
            <Field k="brand" label="ยี่ห้อ" req error={errors.brand}>{txt('brand')}</Field>
            <Field k="model" label="รุ่น" req error={errors.model}>{txt('model')}</Field>
          </div>
        </div>
        <div className="card stack">
          <h3 className="sec-t"><span className="n">2</span>การจัดซื้อและอายุการใช้งาน</h3>
          <div className="grid-f">
            <Field k="purchaseYearBe" label="ปีที่จัดซื้อ (พ.ศ.)" req error={errors.purchaseYearBe}>
              <input id="purchaseYearBe" inputMode="numeric" className={`in num ${errors.purchaseYearBe ? 'err' : ''}`} value={form.purchaseYearBe} onChange={set('purchaseYearBe')} placeholder="เช่น 2566" />
            </Field>
            <Field k="budgetYearBe" label="ปีงบประมาณที่ได้รับจัดสรร" error={errors.budgetYearBe}>{txt('budgetYearBe')}</Field>
            <Field k="purchasePrice" label="ราคาจัดซื้อ (บาท)" req hint="ราคาต่อเครื่อง ไม่ใช่ราคารวมทั้งสัญญา" error={errors.purchasePrice}>
              <input id="purchasePrice" inputMode="decimal" className={`in num ${errors.purchasePrice ? 'err' : ''}`} value={form.purchasePrice} onChange={set('purchasePrice')} />
            </Field>
            <Field k="receivedDate" label="วันที่รับเข้า" req hint={form.receivedDate ? thDate(form.receivedDate) : undefined} error={errors.receivedDate}>
              <input id="receivedDate" type="date" className={`in ${errors.receivedDate ? 'err' : ''}`} value={form.receivedDate} onChange={set('receivedDate')} />
            </Field>
            <Field k="startDate" label="วันที่เริ่มใช้งาน" req hint={form.startDate ? thDate(form.startDate) : undefined} error={errors.startDate}>
              <input id="startDate" type="date" className={`in ${errors.startDate ? 'err' : ''}`} value={form.startDate} onChange={set('startDate')} />
            </Field>
            <Field k="usefulLifeYears" label="อายุการใช้งานตามเกณฑ์ (ปี)" hint="ใช้คำนวณ Cost per Use รายปี" error={errors.usefulLifeYears}>{txt('usefulLifeYears')}</Field>
            <Field k="age" label="อายุที่ใช้งานแล้ว (ปี)" hint={age ? `คำนวณอัตโนมัติ: MAX(${CURRENT_BE_YEAR} − ${form.purchaseYearBe}, 1)` : 'คำนวณเมื่อกรอกปีที่จัดซื้อ'} error={errors.age}>
              <input id="age" className="in calc num" value={age ?? '—'} readOnly tabIndex={-1} />
            </Field>
            <Field k="contractNo" label="เลขที่สัญญา" hint="เครื่องที่ซื้อพร้อมกันใช้เลขสัญญาเดียวกันได้" error={errors.contractNo}>{txt('contractNo')}</Field>
            <Field k="fundingSource" label="แหล่งเงิน" error={errors.fundingSource}>{txt('fundingSource')}</Field>
          </div>
        </div>
        <div className="card stack">
          <h3 className="sec-t"><span className="n">3</span>สถานะปัจจุบัน</h3>
          <div className="radios" role="radiogroup" aria-label="สถานะ">
            {Object.entries(STATUS).map(([k, v]) => (
              <label key={k}><input type="radio" name="status" value={k} checked={form.status === k} onChange={set('status')} />{v.label}</label>
            ))}
          </div>
          <div className="grid-f">
            <Field k="maintenancePlan" label="แผนบำรุงรักษา" error={errors.maintenancePlan}>
              <select id="maintenancePlan" className="in" value={form.maintenancePlan} onChange={set('maintenancePlan')}>
                <option value="yes">มี</option><option value="none">ไม่มี</option><option value="in_progress">อยู่ระหว่างจัดทำ</option>
              </select>
            </Field>
            <Field k="statusNote" label="หมายเหตุสถานะ" cls="span2" req={form.status === 'repair' || form.status === 'suspended'} error={errors.statusNote}>{txt('statusNote')}</Field>
          </div>
        </div>
        <div className="hrow" style={{ justifyContent: 'flex-end' }}>
          <Link className="btn" to={id ? `/equipment/${id}` : '/equipment'}>ยกเลิก</Link>
          <button className="btn p" disabled={saving}>{saving ? 'กำลังบันทึก…' : id ? 'บันทึกการแก้ไข' : 'ลงทะเบียนครุภัณฑ์'}</button>
        </div>
      </div>
      <div className="stack">
        <div className="card stack">
          <h3>ตรวจสอบความถูกต้อง</h3>
          {serverError && <div className="note red" role="alert">{serverError}</div>}
          {Object.keys(clientErrors).length ? (
            <div className="note red">
              <b>ต้องแก้ไข {Object.keys(clientErrors).length} รายการ</b>
              <ul>{Object.values(clientErrors).slice(0, 6).map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          ) : (
            <div className="note blue">ข้อมูลครบตามเงื่อนไข พร้อมบันทึก</div>
          )}
          {Number(form.purchasePrice) > 0 && Number(form.purchasePrice) < 1_000_000 && (
            <div className="note">ราคาต่ำกว่า 1,000,000 บาท ซึ่งอยู่นอกขอบเขตการวิเคราะห์เริ่มต้น แต่บันทึกได้ (D-09)</div>
          )}
          <div className="muted">ระบบตรวจ: ช่องบังคับ · รหัส/Serial ไม่ซ้ำ · ปี พ.ศ. 2500–2700 · ราคา &gt; 0 · วันที่เริ่มใช้ ≥ วันที่รับเข้า</div>
        </div>
        {id && loadedAt && <div className="card muted">แก้ไขล่าสุด {thDate(loadedAt, true)} · เวอร์ชัน {version} — หากมีผู้อื่นแก้ไขระหว่างนี้ ระบบจะแจ้งก่อนบันทึกทับ</div>}
        <div className="note blue">เอกสารหลักฐาน (ใบตรวจรับ, สัญญา) จะแนบได้ใน Sprint ถัดไป</div>
      </div>
    </form>
  );
}
