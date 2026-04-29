import type { Patient } from './api/patients';
import { invalidatePatients } from './patients-cache';
import { queryClient } from './query-client';
import { queryKeys } from './query-keys';

interface RefreshSharedPatientDataOptions {
  refreshDashboardStats?: boolean;
}

interface RefreshSharedPatientDataResult {
  patients: Patient[] | null;
  patientsRefreshFailed: boolean;
}

export async function refreshSharedPatientDataAfterMutation(
  options: RefreshSharedPatientDataOptions = {},
): Promise<RefreshSharedPatientDataResult> {
  const { refreshDashboardStats = true } = options;

  // Invalidate the legacy hand-rolled patients cache AND the TanStack Query
  // caches. The hand-rolled dashboard-stats-cache was removed in Phase 3.3 —
  // dashboard stats now flow exclusively through TanStack Query, so a single
  // queryClient.invalidateQueries call below covers every consumer.
  queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
  if (refreshDashboardStats) {
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }

  const patientsResult = await invalidatePatients()
    .then((value) => ({ status: 'fulfilled' as const, value }))
    .catch((reason) => ({ status: 'rejected' as const, reason }));

  const patients =
    patientsResult.status === 'fulfilled' ? patientsResult.value : null;
  const patientsRefreshFailed = patientsResult.status === 'rejected';

  if (patientsRefreshFailed) {
    console.warn(
      'Failed to refresh shared patients cache after mutation',
      patientsResult.reason,
    );
  }

  return {
    patients,
    patientsRefreshFailed,
  };
}
