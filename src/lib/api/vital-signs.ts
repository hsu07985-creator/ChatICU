import apiClient, { ensureData, ensureSuccess } from '../api-client';

// 類型定義
export interface VitalSigns {
  id: string;
  patientId: string;
  timestamp: string;
  heartRate?: number | null;
  bloodPressure?: {
    systolic?: number | null;
    diastolic?: number | null;
    mean?: number | null;
  };
  respiratoryRate?: number | null;
  spo2?: number | null;
  temperature?: number | null;
  etco2?: number | null;
  cvp?: number | null;
  icp?: number | null;
  cpp?: number | null;
  bodyWeight?: number | null;
}

export interface VitalSignsTrendsResponse {
  trends: VitalSigns[];
  hours: number;
}

export interface VitalSignsHistoryResponse {
  history: VitalSigns[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// 取得最新生命徵象
export async function getLatestVitalSigns(patientId: string): Promise<VitalSigns | null> {
  const response = await apiClient.get<ApiResponse<VitalSigns>>(
    `/patients/${patientId}/vital-signs/latest`
  );
  const normalized = ensureSuccess(response.data, 'API contract');
  return normalized.data ?? null;
}

// 取得生命徵象趨勢
export async function getVitalSignsTrends(
  patientId: string,
  options: { items?: string[]; hours?: number } = {}
): Promise<VitalSignsTrendsResponse> {
  const params = new URLSearchParams();
  if (options.items?.length) params.append('items', options.items.join(','));
  if (options.hours) params.append('hours', String(options.hours));

  const response = await apiClient.get<ApiResponse<VitalSignsTrendsResponse>>(
    `/patients/${patientId}/vital-signs/trends?${params}`
  );
  return ensureData(response.data, 'API contract');
}

// 取得生命徵象歷史
export async function getVitalSignsHistory(
  patientId: string,
  options: { page?: number; limit?: number; startDate?: string; endDate?: string } = {}
): Promise<VitalSignsHistoryResponse> {
  const params = new URLSearchParams();
  if (options.page) params.append('page', String(options.page));
  if (options.limit) params.append('limit', String(options.limit));
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);

  const response = await apiClient.get<ApiResponse<VitalSignsHistoryResponse>>(
    `/patients/${patientId}/vital-signs/history?${params}`
  );
  return ensureData(response.data, 'API contract');
}
