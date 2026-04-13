import type { Patient } from './api/patients';
import { invalidateDashboardStats } from './dashboard-stats-cache';
import { invalidatePatients } from './patients-cache';

interface RefreshSharedPatientDataOptions {
  refreshDashboardStats?: boolean;
}

interface RefreshSharedPatientDataResult {
  patients: Patient[];
}

export async function refreshSharedPatientDataAfterMutation(
  options: RefreshSharedPatientDataOptions = {},
): Promise<RefreshSharedPatientDataResult> {
  const { refreshDashboardStats = true } = options;

  const [patients] = await Promise.all([
    invalidatePatients(),
    refreshDashboardStats ? invalidateDashboardStats() : Promise.resolve(null),
  ]);

  return { patients };
}
