interface ExpertReviewWarningProps {
  show: boolean;
  /** Optional reason text shown below the main warning (e.g. "多個來源存在分歧"). */
  reason?: string;
}

export function ExpertReviewWarning({ show, reason }: ExpertReviewWarningProps) {
  if (!show) return null;

  return (
    <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-400">
      <span className="shrink-0 font-semibold">⚠️</span>
      <div>
        <span>此回答需要專家審核 — 建議由藥師或主治醫師確認後再採用</span>
        {reason && (
          <p className="mt-0.5 text-amber-700 dark:text-amber-400 opacity-80">{reason}</p>
        )}
      </div>
    </div>
  );
}
