import { useCallback, useEffect, useRef, useState } from 'react';
import { getNotificationSummary, type NotificationSummary } from '../lib/api/notifications';

const POLL_INTERVAL_MS = 60 * 1000;

export interface UseNotificationSummary {
  summary: NotificationSummary | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Poll /notifications/summary every 60s. Pauses while the tab is hidden
 * and refreshes immediately on re-focus to avoid wasted requests.
 */
export function useNotificationSummary(enabled: boolean): UseNotificationSummary {
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setLoading(true);
      const data = await getNotificationSummary();
      setSummary(data);
    } catch {
      // Silent — sidebar badge is best-effort; don't spam toasts.
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  const clearTimer = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startTimer = useCallback(() => {
    clearTimer();
    intervalRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchOnce();
    }, POLL_INTERVAL_MS);
  }, [fetchOnce]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }

    void fetchOnce();
    startTimer();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchOnce();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, fetchOnce, startTimer]);

  return { summary, loading, refresh: fetchOnce };
}
