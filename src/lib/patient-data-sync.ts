import type { Patient } from './api/patients';
import { invalidateDashboardStats } from './dashboard-stats-cache';
import { invalidatePatients } from './patients-cache';
import { queryClient } from './query-client';
import { queryKeys } from './query-keys';

interface RefreshSharedPatientDataOptions {
  refreshDashboardStats?: boolean;
}

interface RefreshSharedPatientDataResult {
  patients: Patient[] | null;
  patientsRefreshFailed: boolean;
  dashboardStatsRefreshFailed: boolean;
}

export async function refreshSharedPatientDataAfterMutation(
  options: RefreshSharedPatientDataOptions = {},
): Promise<RefreshSharedPatientDataResult> {
  const { refreshDashboardStats = true } = options;

  // Invalidate the legacy hand-rolled module-level caches AND the TanStack
  // Query cache. Both code paths read patient/dashboard data, and historically
  // a write would only invalidate one side, leaving the other stale until its
  // own TTL expired (5 min for the hand-rolled caches). See
  // docs/system-audit-2026-04-28.md §3.1.
  queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
  if (refreshDashboardStats) {
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }

  const [patientsResult, dashboardStatsResult] = await Promise.allSettled([
    invalidatePatients(),
    refreshDashboardStats ? invalidateDashboardStats() : Promise.resolve(null),
  ]);

  const patients =
    patientsResult.status === 'fulfilled' ? patientsResult.value : null;

  const patientsRefreshFailed = patientsResult.status === 'rejected';
  const dashboardStatsRefreshFailed =
    refreshDashboardStats && dashboardStatsResult.status === 'rejected';

  if (patientsRefreshFailed) {
    console.warn('Failed to refresh shared patients cache after mutation', patientsResult.reason);
  }
  if (dashboardStatsRefreshFailed) {
    console.warn('Failed to refresh dashboard stats cache after mutation', dashboardStatsResult.reason);
  }

  return {
    patients,
    patientsRefreshFailed,
    dashboardStatsRefreshFailed,
  };
}
