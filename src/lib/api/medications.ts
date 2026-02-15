import apiClient from '../api-client';

// 類型定義
export interface Medication {
  id: string;
  patientId: string;
  name: string;
  genericName: string;
  category: string;  // 'analgesic' | 'sedative' | 'antibiotic' | 'neuromuscular_blocker' | 'vasopressor' 等
  sanCategory: 'S' | 'A' | 'N' | null;  // S=Sedation, A=Analgesia, N=Neuromuscular Blocker
  route: string;
  dose: string;
  unit: string;
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
  patientId: string;
  patientName: string;
  medications: Medication[];
  grouped: {
    sedation: Medication[];
    analgesia: Medication[];
    nmb: Medication[];
    other: Medication[];
  };
  interactions: DrugInteraction[];
  total: number;
}

export interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: 'high' | 'moderate' | 'low';
  description: string;
  recommendation: string;
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
  return response.data.data!;
}

// 取得單一用藥詳情
export async function getMedication(patientId: string, medicationId: string): Promise<Medication> {
  const response = await apiClient.get<ApiResponse<Medication>>(
    `/patients/${patientId}/medications/${medicationId}`
  );
  return response.data.data!;
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
  return response.data.data!;
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
  return response.data.data!;
}

