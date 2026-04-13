import type { Patient } from './api/patients';
import { invalidateDashboardStats } from './dashboard-stats-cache';
import { invalidatePatients } from './patients-cache';

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
