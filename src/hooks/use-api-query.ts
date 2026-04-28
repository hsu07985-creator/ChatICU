import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
} from '@tanstack/react-query';

// queryKeys moved to src/lib/query-keys.ts so non-hook modules can import it
// without a lib → hooks reverse dependency. Re-exported here for compatibility.
export { queryKeys } from '../lib/query-keys';

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
