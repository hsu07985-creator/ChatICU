import { useCallback, useEffect, useRef, useState } from 'react';
import { getChatUnreadCount } from '../lib/api/team-chat';

const POLL_INTERVAL_MS = 60 * 1000;

export interface UseTeamChatUnread {
  count: number;
  refresh: () => void;
}

/**
 * Poll /team/chat/unread-count every 60s for the sidebar badge. Pauses
 * while the tab is hidden and refreshes on re-focus to avoid wasted
 * requests. Mirrors useNotificationSummary's lifecycle.
 */
export function useTeamChatUnread(enabled: boolean): UseTeamChatUnread {
  const [count, setCount] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const data = await getChatUnreadCount();
      setCount(data.count);
    } catch {
      // best-effort — sidebar badge is non-critical, no toast spam.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const clearTimer = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }

    void fetchOnce();
    intervalRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchOnce();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchOnce();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, fetchOnce]);

  return { count, refresh: fetchOnce };
}
