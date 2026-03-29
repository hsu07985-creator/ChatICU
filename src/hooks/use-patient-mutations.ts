import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation, queryKeys } from './use-api-query';
import {
  createPatient,
  updatePatient,
  archivePatient,
  type Patient,
  type CreatePatientData,
  type ArchivePatientData,
} from '../lib/api/patients';

// ────────────────────────────────────────────────────────────────
// useCreatePatient
// ────────────────────────────────────────────────────────────────

/**
 * Mutation for creating a new patient.
 *
 * On success the patients list cache is automatically invalidated so
 * every component consuming `useAllPatients` gets fresh data.
 */
export function useCreatePatient() {
  const queryClient = useQueryClient();

  return useApiMutation<Patient, Error, CreatePatientData>({
    mutationFn: (data) => createPatient(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

// ────────────────────────────────────────────────────────────────
// useUpdatePatient
// ────────────────────────────────────────────────────────────────

interface UpdatePatientVars {
  id: string;
  data: Partial<Patient>;
}

/**
 * Mutation for updating an existing patient.
 *
 * Invalidates both the list and the individual detail cache.
 */
export function useUpdatePatient() {
  const queryClient = useQueryClient();

  return useApiMutation<Patient, Error, UpdatePatientVars>({
    mutationFn: ({ id, data }) => updatePatient(id, data),
    onSuccess: (_updated, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.patients.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}

// ────────────────────────────────────────────────────────────────
// useArchivePatient
// ────────────────────────────────────────────────────────────────

interface ArchivePatientVars {
  id: string;
  data: ArchivePatientData;
}

/**
 * Mutation for archiving (or unarchiving) a patient.
 */
export function useArchivePatient() {
  const queryClient = useQueryClient();

  return useApiMutation<Patient, Error, ArchivePatientVars>({
    mutationFn: ({ id, data }) => archivePatient(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.patients.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
