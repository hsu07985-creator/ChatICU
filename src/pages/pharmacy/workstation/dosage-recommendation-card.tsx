import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/badge';
import type { DosageResult } from './types';

interface DosageRecommendationCardProps {
  dose: DosageResult;
  showAdjustmentBadge: boolean;
}

const statusConfig: Record<DosageResult['status'], { label: string; className: string }> = {
  calculated: {
    label: '已計算',
    className: 'bg-brand text-white',
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

/** Pure local rate calculation: rate = dosingWeight × dosePerKgHr / concentration */
function calcRate(dosingWeight: number, dosePerKgHr: number, conc: number): number {
  if (conc <= 0) return 0;
  return parseFloat((dosingWeight * dosePerKgHr / conc).toFixed(1));
}

export const DosageRecommendationCard = memo(function DosageRecommendationCard({
  dose,
  showAdjustmentBadge,
}: DosageRecommendationCardProps) {
  const canAdjust = dose.status === 'calculated' && dose.padKey && dose.doseRangeMin != null && dose.doseRangeMax != null && dose.doseRangeMax > dose.doseRangeMin;

  const defaultMin = dose.doseRangeMin ?? 0;
  const defaultMax = dose.doseRangeMax ?? 1;
  const defaultConc = dose.defaultConcentration ?? dose.concentration ?? 1;
  const dosingWt = dose.dosingWeightKg ?? dose.weightKg ?? 0;

  const [minDose, setMinDose] = useState(defaultMin);
  const [maxDose, setMaxDose] = useState(defaultMax);
  const [conc, setConc] = useState(defaultConc);

  // Sync when parent dose changes (full re-assessment)
  useEffect(() => {
    setMinDose(dose.doseRangeMin ?? 0);
    setMaxDose(dose.doseRangeMax ?? 1);
    setConc(dose.defaultConcentration ?? dose.concentration ?? 1);
  }, [dose.doseRangeMin, dose.doseRangeMax, dose.defaultConcentration, dose.concentration]);

  // Compute rates locally — no API call needed
  const rateMin = useMemo(() => calcRate(dosingWt, minDose, conc), [dosingWt, minDose, conc]);
  const rateMax = useMemo(() => calcRate(dosingWt, maxDose, conc), [dosingWt, maxDose, conc]);

  // Compute dose per hour for display
  const dosePerHrMin = useMemo(() => parseFloat((dosingWt * minDose).toFixed(2)), [dosingWt, minDose]);
  const dosePerHrMax = useMemo(() => parseFloat((dosingWt * maxDose).toFixed(2)), [dosingWt, maxDose]);

  // Slider step
  const sliderStep = parseFloat(Math.max((defaultMax - defaultMin) / 100, 0.001).toPrecision(1));
  const decimals = sliderStep < 0.01 ? 3 : sliderStep < 0.1 ? 2 : 1;

  const handleMinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setMinDose(val);
    if (val > maxDose) setMaxDose(val);
  }, [maxDose]);

  const handleMaxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setMaxDose(val);
    if (val < minDose) setMinDose(val);
  }, [minDose]);

  const handleConcChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) setConc(val);
  }, []);

  const summaryTone = dose.status === 'calculated'
    ? 'text-slate-700'
    : dose.status === 'service_unavailable'
      ? 'text-red-700'
      : 'text-amber-700';
  const resultBadge = dose.isEquivalentEstimate ? '等效換算' : dose.orderTypeLabel || '連續輸注';
  const doseUnitShort = dose.doseUnit?.replace('/kg', '') || '/hr';

  const isModified = minDose !== defaultMin || maxDose !== defaultMax || conc !== defaultConc;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3">
        {/* Header */}
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
          {isModified && (
            <Badge variant="outline" className="text-xs border-blue-400 text-blue-600">
              已調整
            </Badge>
          )}
        </div>

        {/* Rate range output — primary display */}
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-lg border border-[#ead7e1] bg-[#fdf6fa] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">輸注速率範圍</p>
            <p className="text-lg font-bold text-brand">
              {rateMin} ~ {rateMax} <span className="text-sm font-normal">ml/hr</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {dosePerHrMin} ~ {dosePerHrMax} {doseUnitShort}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center min-w-[80px]">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">體重</p>
            <p className="text-sm font-semibold text-slate-700">{dosingWt} kg</p>
            <p className="text-[10px] text-muted-foreground">{dose.weightBasis || 'TBW'}</p>
          </div>
        </div>

        {/* Three adjustment controls */}
        {canAdjust && (
          <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            {/* Min dose slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">最小劑量 ({dose.doseUnit})</span>
                <span className="font-mono font-medium text-slate-700">{minDose.toFixed(decimals)}</span>
              </div>
              <input
                type="range"
                min={defaultMin}
                max={defaultMax}
                step={sliderStep}
                value={minDose}
                onChange={handleMinChange}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-emerald-600 bg-slate-200"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{defaultMin}</span>
                <span>→ {calcRate(dosingWt, minDose, conc)} ml/hr</span>
              </div>
            </div>

            {/* Max dose slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">最大劑量 ({dose.doseUnit})</span>
                <span className="font-mono font-medium text-slate-700">{maxDose.toFixed(decimals)}</span>
              </div>
              <input
                type="range"
                min={defaultMin}
                max={defaultMax}
                step={sliderStep}
                value={maxDose}
                onChange={handleMaxChange}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand bg-slate-200"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{defaultMin}</span>
                <span>→ {calcRate(dosingWt, maxDose, conc)} ml/hr</span>
              </div>
            </div>

            {/* Concentration slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">濃度 ({dose.concentrationUnit || 'mg/ml'})</span>
                <span className="font-mono font-medium text-slate-700">{conc}</span>
              </div>
              <input
                type="range"
                min={Math.max(defaultConc * 0.25, 0.1)}
                max={defaultConc * 4}
                step={parseFloat(Math.max(defaultConc * 0.01, 0.01).toPrecision(1))}
                value={conc}
                onChange={handleConcChange}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-violet-600 bg-slate-200"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{parseFloat((defaultConc * 0.25).toFixed(2))}</span>
                <span>預設 {defaultConc}</span>
                <span>{parseFloat((defaultConc * 4).toFixed(2))}</span>
              </div>
            </div>

            {/* Reset button */}
            {isModified && (
              <button
                type="button"
                onClick={() => { setMinDose(defaultMin); setMaxDose(defaultMax); setConc(defaultConc); }}
                className="text-xs text-brand hover:underline"
              >
                重設為預設值
              </button>
            )}
          </div>
        )}

        {/* Calculation details */}
        {dose.weightBasis && dose.dosingWeightKg && (
          <p className="text-xs text-muted-foreground">
            體重基準：{dose.weightBasis}（{dose.dosingWeightKg} kg）
          </p>
        )}
        {dose.calculationSteps && dose.calculationSteps.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-slate-600">計算步驟</summary>
            <ol className="mt-1 ml-4 list-decimal space-y-0.5">
              {dose.calculationSteps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
});
