import apiClient, { ensureData, type ApiResponse } from '../api-client';

export interface SyncStatusResponse {
  available: boolean;
  source: string;
  version: string | null;
  lastSyncedAt: string | null;
  details: Record<string, unknown> | null;
}

export async function getSyncStatus(): Promise<SyncStatusResponse> {
  const response = await apiClient.get<ApiResponse<SyncStatusResponse>>('/sync/status', {
    suppressErrorToast: true,
  });
  return ensureData(response.data, 'getSyncStatus');
}
