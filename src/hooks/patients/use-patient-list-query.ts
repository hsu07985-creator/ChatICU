import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAllPatients } from '../use-patients';
import { queryKeys } from '../use-api-query';
import type { PatientWithFrontendFields } from '../../features/patients/types';
import { getApiErrorMessage } from '../../lib/api-client';

interface UsePatientListQueryOptions {
  searchTerm: string;
  filterStatus: string;
}

export function usePatientListQuery({ searchTerm, filterStatus }: UsePatientListQueryOptions) {
  const queryClient = useQueryClient();
  const {
    data: rawPatients,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useAllPatients();

  // Cast to PatientWithFrontendFields[] (same as previous implementation)
  const patients = (rawPatients ?? []) as PatientWithFrontendFields[];

  // Derive a user-friendly error string (matches prior behaviour)
  const error: string | null = queryError
    ? (getApiErrorMessage(queryError, '無法載入病人列表，請稍後再試'))
    : null;

  /**
   * fetchPatients — kept for backward compatibility with callers that
   * still expect the imperative `fetchPatients({ background })` API
   * (e.g. usePatientDialogState.onPatientsMutated).
   *
   * Under the hood this simply invalidates the TanStack Query cache,
   * which triggers a background refetch.
   */
  const fetchPatients = useCallback(
    async (_options?: { background?: boolean }): Promise<boolean> => {
      try {
        await queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
        // Also refetch to ensure the component waits for fresh data
        const result = await refetch();
        return result.isSuccess;
      } catch {
        return false;
      }
    },
    [queryClient, refetch],
  );

  const getSedation = (patient: PatientWithFrontendFields) =>
    patient.sedation || patient.sanSummary?.sedation || [];
  const getAnalgesia = (patient: PatientWithFrontendFields) =>
    patient.analgesia || patient.sanSummary?.analgesia || [];
  const getNmb = (patient: PatientWithFrontendFields) =>
    patient.nmb || patient.sanSummary?.nmb || [];

  const filteredPatients = useMemo(
    () =>
      patients.filter((patient) => {
        const matchSearch = patient.name.includes(searchTerm) || patient.bedNumber.includes(searchTerm);

        if (filterStatus === 'intubated') return matchSearch && patient.intubated;
        if (filterStatus === 'san') {
          return (
            matchSearch &&
            (getSedation(patient).length > 0 ||
              getAnalgesia(patient).length > 0 ||
              getNmb(patient).length > 0)
          );
        }

        return matchSearch;
      }),
    [filterStatus, patients, searchTerm],
  );

  const getICUDays = (icuAdmissionDate: string) => {
    const today = new Date();
    const admission = new Date(icuAdmissionDate);
    const diffTime = Math.abs(today.getTime() - admission.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getDepartmentBgColor = (department: string | null | undefined) => {
    const normalizedDepartment = department ?? '';
    if (normalizedDepartment.includes('內科')) {
      return 'bg-blue-50 hover:bg-blue-100/70';
    }
    if (normalizedDepartment.includes('外科')) {
      return 'bg-amber-50 hover:bg-amber-100/70';
    }
    return 'hover:bg-muted/50';
  };

  const getDepartmentBadgeColor = (department: string | null | undefined) => {
    const normalizedDepartment = department ?? '';
    if (normalizedDepartment.includes('內科')) {
      return 'bg-blue-600 text-white';
    }
    if (normalizedDepartment.includes('外科')) {
      return 'bg-amber-600 text-white';
    }
    return 'bg-gray-600 text-white';
  };

  return {
    patients,
    loading,
    error,
    filteredPatients,
    fetchPatients,
    getICUDays,
    getDepartmentBgColor,
    getDepartmentBadgeColor,
  };
}
