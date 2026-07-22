import apiClient, { ensureData, type ApiResponse } from '../api-client';

// 類型定義
export interface VentilatorSettings {
  id: string;
  patientId: string;
  timestamp: string;
  mode: string;
  fio2: number;
  peep: number;
  tidalVolume: number;
  respiratoryRate: number;
  inspiratoryPressure?: number;
  pressureSupport?: number;
  ieRatio: string;
  pip?: number;
  plateau?: number;
  compliance?: number;
  resistance?: number;
}

export interface VentilatorTrendsResponse {
  trends: VentilatorSettings[];
  hours: number;
}

export interface WeaningAssessment {
  id: string;
  patientId: string;
  timestamp: string | null;
  rsbi: number | null;
  nif: number | null;
  vt: number | null;
  rr: number | null;
  spo2: number | null;
  fio2: number | null;
  peep: number | null;
  gcs: number | null;
  coughStrength: string | null;
  secretions: string | null;
  hemodynamicStability: boolean | null;
  recommendation: string | null;
  readinessScore: number | null;
  assessedBy: {
    id: string;
    name: string;
    role: string;
  } | null;
}

export type WeaningAssessmentInput = Partial<Pick<
  WeaningAssessment,
  'rsbi' | 'nif' | 'vt' | 'rr' | 'spo2' | 'fio2' | 'peep' | 'gcs' |
  'coughStrength' | 'secretions' | 'hemodynamicStability' | 'recommendation' | 'readinessScore'
>>;

// 取得最新呼吸器設定
export async function getLatestVentilatorSettings(patientId: string): Promise<VentilatorSettings> {
  const response = await apiClient.get<ApiResponse<VentilatorSettings>>(
    `/patients/${patientId}/ventilator/latest`
  );
  return ensureData(response.data, 'API contract');
}

// 取得呼吸器趨勢
export async function getVentilatorTrends(
  patientId: string,
  options: { items?: string[]; hours?: number } = {}
): Promise<VentilatorTrendsResponse> {
  const params = new URLSearchParams();
  if (options.items?.length) params.append('items', options.items.join(','));
  if (options.hours) params.append('hours', String(options.hours));

  const response = await apiClient.get<ApiResponse<VentilatorTrendsResponse>>(
    `/patients/${patientId}/ventilator/trends?${params}`
  );
  return ensureData(response.data, 'API contract');
}

// 取得脫機評估
export async function getWeaningAssessment(patientId: string): Promise<WeaningAssessment> {
  const response = await apiClient.get<ApiResponse<WeaningAssessment>>(
    `/patients/${patientId}/ventilator/weaning-assessment`
  );
  return ensureData(response.data, 'API contract');
}

// 建立脫機評估
export async function createWeaningAssessment(
  patientId: string,
  data: WeaningAssessmentInput
): Promise<WeaningAssessment> {
  const response = await apiClient.post<ApiResponse<WeaningAssessment>>(
    `/patients/${patientId}/ventilator/weaning-assessment`,
    data
  );
  return ensureData(response.data, 'API contract');
}

// 手動輸入呼吸器設定（admin 專用）
export interface VentilatorInput {
  mode?: string | null;
  fio2?: number | null;
  peep?: number | null;
  tidal_volume?: number | null;
  respiratory_rate?: number | null;
  inspiratory_pressure?: number | null;
  pressure_support?: number | null;
  ie_ratio?: string | null;
  pip?: number | null;
  plateau?: number | null;
  compliance?: number | null;
  resistance?: number | null;
}

export async function createVentilatorSettings(
  patientId: string,
  data: VentilatorInput
): Promise<VentilatorSettings> {
  const response = await apiClient.post<ApiResponse<VentilatorSettings>>(
    `/patients/${patientId}/ventilator/settings`,
    data
  );
  return ensureData(response.data, 'API contract');
}
