import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys';
import { getChatUnreadCount } from '../lib/api/team-chat';

const POLL_INTERVAL_MS = 60 * 1000;

export interface UseTeamChatUnread {
  count: number;
  refresh: () => void;
}

/**
 * /team/chat/unread-count for the sidebar badge — shared TanStack Query key,
 * 60s refetchInterval, paused in background tabs (see use-notification-summary
 * for the B5 rationale).
 */
export function useTeamChatUnread(enabled: boolean): UseTeamChatUnread {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.teamChat.unread(),
    queryFn: getChatUnreadCount,
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
    staleTime: 30 * 1000,
    retry: 0,
  });

  return {
    count: query.data?.count ?? 0,
    refresh: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.teamChat.unread() });
    },
  };
}
