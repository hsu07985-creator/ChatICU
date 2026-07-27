import apiClient, { ensureData, type ApiResponse } from '../api-client';

export interface DiagnosticReport {
  id: string;
  patientId: string;
  reportType: 'imaging' | 'procedure' | 'ecg_ai' | 'other';
  examName: string;
  examDate: string;
  bodyText: string;
  impression?: string | null;
  reporterName?: string | null;
  status: 'preliminary' | 'final';
}

export async function getDiagnosticReports(
  patientId: string,
  type?: string,
): Promise<DiagnosticReport[]> {
  const params = new URLSearchParams();
  if (type) params.append('type', type);
  const qs = params.toString() ? `?${params}` : '';
  const response = await apiClient.get<ApiResponse<DiagnosticReport[]>>(
    `/patients/${patientId}/diagnostic-reports${qs}`,
  );
  return ensureData(response.data, 'API contract');
}
