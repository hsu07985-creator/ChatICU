import apiClient, { ensureData } from '../api-client';

export interface CultureIsolate {
  code: string;
  organism: string;
  colonies?: string;
}

export interface SusceptibilityResult {
  antibiotic: string;
  code: string;
  result: 'S' | 'I' | 'R';
}

export interface CulturePanel {
  sheetNumber: string;
  specimen: string;
  specimenCode: string;
  collectedAt: string | null;
  reportedAt: string | null;
  department: string;
  isolates: CultureIsolate[];
  susceptibility: SusceptibilityResult[];
  qScore?: number | null;
  result?: string | null;
}

export interface CultureSusceptibilityData {
  patientId: string;
  cultureCount: number;
  cultures: CulturePanel[];
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export async function getCultureSusceptibility(patientId: string): Promise<CultureSusceptibilityData> {
  const response = await apiClient.get<ApiResponse<CultureSusceptibilityData>>(
    `/patients/${patientId}/cultures`
  );
  return ensureData(response.data, 'API contract');
}
