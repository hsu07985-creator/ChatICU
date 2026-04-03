import { Badge } from '../../../components/ui/badge';
import type { DosageResult } from './types';

interface DosageRecommendationCardProps {
  dose: DosageResult;
  showAdjustmentBadge: boolean;
}

const statusConfig: Record<DosageResult['status'], { label: string; className: string }> = {
  calculated: {
    label: '已計算',
    className: 'bg-[var(--color-brand)] text-white',
  },
  requires_input: {
    label: '待補資料',
    className: 'bg-[#f59e0b] text-white',
  },
  service_unavailable: {
    label: '服務異常',
    className: 'bg-red-600 text-white',
  },
};

export function DosageRecommendationCard({
  dose,
  showAdjustmentBadge,
}: DosageRecommendationCardProps) {
  const summaryTone = dose.status === 'calculated'
    ? 'text-slate-700'
    : dose.status === 'service_unavailable'
      ? 'text-red-700'
      : 'text-amber-700';
  const resultBadge = dose.isEquivalentEstimate ? '等效換算' : dose.orderTypeLabel || '連續輸注';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-sm sm:text-base">{dose.drugName}</p>
            <Badge className={statusConfig[dose.status].className}>
              {statusConfig[dose.status].label}
            </Badge>
            <Badge variant="outline" className="text-xs border-slate-400 text-slate-600">
              {resultBadge}
            </Badge>
            {showAdjustmentBadge && (
              <Badge variant="outline" className="text-xs border-[#f59e0b] text-[#f59e0b]">
                調
              </Badge>
            )}
          </div>
          <p className={`text-sm leading-5 ${summaryTone}`}>{dose.clinicalSummary}</p>
          {dose.supportingNote && (
            <p className="text-xs leading-5 text-muted-foreground">{dose.supportingNote}</p>
          )}
          {dose.references && (
            <p className="text-xs leading-5 text-muted-foreground">
              參考：{dose.references}
            </p>
          )}
        </div>

        <div className="grid min-w-0 shrink-0 grid-cols-2 gap-2 xl:w-[250px]">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {dose.targetDoseTitle || '原始醫囑'}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">{dose.targetDose || dose.orderSummary || '—'}</p>
          </div>
          <div className="rounded-lg border border-[#ead7e1] bg-[#fdf6fa] px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {dose.calculatedRateTitle || '建議速率'}
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-brand)]">{dose.calculatedRate}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
