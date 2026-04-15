import apiClient, { ensureData, type ApiResponse } from '../api-client';

/** One "new records arrived" event, appended by the HIS sync pipeline into
 *  the bounded `recent_deltas` ring buffer inside `sync_status.details`. */
export interface SyncDeltaEvent {
  patient_id: string;
  patient_name: string;
  patient_mrn: string;
  snapshot_id: string;
  synced_at: string;
  added: {
    medications: number;
    lab_data: number;
    culture_results: number;
    diagnostic_reports: number;
  };
  removed: {
    medications: number;
  };
}

export interface SyncStatusDetails {
  patient_id?: string;
  patient_name?: string;
  patient_mrn?: string;
  snapshot_id?: string;
  recent_deltas?: SyncDeltaEvent[];
  [key: string]: unknown;
}

export interface SyncStatusResponse {
  available: boolean;
  source: string;
  version: string | null;
  lastSyncedAt: string | null;
  details: SyncStatusDetails | null;
}

export async function getSyncStatus(): Promise<SyncStatusResponse> {
  const response = await apiClient.get<ApiResponse<SyncStatusResponse>>('/sync/status', {
    suppressErrorToast: true,
  });
  return ensureData(response.data, 'getSyncStatus');
}
