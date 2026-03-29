import apiClient, { ensureData } from '../api-client';
import { patientReadApiBase } from './layer2-mode';

export interface CultureIsolate {
  code: string;
  organism: string;
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
    `${patientReadApiBase()}/${patientId}/cultures`
  );
  return ensureData(response.data, 'API contract');
}
