import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type AnnualDetail, type Issue, type YearList } from '../lib/api';
import { useAuth } from '../lib/auth';
import { baht, thDate } from '../lib/format';
import { MoneyInput } from '../lib/MoneyInput';
import { useFormulaVersion } from '../lib/useApi';
import { MONEY, RATINGS, RELIABILITY, TONE, UNIT_REC, USAGE, toBody, toForm, type Form, type NumField } from './annual/annualForm.model';
import { CalcPanel, Field, MaintenanceSection, ReviewHistory, StatusSteps, UnlockCard, type Act } from './annual/AnnualFormParts';

export function AnnualForm() {
  const { id, year } = useParams();
  const fy = Number(year);
  const nav = useNavigate();
  const { can } = useAuth();
  const [years, setYears] = useState<YearList | null>(null);
  const [d, setD] = useState<AnnualDetail | null>(null);
  const [form, setForm] = useState<Form>(toForm(null));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: string; text: string; list?: Issue[] } | null>(null);
  const formulaVersion = useFormulaVersion();

  const load = useCallback(async () => {
    const [y, det] = await Promise.all([api.get<YearList>(`/api/equipment/${id}/annual`), api.get<AnnualDetail>(`/api/equipment/${id}/annual/${fy}`)]);
    setYears(y);
    setD(det);
    setForm(toForm(det.data));
    setDirty(false);
  }, [id, fy]);
  useEffect(() => { setMsg(null); void load().catch((e: Error) => setMsg({ tone: 'red', text: e.message })); }, [load]);

  const status = d?.record?.status ?? 'new';
  const editable = can('annual.write') && (status === 'new' || status === 'draft');
  const issues = useMemo(() => Object.fromEntries((d?.evaluation?.errors ?? []).map((e) => [e.field, e.message])), [d]);

  const set = (k: string) => (e: { target: { value: string } }) => { setForm({ ...form, [k]: e.target.value }); setDirty(true); };
  const act: Act = async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'fiscalYear' in r) { setD(r as AnnualDetail); setForm(toForm((r as AnnualDetail).data)); setDirty(false); }
      else await load();
      setYears(await api.get<YearList>(`/api/equipment/${id}/annual`));
      setMsg({ tone: 'blue', text: ok });
    } catch (e) {
      if (e instanceof ApiError) setMsg({ tone: 'red', text: e.message, list: e.issues });
      else setMsg({ tone: 'red', text: 'ดำเนินการไม่สำเร็จ' });
    } finally { setBusy(false); }
  };
  const save = () => act(() => api.put<AnnualDetail>(`/api/equipment/${id}/annual/${fy}`, toBody(form, d?.record?.version)), 'บันทึกร่างแล้ว');
  const submit = () => act(async () => {
    const det = await api.put<AnnualDetail>(`/api/equipment/${id}/annual/${fy}`, toBody(form, d?.record?.version));
    setD(det);
    setDirty(false);
    return api.post<AnnualDetail>(`/api/annual/${det.record!.id}/submit`);
  }, 'ยืนยันข้อมูลแล้ว ข้อมูลนี้ใช้คำนวณ Utility Score ได้');

  if (!d || !years) return msg ? <div className="note red">{msg.text}</div> : <div className="empty">กำลังโหลด…</div>;
  const num = (f: NumField) => (
    <Field key={f[0]} k={f[0]} label={f[1]} req={f[3]} hint={f[4] ?? f[2]} issue={issues[f[0]]}>
      {f[2] === 'บาท'
        ? <MoneyInput id={f[0]} className={`in num ${issues[f[0]] ? 'err' : ''}`} value={String(form[f[0]] ?? '')} onChange={set(f[0])} disabled={!editable} />
        : <input id={f[0]} inputMode="decimal" className={`in num ${issues[f[0]] ? 'err' : ''}`} value={String(form[f[0]] ?? '')} onChange={set(f[0])} disabled={!editable} />}
    </Field>
  );
  const maint = d.evaluation?.metrics?.maintenanceCost ?? MONEY.reduce((s, f) => s + (Number(form[f[0]]) || 0), 0);

  return (
    <>
      <div className="card hrow between">
        <div>
          <div className="muted"><Link to={`/equipment/${d.equipment.id}`}>{d.equipment.code}</Link> · ซื้อปี {d.equipment.purchase_year_be} · {baht(d.equipment.purchase_price)} บาท</div>
          <div className="hrow"><b style={{ fontSize: 19, color: 'var(--navy)' }}>{d.equipment.name}</b>
            <span className={`chip ${TONE[status] ?? 'n'}`}>{d.record?.statusLabel ?? 'ยังไม่บันทึก'}</span></div>
          <div className="muted">ปีงบประมาณ {fy}: {thDate(d.period.from)} – {thDate(d.period.to)}</div>
        </div>
        <StatusSteps status={status} />
      </div>

      <nav className="tabs" aria-label="ปีงบประมาณ">
        {years.years.map((y) => (
          <Link key={y.fiscalYear} to={`/equipment/${id}/annual/${y.fiscalYear}`} className={`tab ${y.fiscalYear === fy ? 'on' : ''}`}
            onClick={(e) => { if (dirty && y.fiscalYear !== fy && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก ต้องการเปลี่ยนปีโดยไม่บันทึกหรือไม่')) e.preventDefault(); }}>
            ปีงบ {y.fiscalYear} <span className={`chip ${y.status ? TONE[y.status] : 'n'}`}>{y.statusLabel}</span>
          </Link>
        ))}
      </nav>

      {msg && (
        <div className={`note ${msg.tone}`} role="status">
          <b>{msg.text}</b>
          {msg.list && msg.list.length > 0 && <ul>{msg.list.slice(0, 8).map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul>}
        </div>
      )}
      {!editable && status !== 'new' && (
        <div className="note blue">
          {status === 'draft' ? 'ท่านดูข้อมูลได้อย่างเดียว' : `ข้อมูลอยู่ในสถานะ "${d.record?.statusLabel}" แก้ไขไม่ได้`}
          {can('annual.unlock') && status !== 'draft' && ' · กด "ปลดล็อกเพื่อแก้ไข" ด้านขวาหากต้องแก้ (ต้องระบุเหตุผล)'}
        </div>
      )}

      <div className="split">
        <div className="stack">
          <div className="card stack">
            <h3 className="sec-t"><span className="n">A</span>ข้อมูลการใช้งาน</h3>
            <div className="grid-f">{USAGE.map(num)}</div>
          </div>
          <div className="card stack">
            <h3 className="sec-t"><span className="n">B</span>ข้อมูลการเงิน (บาท/ปี)</h3>
            <div className="grid-f">
              {MONEY.map(num)}
              <Field k="maintTotal" label="รวมค่าบำรุงรักษา" hint="ซ่อม + อะไหล่ + PM + สอบเทียบ + อื่น ๆ (D-03)">
                <input id="maintTotal" className="in calc num" readOnly tabIndex={-1} value={baht(maint)} />
              </Field>
              <Field k="revenue" label="รายได้จากการให้บริการ" req issue={issues.revenue} hint="ถ้าไม่มีรายได้ตรง ให้กรอก 0 และเลือกช่องด้านล่าง (Financial Score = 50)">
                <MoneyInput id="revenue" className={`in num ${issues.revenue ? 'err' : ''}`} value={String(form.revenue)} onChange={set('revenue')} disabled={!editable} />
              </Field>
              <div className="fld" style={{ justifyContent: 'center' }}>
                <label className="hrow" style={{ fontWeight: 400 }}>
                  <input type="checkbox" checked={Boolean(form.noDirectRevenue)} disabled={!editable}
                    onChange={(e) => { setForm({ ...form, noDirectRevenue: e.target.checked, revenue: e.target.checked ? '0' : (form.revenue ?? '') }); setDirty(true); }} />
                  ไม่มีรายได้ตรง
                </label>
              </div>
            </div>
          </div>
          <div className="card stack">
            <h3 className="sec-t"><span className="n">C</span>ความน่าเชื่อถือ</h3>
            <div className="grid-f">{RELIABILITY.map(num)}</div>
            <MaintenanceSection d={d} editable={editable} busy={busy} act={act} />
          </div>
          <div className="card stack">
            <h3 className="sec-t"><span className="n">D</span>ผลลัพธ์ ความปลอดภัย และการตรวจสภาพเครื่อง</h3>
            <div className="grid-f">
              {RATINGS.map(([k, l, h]) => (
                <Field key={k} k={k} label={l} req hint={h} issue={issues[k]}>
                  <input id={k} type="number" min={1} max={5} step={0.1} className={`in num ${issues[k] ? 'err' : ''}`} value={String(form[k])} onChange={set(k)} disabled={!editable} />
                </Field>
              ))}
              <Field k="ratingRationale" label="เหตุผลประกอบคะแนน 1–5" req cls="full" issue={issues.ratingRationale} hint="ระบุแหล่งข้อมูล เช่น แบบสอบถาม ตัวชี้วัดคุณภาพ (D-13)">
                <textarea id="ratingRationale" className="in" value={String(form.ratingRationale)} onChange={set('ratingRationale')} disabled={!editable} />
              </Field>
              <Field k="condition" label="ผลตรวจสภาพเครื่อง" req issue={issues.condition}>
                <select id="condition" className="in" value={String(form.condition)} onChange={set('condition')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="good">ดี</option><option value="fair">พอใช้</option><option value="broken">ชำรุด</option>
                </select>
              </Field>
              <Field k="inspectedAt" label="วันที่ตรวจสภาพ" req issue={issues.inspectedAt} hint={form.inspectedAt ? thDate(String(form.inspectedAt)) : undefined}>
                <input id="inspectedAt" type="date" className="in" value={String(form.inspectedAt)} onChange={set('inspectedAt')} disabled={!editable} />
              </Field>
              <Field k="inspectionNote" label="บันทึกผลตรวจ">
                <input id="inspectionNote" className="in" value={String(form.inspectionNote)} onChange={set('inspectionNote')} disabled={!editable} />
              </Field>
              <Field k="clinicalNecessity" label="ความจำเป็นทางคลินิก" req issue={issues.clinicalNecessity}>
                <select id="clinicalNecessity" className="in" value={String(form.clinicalNecessity)} onChange={set('clinicalNecessity')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="high">สูง</option><option value="medium">ปานกลาง</option><option value="low">ต่ำ</option>
                </select>
              </Field>
              <Field k="safetyEvent" label="เหตุการณ์ความปลอดภัย" req issue={issues.safetyEvent}>
                <select id="safetyEvent" className="in" value={String(form.safetyEvent)} onChange={set('safetyEvent')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="no">ไม่มี</option><option value="yes">มี (ระบุ)</option>
                </select>
              </Field>
              <Field k="recallStatus" label="สถานะ Recall" req issue={issues.recallStatus}>
                <select id="recallStatus" className="in" value={String(form.recallStatus)} onChange={set('recallStatus')} disabled={!editable}>
                  <option value="">— เลือก —</option><option value="none">ไม่มี</option><option value="past">เคย Recall</option><option value="ongoing">อยู่ระหว่าง Recall</option>
                </select>
              </Field>
              {form.safetyEvent === 'yes' && (
                <Field k="safetyDetail" label="รายละเอียดเหตุการณ์ความปลอดภัย" req cls="full" issue={issues.safetyDetail}>
                  <textarea id="safetyDetail" className="in" value={String(form.safetyDetail)} onChange={set('safetyDetail')} disabled={!editable} />
                </Field>
              )}
              <Field k="unitRecommendation" label="ข้อเสนอแนะของหน่วยงาน" req issue={issues.unitRecommendation}>
                <select id="unitRecommendation" className="in" value={String(form.unitRecommendation)} onChange={set('unitRecommendation')} disabled={!editable}>
                  <option value="">— เลือก —</option>{Object.entries(UNIT_REC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field k="rationale" label="เหตุผลประกอบข้อเสนอแนะ" req cls="span2" issue={issues.rationale}>
                <input id="rationale" className="in" value={String(form.rationale)} onChange={set('rationale')} disabled={!editable} />
              </Field>
            </div>
          </div>
          {editable && (
            <div className="hrow between">
              <span className="muted">{dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : d.record ? `บันทึกล่าสุด ${thDate(d.record.updatedAt, true)}` : 'ยังไม่ได้บันทึก'} · ข้อมูลปีอื่นไม่ถูกเขียนทับ</span>
              <div className="hrow">
                <button className="btn" disabled={busy} onClick={() => void save()}>บันทึกร่าง</button>
                <button className="btn p" disabled={busy} onClick={() => void submit()}>ยืนยันข้อมูล</button>
              </div>
            </div>
          )}
        </div>

        <div className="stack sticky">
          <CalcPanel d={d} fy={fy} form={form} set={set} editable={editable} dirty={dirty} status={status} formulaVersion={formulaVersion} />
          {/* key ตามปีและสถานะ: เปลี่ยนปีหรือปลดล็อกสำเร็จแล้ว ช่องเหตุผลจะถูกล้างเหมือนเดิม */}
          {d.record && can('annual.unlock') && ['approved', 'locked', 'submitted'].includes(status) && (
            <UnlockCard key={`${fy}-${status}`} d={d} busy={busy} act={act} />
          )}
          <ReviewHistory reviews={d.reviews} />
          <button className="btn ghost" onClick={() => nav(`/equipment/${d.equipment.id}`)}>← กลับไปหน้าครุภัณฑ์</button>
        </div>
      </div>
    </>
  );
}
