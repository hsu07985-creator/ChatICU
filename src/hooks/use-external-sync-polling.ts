import { useEffect, useRef } from 'react';

import { getSyncStatus } from '../lib/api/sync';
import { refreshSharedPatientDataAfterMutation } from '../lib/patient-data-sync';

const POLL_INTERVAL_MS = 60 * 1000;

export function useExternalSyncPolling(enabled: boolean): void {
  const lastSeenVersionRef = useRef<string | null>(null);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      lastSeenVersionRef.current = null;
      isRefreshingRef.current = false;
      return;
    }

    let cancelled = false;

    async function pollOnce() {
      if (cancelled || document.hidden) {
        return;
      }

      try {
        const status = await getSyncStatus();
        if (cancelled || !status.available || !status.version) {
          return;
        }

        const previousVersion = lastSeenVersionRef.current;
        lastSeenVersionRef.current = status.version;

        if (!previousVersion || previousVersion === status.version) {
          return;
        }

        if (isRefreshingRef.current) {
          return;
        }

        isRefreshingRef.current = true;
        try {
          await refreshSharedPatientDataAfterMutation({
            refreshDashboardStats: true,
          });
        } finally {
          isRefreshingRef.current = false;
        }
      } catch (error) {
        console.warn('Failed to poll external HIS sync status', error);
      }
    }

    void pollOnce();
    const intervalId = window.setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void pollOnce();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);
}
