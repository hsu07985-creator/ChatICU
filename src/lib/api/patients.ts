import apiClient, { ensureData } from '../api-client';

// 類型定義
export interface Patient {
  id: string;
  name: string;
  bedNumber: string;
  medicalRecordNumber: string;
  age: number;
  gender: string;
  diagnosis: string;
  intubated: boolean;
  intubationDate?: string | null;
  admissionDate: string;
  icuAdmissionDate: string;
  ventilatorDays: number;
  attendingPhysician: string;
  department: string;
  lastUpdate: string;
  alerts: string[];
  consentStatus: string;
  hasDNR: boolean;
  isIsolated: boolean;
  height?: number | null;
  weight?: number | null;
  bmi?: number | null;
  symptoms?: string[];
  allergies?: string[];
  bloodType?: string | null;
  codeStatus?: string | null;
  criticalStatus?: string;
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  sanSummary?: {
    sedation: string[];
    analgesia: string[];
    nmb: string[];
  };
  archived?: boolean;
  archivedAt?: string | null;
  dischargeType?: 'discharge' | 'transfer' | 'death' | 'other' | null;
  dischargeDate?: string | null;
  dischargeReason?: string | null;
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
  archived?: boolean | 'all';
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
  if (filters.archived !== undefined) params.append('archived', String(filters.archived));

  const response = await apiClient.get<ApiResponse<PatientsResponse>>(`/patients?${params}`);
  return ensureData(response.data, 'API contract');
}

// 取得所有病人（無分頁）
export async function getAllPatients(filters: PatientFilters = {}): Promise<Patient[]> {
  const resp = await getPatients({ ...filters, limit: 200 });
  return resp.patients;
}

// 取得單一病人詳情
export async function getPatient(id: string): Promise<Patient> {
  const response = await apiClient.get<ApiResponse<Patient>>(`/patients/${id}`);
  return ensureData(response.data, 'API contract');
}

// 更新病人資料
export async function updatePatient(id: string, data: Partial<Patient>): Promise<Patient> {
  const body: Record<string, unknown> = {};

  // Map frontend camelCase fields to backend snake_case update schema.
  if (data.name !== undefined) body.name = data.name;
  if (data.bedNumber !== undefined) body.bed_number = data.bedNumber;
  if (data.medicalRecordNumber !== undefined) body.medical_record_number = data.medicalRecordNumber;
  if (data.age !== undefined) body.age = data.age;
  if (data.gender !== undefined) body.gender = data.gender;
  if (data.height !== undefined) body.height = data.height;
  if (data.weight !== undefined) body.weight = data.weight;
  if (data.bmi !== undefined) body.bmi = data.bmi;
  if (data.diagnosis !== undefined) body.diagnosis = data.diagnosis;
  if (data.intubated !== undefined) body.intubated = data.intubated;
  if (data.intubationDate !== undefined) body.intubation_date = data.intubationDate;
  if (data.criticalStatus !== undefined) body.critical_status = data.criticalStatus;
  if (data.admissionDate !== undefined) body.admission_date = data.admissionDate;
  if (data.icuAdmissionDate !== undefined) body.icu_admission_date = data.icuAdmissionDate;
  if (data.ventilatorDays !== undefined) body.ventilator_days = data.ventilatorDays;
  if (data.attendingPhysician !== undefined) body.attending_physician = data.attendingPhysician;
  if (data.department !== undefined) body.department = data.department;
  if (data.alerts !== undefined) body.alerts = data.alerts;
  if (data.codeStatus !== undefined) body.code_status = data.codeStatus;
  if (data.hasDNR !== undefined) body.has_dnr = data.hasDNR;
  if (data.isIsolated !== undefined) body.is_isolated = data.isIsolated;
  if (data.sedation !== undefined) body.sedation = data.sedation;
  if (data.analgesia !== undefined) body.analgesia = data.analgesia;
  if (data.nmb !== undefined) body.nmb = data.nmb;
  if (data.symptoms !== undefined) body.symptoms = data.symptoms;
  if (data.allergies !== undefined) body.allergies = data.allergies;
  if (data.bloodType !== undefined) body.blood_type = data.bloodType;
  if (data.consentStatus !== undefined) body.consent_status = data.consentStatus;

  const response = await apiClient.patch<ApiResponse<Patient>>(`/patients/${id}`, body);
  return ensureData(response.data, 'API contract');
}

// 新增病人
export interface CreatePatientData {
  name: string;
  bedNumber: string;
  medicalRecordNumber: string;
  diagnosis: string;
  age?: number;
  gender?: string;
  height?: number;
  weight?: number;
  symptoms?: string[];
  intubated?: boolean;
  intubationDate?: string;
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  admissionDate?: string;
  icuAdmissionDate?: string;
  ventilatorDays?: number;
  attendingPhysician?: string;
  department?: string;
  unit?: string;
  alerts?: string[];
  consentStatus?: string;
  allergies?: string[];
  bloodType?: string;
  codeStatus?: string;
  hasDNR?: boolean;
  isIsolated?: boolean;
  criticalStatus?: string;
}

export async function createPatient(data: CreatePatientData): Promise<Patient> {
  const body: Record<string, unknown> = {
    name: data.name,
    bed_number: data.bedNumber,
    medical_record_number: data.medicalRecordNumber,
    diagnosis: data.diagnosis,
    age: data.age ?? 0,
    gender: data.gender ?? '男',
    height: data.height ?? undefined,
    weight: data.weight ?? undefined,
    symptoms: data.symptoms ?? undefined,
    intubated: data.intubated ?? false,
    intubation_date: data.intubationDate ?? undefined,
    critical_status: data.criticalStatus ?? undefined,
    sedation: data.sedation ?? undefined,
    analgesia: data.analgesia ?? undefined,
    nmb: data.nmb ?? undefined,
    admission_date: data.admissionDate ?? undefined,
    icu_admission_date: data.icuAdmissionDate ?? undefined,
    ventilator_days: data.ventilatorDays ?? 0,
    attending_physician: data.attendingPhysician ?? undefined,
    department: data.department ?? undefined,
    unit: data.unit ?? undefined,
    alerts: data.alerts ?? undefined,
    consent_status: data.consentStatus ?? undefined,
    allergies: data.allergies ?? undefined,
    blood_type: data.bloodType ?? undefined,
    code_status: data.codeStatus ?? undefined,
    has_dnr: data.hasDNR ?? false,
    is_isolated: data.isIsolated ?? false,
  };

  const response = await apiClient.post<ApiResponse<Patient>>('/patients', body);
  return ensureData(response.data, 'API contract');
}

// 封存病人
export interface ArchivePatientData {
  archived: boolean;
  reason?: string;
  dischargeType?: 'discharge' | 'transfer' | 'death' | 'other';
  dischargeDate?: string;
}

export async function archivePatient(id: string, data: ArchivePatientData): Promise<Patient> {
  const body: Record<string, unknown> = {
    archived: data.archived,
    reason: data.reason,
    discharge_type: data.dischargeType,
    discharge_date: data.dischargeDate,
  };
  const response = await apiClient.patch<ApiResponse<Patient>>(`/patients/${id}/archive`, body);
  return ensureData(response.data, 'API contract');
}

// 出院刪除（永久刪除病人及所有關聯資料）
export async function dischargePatient(id: string): Promise<{ id: string }> {
  const response = await apiClient.delete<ApiResponse<{ id: string }>>(`/patients/${id}`);
  return ensureData(response.data, 'API contract');
}

// 導出所有 API 函數
export const patientsApi = {
  getPatients,
  getPatient,
  updatePatient,
  createPatient,
  archivePatient,
  dischargePatient,
};
