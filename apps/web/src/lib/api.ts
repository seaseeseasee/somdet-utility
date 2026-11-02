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
