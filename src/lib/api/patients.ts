import apiClient from '../api-client';

// 類型定義
export interface Patient {
  id: string;
  name: string;
  bedNumber: string;
  medicalRecordNumber: string;
  age: number;
  gender: '男' | '女';
  diagnosis: string;
  intubated: boolean;
  admissionDate: string;
  icuAdmissionDate: string;
  ventilatorDays: number;
  attendingPhysician: string;
  department: string;
  lastUpdate: string;
  alerts: string[];
  consentStatus: 'valid' | 'expired' | 'none';
  hasDNR: boolean;
  isIsolated: boolean;
  criticalStatus?: string;
  sanSummary?: {
    sedation: string[];
    analgesia: string[];
    nmb: string[];
  };
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PatientsResponse {
  patients: Patient[];
  pagination: PaginationInfo;
}

export interface PatientFilters {
  page?: number;
  limit?: number;
  search?: string;
  intubated?: boolean;
  criticalStatus?: string;
  department?: string;
}

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

// 取得病人列表
export async function getPatients(filters: PatientFilters = {}): Promise<PatientsResponse> {
  const params = new URLSearchParams();
  
  if (filters.page) params.append('page', String(filters.page));
  if (filters.limit) params.append('limit', String(filters.limit));
  if (filters.search) params.append('search', filters.search);
  if (filters.intubated !== undefined) params.append('intubated', String(filters.intubated));
  if (filters.criticalStatus) params.append('criticalStatus', filters.criticalStatus);
  if (filters.department) params.append('department', filters.department);

  const response = await apiClient.get<ApiResponse<PatientsResponse>>(`/patients?${params}`);
  return response.data.data!;
}

// 取得單一病人詳情
export async function getPatient(id: string): Promise<Patient> {
  const response = await apiClient.get<ApiResponse<Patient>>(`/patients/${id}`);
  return response.data.data!;
}

// 更新病人資料
export async function updatePatient(id: string, data: Partial<Patient>): Promise<Patient> {
  const response = await apiClient.patch<ApiResponse<Patient>>(`/patients/${id}`, data);
  return response.data.data!;
}

// 新增病人
export interface CreatePatientData {
  name: string;
  bedNumber: string;
  medicalRecordNumber: string;
  diagnosis: string;
  age?: number;
  gender?: '男' | '女';
  intubated?: boolean;
  admissionDate?: string;
  icuAdmissionDate?: string;
  attendingPhysician?: string;
  department?: string;
  isIsolated?: boolean;
  criticalStatus?: string;
}

export async function createPatient(data: CreatePatientData): Promise<Patient> {
  const response = await apiClient.post<ApiResponse<Patient>>('/patients', data);
  return response.data.data!;
}

// 封存病人
export interface ArchivePatientData {
  archived: boolean;
  reason?: string;
  dischargeType?: 'discharge' | 'transfer' | 'death' | 'other';
}

export async function archivePatient(id: string, data: ArchivePatientData): Promise<Patient> {
  const response = await apiClient.patch<ApiResponse<Patient>>(`/patients/${id}/archive`, data);
  return response.data.data!;
}

// 導出所有 API 函數
export const patientsApi = {
  getPatients,
  getPatient,
  updatePatient,
  createPatient,
  archivePatient,
};

