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

export interface FactorScores { utilization: number; clinical: number; financial: number; reliability: number; satisfaction: number; strategic: number }
export interface Breakdown {
  formulaVersion: string; ageYears: number; paybackDivisorYears: number; costPerCase: number | null; paybackYears: number | null;
  scores: FactorScores; weighted: FactorScores; utilityScore: number; recommendation: string; recommendationText: string; warning: boolean; explanation: string[];
}
export interface ScoreRow {
  equipment: { id: string; code: string; name: string; hospitalId: string; hospitalName: string; department: string; type: string; purchaseYear: number; purchasePrice: number; status: string };
  status: 'scored' | 'no_data' | 'incomplete'; dataYears: number[]; rank: number | null;
  utilityScore?: number; scores?: FactorScores; paybackYears?: number | null; costPerCase?: number | null;
  recommendation?: string; recommendationText?: string; warning?: boolean; utilizationPct?: number; problems?: string[];
}
export interface ScoreList {
  year: number; window: { from: number; to: number }; formula: { version: string };
  summary: { total: number; scored: number; notScored: number; average: number | null; high: number; good: number; medium: number; low: number; warning: number };
  rows: ScoreRow[];
}
export interface ScoreDetail {
  year: number; window: { from: number; to: number }; formula: { version: string };
  outcome: { status: 'scored'; breakdown: Breakdown; inputs: Record<string, number | boolean>; years: number[] } | { status: 'no_data' | 'incomplete'; problems: string[]; years: number[] };
  rank: number | null; rankOf: number;
  annual: { fiscalYear: number; status: string; confirmed: boolean; metrics: { maintenanceCost: number; utilizationPctHours: number | null; downtimePct: number | null } | null; revenue: number | null; caseCount: number | null; annualScore: number | null }[];
  history: { analysis_year: number; utility_score: number; recommendation: string; warning: boolean; rank: number | null; computed_at: string; formula_version: string }[];
}

export interface YearPoint { fiscalYear: number; utilizationPct: number | null; downtimePct: number | null; maintenanceCost: number | null; revenue: number | null }
export interface HospitalDashboard {
  year: number; window: { from: number; to: number }; formula: { version: string };
  kpis: { equipment: number; totalValue: number; scored: number; averageScore: number | null; high: number; replace: number; warning: number; maintenanceTotal: number };
  totals: (YearPoint & { records: number })[];
  equipment: { id: string; code: string; name: string; hospitalName: string; department: string; purchasePrice: number; rank: number | null; status: string;
    utilityScore: number | null; recommendation: string | null; recommendationText: string | null; warning: boolean; scores: FactorScores | null; series: YearPoint[] }[];
}
export interface NetworkDashboard {
  year: number; window: { from: number; to: number }; formula: { version: string };
  types: Option[]; completenessGroups: string[]; provinces: string[];
  kpis: { hospitals: number; hospitalsReporting: number; equipment: number; totalValue: number; confirmedPct: number; confirmedThisYear: number; averageScore: number | null; scored: number; replace: number };
  hospitals: {
    hospital: { id: string; hcode: string; name: string; province: string | null }; equipment: number; totalValue: number; confirmedThisYear: number;
    cycle: { status: string; closesAt: string } | null; progress: { approved: number; submitted: number; inProgress: number; notStarted: number; total: number };
    averageScore: number | null; scoredCount: number; distribution: { high: number; good: number; medium: number; low: number }; notScored: number;
    types: Record<string, number>; completeness: Record<string, number>; coverage: { fiscalYear: number; pct: number | null }[];
    followUps: { level: 'red' | 'warn'; text: string }[];
  }[];
}
