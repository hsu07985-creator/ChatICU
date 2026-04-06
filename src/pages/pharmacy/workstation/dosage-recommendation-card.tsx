import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { padCalculate } from '../../../lib/api/pharmacy';
import type { DosageResult } from './types';

interface DosageRecommendationCardProps {
  dose: DosageResult;
  showAdjustmentBadge: boolean;
  onDoseRecalculated?: (updated: DosageResult) => void;
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

export function DosageRecommendationCard({
  dose,
  showAdjustmentBadge,
  onDoseRecalculated,
}: DosageRecommendationCardProps) {
  const canAdjust = dose.status === 'calculated' && dose.padKey && dose.doseRangeMin != null && dose.doseRangeMax != null && dose.doseRangeMax > dose.doseRangeMin;

  const [sliderValue, setSliderValue] = useState(dose.currentTargetPerKgHr ?? 0);
  const [concValue, setConcValue] = useState(dose.concentration ?? 1);
  const [localRate, setLocalRate] = useState(dose.calculatedRate);
  const [localDose, setLocalDose] = useState(dose.targetDose);
  const [localSummary, setLocalSummary] = useState(dose.clinicalSummary);
  const [localSteps, setLocalSteps] = useState(dose.calculationSteps);
  const [localRateMin, setLocalRateMin] = useState(dose.rateAtMin ?? 0);
  const [localRateMax, setLocalRateMax] = useState(dose.rateAtMax ?? 0);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Sync when parent dose changes (e.g. full re-assessment)
  useEffect(() => {
    setSliderValue(dose.currentTargetPerKgHr ?? 0);
    setConcValue(dose.concentration ?? 1);
    setLocalRate(dose.calculatedRate);
    setLocalDose(dose.targetDose);
    setLocalSummary(dose.clinicalSummary);
    setLocalSteps(dose.calculationSteps);
    setLocalRateMin(dose.rateAtMin ?? 0);
    setLocalRateMax(dose.rateAtMax ?? 0);
  }, [dose.currentTargetPerKgHr, dose.concentration, dose.calculatedRate, dose.targetDose, dose.clinicalSummary, dose.calculationSteps, dose.rateAtMin, dose.rateAtMax]);

  const recalculate = useCallback(async (target: number, conc: number) => {
    if (!dose.padKey || !dose.weightKg || conc <= 0) return;
    setIsRecalculating(true);
    try {
      const res = await padCalculate({
        drug: dose.padKey,
        weight_kg: dose.weightKg,
        target_dose_per_kg_hr: target,
        concentration: conc,
        sex: dose.sex,
        height_cm: dose.heightCm,
      });
      const rateStr = `${res.rate_ml_hr} ml/hr`;
      const doseUnit = dose.doseUnit?.replace('/kg', '') || '/hr';
      const doseStr = `${res.dose_per_hr} ${doseUnit}`;
      const dosingWt = res.dosing_weight_kg;
      const rangeMin = dose.doseRangeMin ?? 0;
      const rangeMax = dose.doseRangeMax ?? 0;
      const rMin = rangeMin > 0 ? parseFloat((dosingWt * rangeMin / conc).toFixed(1)) : 0;
      const rMax = rangeMax > 0 ? parseFloat((dosingWt * rangeMax / conc).toFixed(1)) : 0;

      setLocalRate(rateStr);
      setLocalDose(doseStr);
      setLocalSummary(`${res.weight_basis} ${dosingWt}kg → ${rateStr}`);
      setLocalSteps(res.steps);
      setLocalRateMin(rMin);
      setLocalRateMax(rMax);

      if (onDoseRecalculated) {
        onDoseRecalculated({
          ...dose,
          calculatedRate: rateStr,
          targetDose: doseStr,
          clinicalSummary: `${res.weight_basis} ${dosingWt}kg → ${rateStr}`,
          calculationSteps: res.steps,
          currentTargetPerKgHr: target,
          concentration: conc,
          rateAtMin: rMin,
          rateAtMax: rMax,
          orderSummary: `${dose.drugName} ${rateStr}`,
        });
      }
    } catch {
      // Keep previous values on error
    } finally {
      setIsRecalculating(false);
    }
  }, [dose, onDoseRecalculated]);

  const debouncedRecalculate = useCallback((target: number, conc: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => recalculate(target, conc), 300);
  }, [recalculate]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSliderValue(val);
    debouncedRecalculate(val, concValue);
  }, [debouncedRecalculate, concValue]);

  const handleConcChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val) || val <= 0) {
      setConcValue(val || 0);
      return;
    }
    setConcValue(val);
    debouncedRecalculate(sliderValue, val);
  }, [debouncedRecalculate, sliderValue]);

  // Cleanup debounce on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const summaryTone = dose.status === 'calculated'
    ? 'text-slate-700'
    : dose.status === 'service_unavailable'
      ? 'text-red-700'
      : 'text-amber-700';
  const resultBadge = dose.isEquivalentEstimate ? '等效換算' : dose.orderTypeLabel || '連續輸注';

  // Compute slider step: use 1/100 of range, rounded to nice number
  const rangeMin = dose.doseRangeMin ?? 0;
  const rangeMax = dose.doseRangeMax ?? 1;
  const sliderStep = parseFloat(Math.max((rangeMax - rangeMin) / 100, 0.001).toPrecision(1));
  const decimals = sliderStep < 0.01 ? 3 : sliderStep < 0.1 ? 2 : 1;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3">
        {/* Header row */}
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
          {isRecalculating && (
            <span className="text-xs text-muted-foreground animate-pulse">計算中...</span>
          )}
        </div>

        {/* Summary + rate range + rate boxes */}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-1 flex-1">
            <p className={`text-sm leading-5 ${summaryTone}`}>{localSummary}</p>
            {/* Rate range display */}
            {canAdjust && localRateMin > 0 && localRateMax > 0 && (
              <p className="text-xs text-muted-foreground">
                速率範圍：<span className="font-mono font-medium text-slate-600">{localRateMin}</span>
                {' ~ '}
                <span className="font-mono font-medium text-slate-600">{localRateMax}</span>
                {' ml/hr'}
                <span className="text-slate-400 ml-1">
                  （{dose.doseUnit} {rangeMin}–{rangeMax}）
                </span>
              </p>
            )}
          </div>

          <div className="grid min-w-0 shrink-0 grid-cols-2 gap-2 xl:w-[250px]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {dose.targetDoseTitle || '原始醫囑'}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">{localDose || dose.orderSummary || '—'}</p>
            </div>
            <div className="rounded-lg border border-[#ead7e1] bg-[#fdf6fa] px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {dose.calculatedRateTitle || '建議速率'}
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">{localRate}</p>
            </div>
          </div>
        </div>

        {/* Inline controls: dose slider + concentration */}
        {canAdjust && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            {/* Dose slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>目標劑量 ({dose.doseUnit})</span>
                <span className="font-mono font-medium text-slate-700">
                  {sliderValue.toFixed(decimals)}
                </span>
              </div>
              <input
                type="range"
                min={rangeMin}
                max={rangeMax}
                step={sliderStep}
                value={sliderValue}
                onChange={handleSliderChange}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand bg-slate-200"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{rangeMin} (min)</span>
                <span>{rangeMax} (max)</span>
              </div>
            </div>

            {/* Concentration input */}
            <div className="flex flex-col gap-1 sm:w-[140px]">
              <label className="text-xs text-muted-foreground">
                濃度 ({dose.concentrationUnit || 'mg/ml'})
              </label>
              <Input
                type="number"
                min={0.01}
                step={0.1}
                value={concValue || ''}
                onChange={handleConcChange}
                className="h-8 text-sm font-mono"
              />
              {dose.defaultConcentration && concValue !== dose.defaultConcentration && (
                <button
                  type="button"
                  onClick={() => {
                    setConcValue(dose.defaultConcentration!);
                    debouncedRecalculate(sliderValue, dose.defaultConcentration!);
                  }}
                  className="text-[10px] text-brand hover:underline text-left"
                >
                  重設預設 ({dose.defaultConcentration})
                </button>
              )}
            </div>
          </div>
        )}

        {/* Weight basis & calculation steps */}
        {dose.weightBasis && dose.dosingWeightKg && (
          <p className="text-xs text-muted-foreground">
            體重基準：{dose.weightBasis}（{dose.dosingWeightKg} kg）
          </p>
        )}
        {dose.supportingNote && (
          <p className="text-xs leading-5 text-muted-foreground">{dose.supportingNote}</p>
        )}
        {localSteps && localSteps.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-slate-600">計算步驟</summary>
            <ol className="mt-1 ml-4 list-decimal space-y-0.5">
              {localSteps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </details>
        )}
        {dose.references && (
          <p className="text-xs leading-5 text-muted-foreground">
            參考：{dose.references}
          </p>
        )}
      </div>
    </div>
  );
}
