import { useCallback } from 'react';
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

  // 穩定 identity:notification-bell 的 effect 依賴 refresh —— inline arrow
  // 會在每次 render 重建 → effect 重跑 → invalidate → re-render 無限迴圈。
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.summary() });
  }, [queryClient]);

  return {
    summary: query.data ?? null,
    loading: query.isFetching,
    refresh,
  };
}
