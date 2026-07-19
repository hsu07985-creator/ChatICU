import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys';
import { getNotificationSummary, type NotificationSummary } from '../lib/api/notifications';

const POLL_INTERVAL_MS = 60 * 1000;

export interface UseNotificationSummary {
  summary: NotificationSummary | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * /notifications/summary on a shared TanStack Query key, refetched every
 * 60s. Multiple mounts (sidebar badge + bell) share one cache entry and one
 * in-flight request — B5 removed the hand-rolled interval/visibility copy
 * that made each mount poll independently.
 *
 * refetchIntervalInBackground stays false → paused while the tab is hidden;
 * refetchOnWindowFocus 'always' replaces the old visibilitychange refresh.
 */
export function useNotificationSummary(enabled: boolean): UseNotificationSummary {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.notifications.summary(),
    queryFn: getNotificationSummary,
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
    staleTime: 30 * 1000,
    retry: 0,
  });

  return {
    summary: query.data ?? null,
    loading: query.isFetching,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.summary() });
    },
  };
}
