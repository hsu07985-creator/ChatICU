import { useAllPatients } from './use-patients';
import type { Patient } from '../lib/api/patients';

const EMPTY: Patient[] = [];

/**
 * B1 (architecture-audit-2026-07-19): the shared patient list, sourced from
 * TanStack Query. Replaces the retired hand-rolled patients-cache singleton
 * (5-min TTL + subscribe) so the list has exactly one cache.
 *
 * Error toasts come from the axios interceptor; pages only need
 * `patientsLoadFailed` when they render an inline error state.
 */
export function usePatientList(options?: { enabled?: boolean }) {
  const query = useAllPatients(undefined, options);
  return {
    patients: query.data ?? EMPTY,
    patientsLoading: query.isLoading,
    patientsLoadFailed: query.isError,
    refetchPatients: query.refetch,
  };
}
