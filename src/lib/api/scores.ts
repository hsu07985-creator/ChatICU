import apiClient, { ensureData, ensureSuccess } from '../api-client';

export interface ScoreEntry {
  id: string;
  patientId: string;
  scoreType: 'pain' | 'rass';
  value: number;
  timestamp: string;
  recordedBy: string;
  notes?: string;
}

export interface LatestScores {
  pain: ScoreEntry | null;
  rass: ScoreEntry | null;
}

export interface ScoreTrendsResponse {
  trends: ScoreEntry[];
  scoreType: string;
  hours: number;
}

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export async function getLatestScores(patientId: string): Promise<LatestScores> {
  const response = await apiClient.get<ApiResponse<LatestScores>>(
    `/patients/${patientId}/scores/latest`,
    { suppressErrorToast: true },
  );
  const normalized = ensureSuccess(response.data, 'API contract');
  return normalized.data ?? { pain: null, rass: null };
}

export async function recordScore(
  patientId: string,
  data: { score_type: 'pain' | 'rass'; value: number; notes?: string },
): Promise<ScoreEntry> {
  const response = await apiClient.post<ApiResponse<ScoreEntry>>(
    `/patients/${patientId}/scores`,
    data,
  );
  return ensureData(response.data, 'API contract');
}

export async function deleteScore(
  patientId: string,
  scoreId: string,
): Promise<void> {
  const response = await apiClient.delete<ApiResponse<{ deleted: string }>>(
    `/patients/${patientId}/scores/${scoreId}`,
  );
  ensureSuccess(response.data, 'API contract');
}

export async function getScoreTrends(
  patientId: string,
  scoreType: 'pain' | 'rass',
  hours: number = 72,
): Promise<ScoreTrendsResponse> {
  const response = await apiClient.get<ApiResponse<ScoreTrendsResponse>>(
    `/patients/${patientId}/scores/trends?score_type=${scoreType}&hours=${hours}`,
  );
  return ensureData(response.data, 'API contract');
}
