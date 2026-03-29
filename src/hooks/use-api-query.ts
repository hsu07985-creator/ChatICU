import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
} from '@tanstack/react-query';

/**
 * Query-key factory helpers.
 *
 * Usage:
 *   queryKeys.patients.all          → ['patients']
 *   queryKeys.patients.list(filters) → ['patients', 'list', filters]
 *   queryKeys.patients.detail(id)    → ['patients', 'detail', id]
 *   queryKeys.dashboard.stats()      → ['dashboard', 'stats']
 */
export const queryKeys = {
  patients: {
    all: ['patients'] as const,
    lists: () => [...queryKeys.patients.all, 'list'] as const,
    list: (filters?: Record<string, unknown>) =>
      [...queryKeys.patients.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.patients.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.patients.details(), id] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    stats: () => [...queryKeys.dashboard.all, 'stats'] as const,
  },
  ai: {
    all: ['ai'] as const,
    readiness: () => [...queryKeys.ai.all, 'readiness'] as const,
    sessions: (params?: Record<string, unknown>) =>
      [...queryKeys.ai.all, 'sessions', params ?? {}] as const,
    session: (id: string) => [...queryKeys.ai.all, 'session', id] as const,
  },
} as const;

// ────────────────────────────────────────────────────────────────
// useApiQuery — thin wrapper around useQuery
// ────────────────────────────────────────────────────────────────

/**
 * A thin wrapper around TanStack `useQuery` that is pre-typed for the
 * project's API layer.
 *
 * The raw API functions in `src/lib/api/*.ts` already unwrap the
 * `{ success, data, error }` envelope and throw on failure, so
 * useApiQuery simply passes the `queryFn` through.  The 401 redirect
 * is handled globally by the Axios interceptor in `api-client.ts`.
 *
 * @example
 * ```ts
 * const { data, isLoading, error } = useApiQuery({
 *   queryKey: queryKeys.patients.list(),
 *   queryFn: () => getAllPatients(),
 * });
 * ```
 */
export function useApiQuery<
  TData = unknown,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: UseQueryOptions<TData, TError, TData, TQueryKey>,
) {
  return useQuery<TData, TError, TData, TQueryKey>(options);
}

// ────────────────────────────────────────────────────────────────
// useApiMutation — thin wrapper around useMutation
// ────────────────────────────────────────────────────────────────

/**
 * A thin wrapper around TanStack `useMutation`.
 *
 * @example
 * ```ts
 * const create = useApiMutation({
 *   mutationFn: (data: CreatePatientData) => createPatient(data),
 *   onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.patients.all }),
 * });
 * ```
 */
export function useApiMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
) {
  return useMutation<TData, TError, TVariables, TContext>(options);
}
