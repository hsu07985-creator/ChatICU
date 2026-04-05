import apiClient, { ensureData } from '../api-client';

export interface SymptomRecord {
  id: string;
  patientId: string;
  recordedAt: string;
  symptoms: string[];
  recordedBy: { id: string; name: string } | null;
  notes: string | null;
  createdAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

export async function getSymptomRecords(patientId: string): Promise<SymptomRecord[]> {
  const response = await apiClient.get<ApiResponse<SymptomRecord[]>>(
    `/patients/${patientId}/symptom-records`,
  );
  return ensureData(response.data, 'API contract');
}

export async function createSymptomRecord(
  patientId: string,
  symptoms: string[],
  notes?: string,
): Promise<SymptomRecord> {
  const response = await apiClient.post<ApiResponse<SymptomRecord>>(
    `/patients/${patientId}/symptom-records`,
    { symptoms, notes },
  );
  return ensureData(response.data, 'API contract');
}
