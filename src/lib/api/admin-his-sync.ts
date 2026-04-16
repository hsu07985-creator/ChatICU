/**
 * Client for POST /admin/his-sync — manual HIS sync trigger.
 *
 * Only works when the backend is running on the same machine that owns the
 * `patient/` folder (i.e. local dev, not Railway). When the backend returns
 * 503 "disabled", the UI should gray out the buttons and explain why.
 */
import apiClient, { ensureData, type ApiResponse } from '../api-client';

export type HisSyncMode = 'detect' | 'force';

export interface HisSyncCounts {
  forced: number;
  new: number;
  changed: number;
  timestamp_only: number;
  unchanged: number;
  synced: number;
  errors: number;
}

export interface HisSyncResult {
  mode: HisSyncMode;
  patient: string | null;
  success: boolean;
  return_code: number;
  counts: HisSyncCounts;
  stdout_tail: string;
  stderr_tail: string;
}

/**
 * Admin token is injected at build time via `VITE_ADMIN_SYNC_TOKEN`.
 * Production Vercel builds leave it empty → the buttons disable themselves.
 */
function getAdminToken(): string {
  return (import.meta.env.VITE_ADMIN_SYNC_TOKEN as string | undefined) ?? '';
}

export function isHisSyncAvailable(): boolean {
  return Boolean(getAdminToken());
}

export async function triggerHisSync(
  mode: HisSyncMode,
  patient?: string,
): Promise<HisSyncResult> {
  const params: Record<string, string | boolean> = {
    force: mode === 'force',
  };
  if (patient) {
    params.patient = patient;
  }

  const response = await apiClient.post<ApiResponse<HisSyncResult>>(
    '/admin/his-sync',
    null,
    {
      params,
      headers: { 'X-Admin-Token': getAdminToken() },
      // 15 minutes — matches backend _SYNC_TIMEOUT_SECONDS
      timeout: 15 * 60 * 1000,
      suppressErrorToast: true,
    },
  );

  return ensureData(response.data, 'triggerHisSync');
}
