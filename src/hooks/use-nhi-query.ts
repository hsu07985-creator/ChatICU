import { useApiMutation } from './use-api-query';
import {
  queryNhiReimbursement,
  type NhiQueryRequest,
  type NhiQueryResult,
} from '../lib/api/ai';

/**
 * TanStack Query mutation hook for NHI reimbursement queries (B08).
 *
 * Usage:
 * ```tsx
 * const { mutate, data, isPending, error } = useNhiQuery();
 * mutate({ drug_name: 'pembrolizumab', indication: '非小細胞肺癌' });
 * ```
 *
 * `data` is `NhiQueryResult` — contains both the query data and an optional
 * `warning` string when the backend NHI service is in degraded mode.
 */
export function useNhiQuery() {
  return useApiMutation<NhiQueryResult, Error, NhiQueryRequest>({
    mutationFn: (request) => queryNhiReimbursement(request),
  });
}
