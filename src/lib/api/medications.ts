import apiClient, { ensureData } from '../api-client';

// 類型定義
export interface Medication {
  id: string;
  patientId: string;
  name: string;
  genericName: string;
  orderCode?: string | null;
  category: string;  // 'analgesic' | 'sedative' | 'antibiotic' | 'neuromuscular_blocker' | 'vasopressor' 等
  sanCategory: 'S' | 'A' | 'N' | null;  // S=Sedation, A=Analgesia, N=Neuromuscular Blocker
  route: string;
  routeNormalized?: string | null;
  dose: string;
  unit: string;
  concentration?: string;
  concentrationUnit?: string;
  frequency: string;
  startDate: string;
  endDate?: string | null;
  status: 'active' | 'discontinued' | 'completed' | 'on-hold';
  prescribedBy: {
    id: string;
    name: string;
  };
  prn: boolean;  // PRN (as needed)
  indication?: string;  // 使用適應症
  warnings: string[];  // 警告訊息
  notes?: string;
  isHighAlert?: boolean;
  isContinuous?: boolean;
  infusionRate?: string;
  // Outpatient source fields (048)
  sourceType?: 'inpatient' | 'outpatient' | 'self-supplied';
  sourceCampus?: string | null;
  prescribingHospital?: string | null;
  prescribingDepartment?: string | null;
  prescribingDoctorName?: string | null;
  daysSupply?: number | null;
  isExternal?: boolean;
  // Standardized codes (PR-1 / PR-2). atcCode is populated from the hospital
  // formulary; frontend can use it for ATC-class matching (e.g. PAD drug ID).
  atcCode?: string | null;
  isAntibiotic?: boolean;
  kidneyRelevant?: boolean | null;
  codingSource?: 'formulary' | 'formulary+abx' | 'abx_only' | 'legacy_only' | 'manual' | 'rxnorm_cache' | 'unmapped' | string | null;
}

export interface MedicationAdministration {
  id: string;
  medicationId: string;
  patientId: string;
  scheduledTime: string;
  administeredTime?: string;
  status: 'scheduled' | 'administered' | 'missed' | 'held' | 'refused';
  dose: string;
  route: string;
  administeredBy?: {
    id: string;
    name: string;
  };
  notes?: string;
}

export interface MedicationsResponse {
  medications: Medication[];
  grouped: {
    sedation: Medication[];
    analgesia: Medication[];
    nmb: Medication[];
    other: Medication[];
    outpatient: Medication[];
  };
  interactions: DrugInteraction[];
}

export interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  riskRating?: string | null; // X, D, C, B, A
}

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// 取得病人用藥列表
export async function getMedications(
  patientId: string,
  options: { page?: number; limit?: number; status?: string; category?: string } = {}
): Promise<MedicationsResponse> {
  const params = new URLSearchParams();
  if (options.page) params.append('page', String(options.page));
  if (options.limit) params.append('limit', String(options.limit));
  if (options.status) params.append('status', options.status);
  if (options.category) params.append('category', options.category);

  const response = await apiClient.get<ApiResponse<MedicationsResponse>>(
    `/patients/${patientId}/medications?${params}`
  );
  return ensureData(response.data, 'API contract');
}

// 取得單一用藥詳情
export async function getMedication(patientId: string, medicationId: string): Promise<Medication> {
  const response = await apiClient.get<ApiResponse<Medication>>(
    `/patients/${patientId}/medications/${medicationId}`
  );
  return ensureData(response.data, 'API contract');
}

// 更新用藥
export async function updateMedication(
  patientId: string,
  medicationId: string,
  data: Partial<Pick<Medication, 'dose' | 'unit' | 'concentration' | 'concentrationUnit' | 'frequency' | 'route' | 'indication'>>
): Promise<Medication> {
  const response = await apiClient.patch<ApiResponse<Medication>>(
    `/patients/${patientId}/medications/${medicationId}`,
    data
  );
  return ensureData(response.data, 'API contract');
}

// 取得給藥記錄
export async function getMedicationAdministrations(
  patientId: string,
  medicationId: string,
  options: { startDate?: string; endDate?: string } = {}
): Promise<MedicationAdministration[]> {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);

  const response = await apiClient.get<ApiResponse<MedicationAdministration[]>>(
    `/patients/${patientId}/medications/${medicationId}/administrations?${params}`
  );
  return ensureData(response.data, 'API contract');
}

// 記錄給藥
export async function recordAdministration(
  patientId: string,
  medicationId: string,
  administrationId: string,
  data: { status: string; notes?: string }
): Promise<MedicationAdministration> {
  const response = await apiClient.patch<ApiResponse<MedicationAdministration>>(
    `/patients/${patientId}/medications/${medicationId}/administrations/${administrationId}`,
    data
  );
  return ensureData(response.data, 'API contract');
}

// ── Duplicate medication detection (Wave 1) ─────────────────────────
// Backed by GET /patients/{patient_id}/medication-duplicates — see
// docs/duplicate-medication-integration-plan.md §7.
export interface DuplicateAlertMember {
  medicationId: string;
  genericName: string;
  atcCode: string | null;
  route: string | null;
  isPrn: boolean;
  lastAdminAt: string | null;
}

export interface DuplicateAlert {
  fingerprint: string;
  level: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  layer: 'L1' | 'L2' | 'L3' | 'L4';
  mechanism: string;
  members: DuplicateAlertMember[];
  recommendation: string;
  evidenceUrl: string | null;
  autoDowngraded: boolean;
  downgradeReason: string | null;
}

export async function getMedicationDuplicates(
  patientId: string,
  context: 'inpatient' | 'outpatient' | 'icu' | 'discharge' = 'inpatient'
): Promise<{ alerts: DuplicateAlert[]; counts: Record<string, number> }> {
  const params = new URLSearchParams({ context });
  const response = await apiClient.get<
    ApiResponse<{ alerts: DuplicateAlert[]; counts: Record<string, number> }>
  >(`/patients/${patientId}/medication-duplicates?${params}`);
  return ensureData(response.data, 'API contract');
}

// ── Batched duplicate summary (Wave 5b) ─────────────────────────────
// Backed by POST /pharmacy/duplicate-summary — see
// docs/duplicate-medication-integration-plan.md §4.4 / §7.
// Used by the pharmacy workstation patient list + dashboard tiles to
// show per-patient severity badges without N+1 calls.
export interface DuplicateSeverityCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
}

export interface DuplicateCountsByPatient {
  [patientId: string]: DuplicateSeverityCounts;
}

export interface DuplicateSummaryResponse {
  counts: DuplicateCountsByPatient;
  // patient ids whose cache missed — backend is warming them in background;
  // caller may refetch after a short delay to pick up populated counts.
  pending: string[];
}

// Backend actually wraps per-patient entries under { counts, cached } and
// returns them under a `results` key (see backend/app/routers/
// medication_duplicates.py::duplicate_summary). We normalize here so the
// callsite only has to reason about {patientId → {critical, high, ...}}.
interface _RawDuplicateSummaryPayload {
  results?: Record<string, { counts?: Partial<DuplicateSeverityCounts>; cached?: boolean }>;
  // Tolerate the simpler shape described in the integration plan in case
  // the backend is upgraded later to flatten the response.
  counts?: Record<string, Partial<DuplicateSeverityCounts>>;
  pending?: string[];
  total?: number;
}

const _EMPTY_COUNTS: DuplicateSeverityCounts = {
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  info: 0,
};

function _normalizeCounts(partial?: Partial<DuplicateSeverityCounts>): DuplicateSeverityCounts {
  return {
    critical: partial?.critical ?? 0,
    high: partial?.high ?? 0,
    moderate: partial?.moderate ?? 0,
    low: partial?.low ?? 0,
    info: partial?.info ?? 0,
  };
}

export async function fetchPharmacyDuplicateSummary(
  patientIds: string[],
  context: 'inpatient' | 'outpatient' | 'icu' | 'discharge' = 'inpatient',
): Promise<DuplicateSummaryResponse> {
  if (patientIds.length === 0) {
    return { counts: {}, pending: [] };
  }
  const response = await apiClient.post<ApiResponse<_RawDuplicateSummaryPayload>>(
    `/pharmacy/duplicate-summary?context=${context}`,
    { patientIds }
  );
  const raw = ensureData(response.data, 'API contract');
  const counts: DuplicateCountsByPatient = {};

  if (raw.results) {
    for (const [pid, entry] of Object.entries(raw.results)) {
      counts[pid] = _normalizeCounts(entry?.counts);
    }
  } else if (raw.counts) {
    for (const [pid, partial] of Object.entries(raw.counts)) {
      counts[pid] = _normalizeCounts(partial);
    }
  }

  // Ensure every requested pid has an entry so callers can do
  // `summary.counts[id]` safely without null checks.
  for (const pid of patientIds) {
    if (!counts[pid]) counts[pid] = { ..._EMPTY_COUNTS };
  }

  return {
    counts,
    pending: raw.pending ?? [],
  };
}

