// ScoreSelector — color-graded numeric picker for Pain (0-10) / RASS (-5~+4)
// scores. Extracted from patient-medications-tab.tsx (behavior-preserving).
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';

export function ScoreSelector({
  min,
  max,
  currentValue,
  onSelect,
  onPendingChange,
  formatLabel,
  colorFn,
}: {
  min: number;
  max: number;
  currentValue: number | null;
  onSelect: (v: number) => void;
  onPendingChange?: (v: number | null) => void;
  formatLabel?: (v: number) => string;
  colorFn?: (v: number) => string;
}) {
  const { t } = useTranslation('medications');
  const [pending, setPending] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasPending = pending !== null && pending !== currentValue;
  const fmt = useCallback((v: number) => formatLabel ? formatLabel(v) : `${v}`, [formatLabel]);
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const updatePending = (v: number | null) => {
    setPending(v);
    onPendingChange?.(v);
  };

  const handleConfirm = async () => {
    if (pending === null) return;
    setSubmitting(true);
    try {
      await onSelect(pending);
      updatePending(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* 色階數字格 */}
      <div className="flex gap-[3px]">
        {values.map((v) => {
          const isSelected = v === pending || (pending === null && v === currentValue);
          const color = colorFn ? colorFn(v) : 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
          return (
            <button
              key={v}
              type="button"
              disabled={submitting}
              onClick={() => updatePending(v)}
              className={`flex-1 py-1.5 text-xs font-semibold tabular-nums rounded transition-all border
                ${isSelected
                  ? `${color} ring-2 ring-brand ring-offset-1 scale-105 shadow-sm`
                  : 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-700 dark:hover:text-gray-300 hover:scale-105'
                }
                disabled:pointer-events-none disabled:opacity-40
              `}
            >
              {fmt(v)}
            </button>
          );
        })}
      </div>
      {/* 確認列 */}
      {hasPending && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 px-3 text-xs font-medium bg-brand hover:bg-brand-hover rounded-md"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? t('tab.scoreSelector.saving') : t('tab.scoreSelector.confirm')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={submitting}
            onClick={() => updatePending(null)}
          >
            {t('tab.scoreSelector.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
