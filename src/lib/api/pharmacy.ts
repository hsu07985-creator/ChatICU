import apiClient from '../api-client';

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
  return response.data.data!;
}

export async function getErrorReportById(reportId: string): Promise<ErrorReport> {
  const response = await apiClient.get<ApiResponse<ErrorReport>>(
    `/pharmacy/error-reports/${reportId}`
  );
  return response.data.data!;
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
  return response.data.data!;
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
  return response.data.data!;
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

export async function getAdviceStatistics(): Promise<AdviceStatistics> {
  const response = await apiClient.get<ApiResponse<AdviceStatistics>>(
    '/pharmacy/advice-statistics'
  );
  return response.data.data!;
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
  return response.data.data!;
}

// 導出所有 API 函數
export const pharmacyApi = {
  getErrorReports,
  getErrorReportById,
  createErrorReport,
  updateErrorReport,
  getAdviceStatistics,
  getAdviceRecords,
};

