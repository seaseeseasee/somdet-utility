export class ApiError extends Error {
  constructor(public status: number, message: string, public issues: { field: string; message: string }[] = []) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-mu-csrf': '1' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const issues = data?.issues ?? (Array.isArray(data?.details) ? data.details : []);
    throw new ApiError(res.status, data?.error ?? `เกิดข้อผิดพลาด (${res.status})`, issues);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export interface Me {
  id: string; providerId: string; name: string; scope: 'all' | 'hospital';
  hospital: { id: string; hcode: string; name: string } | null;
  roles: { role: string; label: string }[]; permissions: string[];
}
export interface Equipment {
  id: string; hospital_id: string; hospital_name: string; code: string; name: string; type_id: string; type_name: string;
  department_id: string; department_name: string; brand: string; model: string; serial_no: string; purchase_year_be: number;
  budget_year_be: number | null; purchase_price: number; contract_no: string | null; funding_source: string | null;
  received_date: string; start_date: string; useful_life_years: number | null; status: string; maintenance_plan: string;
  status_note: string | null; created_at: string; updated_at: string; version: number;
}
export interface Paged<T> { total: number; page: number; pageSize: number; rows: T[] }
export interface Option { id: string; name: string }

export interface Issue { field: string; message: string }
export interface Evaluation {
  errors: Issue[]; warnings: Issue[]; needsChangeReason: boolean; completeness: number;
  metrics: { maintenanceCost: number; utilizationPctHours: number | null; utilizationPctDays: number | null; availabilityPct: number | null; downtimePct: number | null; costPerUse: number | null } | null;
}
export interface AnnualDetail {
  equipment: { id: string; code: string; name: string; purchase_year_be: number; purchase_price: number; useful_life_years: number | null; hospital_id: string };
  fiscalYear: number; period: { from: string; to: string };
  record: { id: string; status: string; statusLabel: string; version: number; createdBy: string; updatedBy: string; updatedAt: string; submittedAt: string | null; approvedAt: string | null } | null;
  data: Record<string, unknown> | null; previousYear: Record<string, unknown> | null; evaluation: Evaluation | null;
  reviews: { action: string; reason: string | null; at: string; actor_name: string | null }[];
  maintenance: { id: string; event_date: string; kind: string; detail: string; cost: number; work_order_no: string | null }[];
}
export interface YearList {
  equipment: { id: string; code: string; name: string; purchase_year_be: number };
  currentFiscalYear: number;
  years: { fiscalYear: number; recordId: string | null; status: string | null; statusLabel: string; completeness: number; updatedAt: string | null }[];
}
export interface TaskRow {
  id: string; equipment: { id: string; code: string; name: string; department: string }; reasons: { code: string; label: string }[];
  dueDate: string; assignee: { id: string; name: string } | null; recordId: string | null; status: string; statusLabel: string;
  completeness: number; rejection: { reason: string; at: string; by: string | null } | null;
}
export interface Cycle {
  id: string; hospital_id: string; hospital_name: string; fiscal_year_be: number; opens_at: string; closes_at: string; status: string;
  period: { from: string; to: string }; planFiscalYear: number; summary: Record<string, number>;
}
