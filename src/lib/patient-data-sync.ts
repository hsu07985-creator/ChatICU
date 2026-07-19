import type { Patient } from './api/patients';
import { getAllPatients } from './api/patients';
import { queryClient } from './query-client';
import { queryKeys } from './query-keys';

/** The query key `usePatientList()` / `useAllPatients()` (no filters) reads. */
export const PATIENT_LIST_KEY = queryKeys.patients.list(undefined);

interface RefreshSharedPatientDataOptions {
  refreshDashboardStats?: boolean;
}

interface RefreshSharedPatientDataResult {
  patients: Patient[] | null;
  patientsRefreshFailed: boolean;
}

/**
 * B1: TanStack Query is now the only patient-list cache — the legacy
 * hand-rolled patients-cache singleton (and this module's bridging to it)
 * is gone. Invalidate + refetch the shared list so every consumer of
 * usePatientList()/useAllPatients() re-renders with fresh data.
 */
export async function refreshSharedPatientDataAfterMutation(
  options: RefreshSharedPatientDataOptions = {},
): Promise<RefreshSharedPatientDataResult> {
  const { refreshDashboardStats = true } = options;

  queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
  if (refreshDashboardStats) {
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }

  try {
    const patients = await queryClient.fetchQuery({
      queryKey: PATIENT_LIST_KEY,
      queryFn: () => getAllPatients(),
    });
    return { patients, patientsRefreshFailed: false };
  } catch (reason) {
    console.warn('Failed to refresh shared patients cache after mutation', reason);
    return { patients: null, patientsRefreshFailed: true };
  }
}

/**
 * Optimistic fallback when the post-mutation refetch failed: patch the
 * cached list in place so the UI at least reflects the confirmed change.
 */
export function patchSharedPatientList(
  updater: (current: Patient[]) => Patient[],
): void {
  queryClient.setQueryData<Patient[]>(PATIENT_LIST_KEY, (current) =>
    current ? updater(current) : current,
  );
}
