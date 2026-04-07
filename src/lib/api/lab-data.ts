import apiClient, { ensureData } from '../api-client';

// 單一檢驗項目的結構
export interface LabItem {
  value: number;
  unit: string;
  referenceRange: string;
  isAbnormal: boolean;
}

// 類型定義
export interface LabData {
  id: string;
  patientId: string;
  timestamp: string;
  biochemistry?: Record<string, LabItem>;
  hematology?: Record<string, LabItem>;
  bloodGas?: Record<string, LabItem>;
  venousBloodGas?: Record<string, LabItem>;
  inflammatory?: Record<string, LabItem>;
  coagulation?: Record<string, LabItem>;
  cardiac?: Record<string, LabItem>;
  lipid?: Record<string, LabItem>;
  other?: Record<string, LabItem>;
  thyroid?: Record<string, LabItem>;
  hormone?: Record<string, LabItem>;
}

// 輔助函數：從 LabItem 取得數值
export function getLabValue(item: LabItem | undefined): number | undefined {
  return item?.value;
}

// 輔助函數：檢查是否異常
export function isLabAbnormal(item: LabItem | undefined): boolean {
  return item?.isAbnormal ?? false;
}

export interface LabTrendPoint {
  timestamp: string;
  value: number;
}

export interface LabTrendsResponse {
  trends: LabData[];
  days: number;
}

export interface LabCorrectionData {
  category: string;
  item: string;
  correctedValue: number | string;
  reason: string;
}

export interface LabCorrectionResponse {
  id: string;
  labDataId: string;
  patientId: string;
  category: string;
  item: string;
  correctedValue: number | string;
  reason: string;
  correctedBy: {
    id: string;
    name: string;
    role: string;
  };
  correctedAt: string;
}

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// 取得最新檢驗數據
export async function getLatestLabData(patientId: string): Promise<LabData> {
  const response = await apiClient.get<ApiResponse<LabData>>(
    `/patients/${patientId}/lab-data/latest`
  );
  return ensureData(response.data, 'API contract');
}

// 取得檢驗趨勢
export async function getLabTrends(
  patientId: string,
  options: { items?: string[]; days?: number } = {}
): Promise<LabTrendsResponse> {
  const params = new URLSearchParams();
  if (options.items?.length) params.append('items', options.items.join(','));
  if (options.days) params.append('days', String(options.days));

  const response = await apiClient.get<ApiResponse<LabTrendsResponse>>(
    `/patients/${patientId}/lab-data/trends?${params}`
  );
  return ensureData(response.data, 'API contract');
}

// 校正檢驗數據
export async function correctLabData(
  patientId: string,
  labDataId: string,
  correction: LabCorrectionData
): Promise<LabCorrectionResponse> {
  const response = await apiClient.patch<ApiResponse<LabCorrectionResponse>>(
    `/patients/${patientId}/lab-data/${labDataId}/correct`,
    correction
  );
  return ensureData(response.data, 'API contract');
}

