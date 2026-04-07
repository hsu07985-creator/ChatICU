import apiClient, { ensureData } from '../api-client';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// ========== 用藥錯誤回報 ==========

export interface ErrorReport {
  id: string;
  errorType: string;
  medicationName: string;
  description: string;
  patientId?: string | null;
  status: 'pending' | 'resolved';
  reporterId?: string | null;
  reporterName?: string | null;
  reporterRole?: string | null;
  actionTaken?: string | null;
  reviewedBy?: string | null;
  resolution?: string | null;
  timestamp: string;
  severity: 'low' | 'moderate' | 'high';
}

export interface ErrorReportsResponse {
  reports: ErrorReport[];
  total: number;
  stats?: {
    total: number;
    pending: number;
    resolved: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}

export interface ErrorReportsParams {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
}

export async function getErrorReports(params?: ErrorReportsParams): Promise<ErrorReportsResponse> {
  const response = await apiClient.get<ApiResponse<ErrorReportsResponse>>(
    '/pharmacy/error-reports',
    { params }
  );
  return ensureData(response.data, 'API contract');
}

export async function getErrorReportById(reportId: string): Promise<ErrorReport> {
  const response = await apiClient.get<ApiResponse<ErrorReport>>(
    `/pharmacy/error-reports/${reportId}`
  );
  return ensureData(response.data, 'API contract');
}

export interface CreateErrorReportData {
  errorType: string;
  medicationName: string;
  description: string;
  patientId?: string;
  actionTaken?: string;
  severity?: string;
}

export async function createErrorReport(
  data: CreateErrorReportData
): Promise<ErrorReport> {
  const response = await apiClient.post<ApiResponse<ErrorReport>>(
    '/pharmacy/error-reports',
    data
  );
  return ensureData(response.data, 'API contract');
}

export interface UpdateErrorReportData {
  status?: string;
  resolution?: string;
}

export async function updateErrorReport(
  reportId: string,
  data: UpdateErrorReportData
): Promise<ErrorReport> {
  const response = await apiClient.patch<ApiResponse<ErrorReport>>(
    `/pharmacy/error-reports/${reportId}`,
    data
  );
  return ensureData(response.data, 'API contract');
}

// ========== 相容性常用組合（持久化） ==========

export interface CompatibilityFavoritePair {
  id: string;
  drugA: string;
  drugB: string;
  solution: string;
  createdAt: string;
}

export interface CompatibilityFavoritesResponse {
  favorites: CompatibilityFavoritePair[];
  total: number;
}

export async function getCompatibilityFavorites(): Promise<CompatibilityFavoritesResponse> {
  const response = await apiClient.get<ApiResponse<CompatibilityFavoritesResponse>>(
    '/pharmacy/compatibility-favorites'
  );
  return ensureData(response.data, 'API contract');
}

export async function createCompatibilityFavorite(data: {
  drugA: string;
  drugB: string;
  solution?: string;
}): Promise<CompatibilityFavoritePair> {
  const response = await apiClient.post<ApiResponse<CompatibilityFavoritePair>>(
    '/pharmacy/compatibility-favorites',
    { drugA: data.drugA, drugB: data.drugB, solution: data.solution || 'none' }
  );
  return ensureData(response.data, 'API contract');
}

export async function deleteCompatibilityFavorite(favoriteId: string): Promise<void> {
  await apiClient.delete(`/pharmacy/compatibility-favorites/${favoriteId}`);
}

// ========== 交互作用與相容性查詢 ==========

export interface DrugInteractionSearchItem {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  mechanism: string;
  clinicalEffect: string;
  management: string;
  references: string;
  riskRating?: string;
  riskRatingDescription?: string;
  severityLabel?: string;
  reliabilityRating?: string;
  routeDependency?: string;
  discussion?: string;
  footnotes?: string;
  dependencies?: string[];
  dependencyTypes?: string[];
  interactingMembers?: Array<{
    group_name: string;
    members: string[];
    exceptions: string[];
    exceptions_note: string;
  }>;
  pubmedIds?: string[];
}

export interface DrugInteractionSearchResponse {
  interactions: DrugInteractionSearchItem[];
  total: number;
}

export async function getDrugInteractions(params: {
  drugA: string;
  drugB?: string;
}): Promise<DrugInteractionSearchResponse> {
  const response = await apiClient.get<ApiResponse<DrugInteractionSearchResponse>>(
    '/pharmacy/drug-interactions',
    { params }
  );
  return ensureData(response.data, 'API contract');
}

export interface IVCompatibilitySearchItem {
  id: string;
  drug1: string;
  drug2: string;
  solution: string;
  compatible: boolean;
  timeStability?: string;
  notes?: string;
  references?: string;
}

export interface IVCompatibilitySearchResponse {
  compatibilities: IVCompatibilitySearchItem[];
  total: number;
}

export async function getIVCompatibility(params: {
  drugA: string;
  drugB: string;
  solution?: string;
}, options?: { suppressErrorToast?: boolean }): Promise<IVCompatibilitySearchResponse> {
  const response = await apiClient.get<ApiResponse<IVCompatibilitySearchResponse>>(
    '/pharmacy/iv-compatibility',
    { params, suppressErrorToast: options?.suppressErrorToast },
  );
  return ensureData(response.data, 'API contract');
}

// ========== 用藥建議統計 ==========

export interface AdviceStatistics {
  totalReports: number;
  resolvedRate: number;
  severityCounts: {
    low: number;
    moderate: number;
    high: number;
  };
}

/** @deprecated Misleading name — this endpoint queries ErrorReport (用藥錯誤通報), not PharmacyAdvice. */
export async function getAdviceStatistics(): Promise<AdviceStatistics> {
  const response = await apiClient.get<ApiResponse<AdviceStatistics>>(
    '/pharmacy/advice-statistics'
  );
  return ensureData(response.data, 'API contract');
}

// ========== 用藥建議記錄 ==========

export interface PharmacyAdviceRecord {
  id: string;
  patientId: string;
  patientName: string;
  bedNumber: string;
  adviceCode: string;
  adviceLabel: string;
  category: string;
  content: string;
  pharmacistName: string;
  timestamp: string;
  linkedMedications?: string[];
  accepted?: boolean | null;
}

export interface AdviceRecordsResponse {
  records: PharmacyAdviceRecord[];
  total: number;
}

export interface AdviceRecordsParams {
  month?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export async function getAdviceRecords(params?: AdviceRecordsParams): Promise<AdviceRecordsResponse> {
  const response = await apiClient.get<ApiResponse<AdviceRecordsResponse>>(
    '/pharmacy/advice-records',
    { params }
  );
  return ensureData(response.data, 'API contract');
}

export interface CreateAdviceRecordData {
  patientId: string;
  adviceCode: string;
  adviceLabel: string;
  category: string;
  content: string;
  linkedMedications?: string[];
  accepted?: boolean;
}

export async function createAdviceRecord(data: CreateAdviceRecordData): Promise<PharmacyAdviceRecord> {
  const response = await apiClient.post<ApiResponse<PharmacyAdviceRecord>>(
    '/pharmacy/advice-records',
    data
  );
  return ensureData(response.data, 'API contract');
}

// ========== 用藥建議記錄統計（聚合） ==========

export interface AdviceRecordStats {
  total: number;
  byCategory: Array<{ category: string; count: number }>;
  byCode: Array<{ code: string; label: string; category: string; count: number }>;
  byPharmacist: Array<{ pharmacistName: string; count: number }>;
  byAcceptance?: { accepted: number; rejected: number; pending: number };
}

export async function getAdviceRecordStats(params?: { month?: string }): Promise<AdviceRecordStats> {
  const response = await apiClient.get<ApiResponse<AdviceRecordStats>>(
    '/pharmacy/advice-records/stats',
    { params }
  );
  return ensureData(response.data, 'API contract');
}

// ========== PAD 劑量計算 ==========

export interface PadDrugInfo {
  key: string;
  label: string;
  concentration: number;
  concentration_unit: string;
  dose_unit: string;
  dose_range: string;
  weight_basis: string;
  concentration_range?: [number, number];
}

export interface PadDrugsResponse {
  drugs: PadDrugInfo[];
}

export async function getPadDrugs(): Promise<PadDrugsResponse> {
  const response = await apiClient.get<ApiResponse<PadDrugsResponse>>(
    '/pharmacy/pad-drugs'
  );
  return ensureData(response.data, 'API contract');
}

export interface PadCalculateRequest {
  drug: string;
  weight_kg: number;
  target_dose_per_kg_hr: number;
  concentration: number;
  sex?: string;
  height_cm?: number;
}

export interface PadCalculateResult {
  drug: string;
  BMI?: number;
  IBW_kg?: number;
  AdjBW_kg?: number;
  pct_IBW?: number;
  is_obese?: boolean;
  weight_basis: string;
  dosing_weight_kg: number;
  dose_per_hr: number;
  rate_ml_hr: number;
  concentration: string;
  note?: string;
  steps: string[];
}

export async function padCalculate(data: PadCalculateRequest, options?: { suppressErrorToast?: boolean }): Promise<PadCalculateResult> {
  const response = await apiClient.post<ApiResponse<PadCalculateResult>>(
    '/pharmacy/pad-calculate',
    data,
    { suppressErrorToast: options?.suppressErrorToast },
  );
  return ensureData(response.data, 'API contract');
}

// 導出所有 API 函數
export const pharmacyApi = {
  getErrorReports,
  getErrorReportById,
  createErrorReport,
  updateErrorReport,
  getCompatibilityFavorites,
  createCompatibilityFavorite,
  deleteCompatibilityFavorite,
  getDrugInteractions,
  getIVCompatibility,
  getAdviceStatistics,
  getAdviceRecords,
  createAdviceRecord,
  getAdviceRecordStats,
  respondToAdvice,
};

// ========== 藥事建議回覆 ==========

export async function respondToAdvice(
  adviceRecordId: string,
  data: { accepted: boolean }
): Promise<PharmacyAdviceRecord> {
  const response = await apiClient.patch<ApiResponse<PharmacyAdviceRecord>>(
    `/pharmacy/advice-records/${adviceRecordId}/response`,
    data
  );
  return ensureData(response.data, 'API contract');
}
