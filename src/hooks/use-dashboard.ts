import { useApiQuery, queryKeys } from './use-api-query';
import { getDashboardStats, type DashboardStats } from '../lib/api/dashboard';
import { getAllPatients, type Patient } from '../lib/api/patients';

// ────────────────────────────────────────────────────────────────
// useDashboardStats — ICU summary statistics
// ────────────────────────────────────────────────────────────────

/**
 * Fetches dashboard statistics (patient counts, SAN breakdown, alerts, etc.).
 */
export function useDashboardStats() {
  return useApiQuery<DashboardStats>({
    queryKey: queryKeys.dashboard.stats(),
    queryFn: () => getDashboardStats(),
  });
}

// ────────────────────────────────────────────────────────────────
// useDashboardPatients — patient list used on the dashboard page
// ────────────────────────────────────────────────────────────────

/**
 * Fetches the full patient list for the dashboard card grid.
 *
 * Shares the same cache key as the patients list page so
 * navigating between Dashboard and Patients is instant.
 */
export function useDashboardPatients() {
  return useApiQuery<Patient[]>({
    queryKey: queryKeys.patients.list(),
    queryFn: () => getAllPatients(),
  });
}
