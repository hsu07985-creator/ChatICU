import { Loader2, RotateCw } from 'lucide-react';

/**
 * F2: snapshot freshness pill + manual refresh button. Originally lived
 * inline in src/pages/ai-chat.tsx; extracted in F-PARITY (2026-05-03) so
 * the patient-detail page's 對話助手 tab can render the same control —
 * pharmacists usually enter chat from there, not from the sidebar.
 *
 * Stays hidden when there is no patient context yet (no snapshot to show
 * an age for) or when the parent says it shouldn't be visible. Renders
 * amber once the snapshot is older than 30 minutes to nudge the user;
 * the LLM's vent/lab/score view of the patient can drift by then.
 */
export interface SnapshotRefreshControlProps {
  /** Parent decides visibility — usually
   *  Boolean(selectedSessionId && effectivePatientId && snapshotTakenAt). */
  visible: boolean;
  /** ISO-8601 of when the backend last (re)built the snapshot. */
  takenAt: string | null;
  /** True while the in-flight refresh request is pending. */
  refreshing: boolean;
  /** Fired when the pill is clicked. Parent should call
   *  refreshChatSessionSnapshot() and update local state. */
  onRefresh: () => void;
}

export function SnapshotRefreshControl({
  visible,
  takenAt,
  refreshing,
  onRefresh,
}: SnapshotRefreshControlProps) {
  if (!visible || !takenAt) return null;

  const age = Date.now() - new Date(takenAt).getTime();
  const ageMinutes = Math.max(0, Math.floor(age / 60000));
  const isStale = ageMinutes >= 30;
  const ageLabel = ageMinutes === 0 ? '剛剛' : `${ageMinutes} 分鐘前`;

  return (
    <button
      onClick={onRefresh}
      disabled={refreshing}
      className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
        isStale
          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
          : 'border-border text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800'
      } disabled:cursor-not-allowed disabled:opacity-60`}
      title={
        isStale
          ? '快照已過 30 分鐘，建議重新整理以避免 LLM 用過期資料推論'
          : '重新整理病患快照'
      }
    >
      {refreshing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RotateCw className="h-3 w-3" />
      )}
      <span>快照{ageLabel}</span>
    </button>
  );
}
