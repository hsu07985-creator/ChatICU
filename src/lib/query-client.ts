import { QueryClient } from '@tanstack/react-query';

/**
 * Shared QueryClient instance for the application.
 *
 * Defaults are tuned for a clinical / medical context:
 *  - staleTime 5 min — reduces unnecessary refetches while keeping data
 *    reasonably fresh for bedside use.
 *  - retry 1 — a single automatic retry is acceptable; excessive retries
 *    would delay error feedback to clinicians.
 *  - refetchOnWindowFocus false — avoids surprising data refreshes when the
 *    user alt-tabs back, which could be distracting during ward rounds.
 *  - gcTime 10 min — keep inactive cache slightly longer than staleTime so
 *    navigating back to a recently-viewed page is instant.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,       // 5 minutes
      gcTime: 10 * 60 * 1000,          // 10 minutes (garbage collection)
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 0,
    },
  },
});
