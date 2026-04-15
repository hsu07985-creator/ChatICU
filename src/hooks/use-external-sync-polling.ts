import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { getSyncStatus, type SyncDeltaEvent } from '../lib/api/sync';
import { refreshSharedPatientDataAfterMutation } from '../lib/patient-data-sync';

const POLL_INTERVAL_MS = 60 * 1000;

/** Turn one delta event into a short toast body like
 *  "林阿玉（16312169）：2 筆新生化、1 份培養報告、1 筆新醫囑已同步" */
function formatDeltaMessage(event: SyncDeltaEvent): string {
  const parts: string[] = [];
  if (event.added.lab_data > 0) {
    parts.push(`${event.added.lab_data} 筆新檢驗`);
  }
  if (event.added.culture_results > 0) {
    parts.push(`${event.added.culture_results} 份新培養`);
  }
  if (event.added.diagnostic_reports > 0) {
    parts.push(`${event.added.diagnostic_reports} 份新報告`);
  }
  if (event.added.medications > 0) {
    parts.push(`${event.added.medications} 筆新醫囑`);
  }
  if (event.removed.medications > 0) {
    parts.push(`${event.removed.medications} 筆醫囑停用`);
  }
  if (parts.length === 0) {
    return '';
  }
  return parts.join('、');
}

export function useExternalSyncPolling(enabled: boolean): void {
  const lastSeenVersionRef = useRef<string | null>(null);
  const isRefreshingRef = useRef(false);
  // Tracks the `synced_at` timestamp of the most recent delta event we've
  // already surfaced as a toast, so polling can replay only what's new.
  const lastDeltaAtRef = useRef<string | null>(null);
  // Skip the first poll's deltas — we don't want to spam the user with a
  // backlog of events that happened before they opened the tab.
  const initializedDeltaCursorRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      lastSeenVersionRef.current = null;
      isRefreshingRef.current = false;
      lastDeltaAtRef.current = null;
      initializedDeltaCursorRef.current = false;
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

        const recentDeltas = status.details?.recent_deltas ?? [];
        const previousDeltaAt = lastDeltaAtRef.current;

        // Advance the delta cursor to the latest known event on the first
        // poll without toasting — those events are backlog, not news.
        if (!initializedDeltaCursorRef.current) {
          initializedDeltaCursorRef.current = true;
          const latest = recentDeltas[recentDeltas.length - 1];
          lastDeltaAtRef.current = latest?.synced_at ?? null;
        } else if (recentDeltas.length > 0) {
          const newEvents = previousDeltaAt
            ? recentDeltas.filter((event) => event.synced_at > previousDeltaAt)
            : recentDeltas;
          const latest = recentDeltas[recentDeltas.length - 1];
          lastDeltaAtRef.current = latest?.synced_at ?? previousDeltaAt;

          for (const event of newEvents) {
            const body = formatDeltaMessage(event);
            if (!body) {
              continue;
            }
            toast.success(`${event.patient_name}（${event.patient_mrn}）`, {
              description: `${body}已同步`,
              duration: 6000,
            });
          }
        }

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
