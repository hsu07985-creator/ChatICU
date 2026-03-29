import { useApiQuery, queryKeys } from './use-api-query';
import {
  getAllPatients,
  getPatient,
  type Patient,
  type PatientFilters,
} from '../lib/api/patients';

// ────────────────────────────────────────────────────────────────
// useAllPatients — fetch the full patient list (auto-paginated)
// ────────────────────────────────────────────────────────────────

/**
 * Fetches every patient via the auto-paginating `getAllPatients` helper.
 *
 * Returns a standard TanStack Query result whose `data` is `Patient[]`.
 *
 * @param filters - Optional filter criteria (search, intubated, etc.).
 *                  Changing filters will automatically refetch.
 */
export function useAllPatients(filters?: Omit<PatientFilters, 'page' | 'limit'>) {
  return useApiQuery<Patient[]>({
    queryKey: queryKeys.patients.list(filters as Record<string, unknown> | undefined),
    queryFn: () => getAllPatients(filters),
  });
}

// ────────────────────────────────────────────────────────────────
// usePatient — fetch a single patient by ID
// ────────────────────────────────────────────────────────────────

/**
 * Fetches a single patient record.
 *
 * The query is automatically disabled when `id` is falsy
 * (e.g. route param not yet resolved).
 */
export function usePatient(id: string | undefined) {
  return useApiQuery<Patient>({
    queryKey: queryKeys.patients.detail(id ?? ''),
    queryFn: () => getPatient(id!),
    enabled: !!id,
  });
}
