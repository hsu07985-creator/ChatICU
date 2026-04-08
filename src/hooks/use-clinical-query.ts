import { useApiMutation } from './use-api-query';
import {
  clinicalUnifiedQuery,
  type UnifiedQueryRequest,
  type UnifiedQueryData,
} from '@/lib/api/ai';

/**
 * TanStack Query mutation hook for the unified clinical query endpoint.
 *
 * This is a mutation (not a query) because clinical queries are user-initiated
 * POST requests, not auto-fetching GET requests.
 *
 * Usage:
 *   const { mutate, isPending, data, error } = useClinicalQuery();
 *   mutate({ question: '...', patient_id: 123 });
 */
export function useClinicalQuery() {
  return useApiMutation<UnifiedQueryData, Error, UnifiedQueryRequest>({
    mutationFn: clinicalUnifiedQuery,
  });
}
