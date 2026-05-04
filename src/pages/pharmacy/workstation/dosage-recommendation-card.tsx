import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/badge';
import type { DosageResult } from './types';
import { useTranslation } from 'react-i18next';

interface DosageRecommendationCardProps {
  dose: DosageResult;
  showAdjustmentBadge: boolean;
}

// Color only; labels resolved via t('workstation.doseCard.<status>')
const statusClassMap: Record<DosageResult['status'], string> = {
  calculated: 'bg-brand text-white',
  requires_input: 'bg-[#f59e0b] text-white',
  service_unavailable: 'bg-red-600 text-white',
};
const statusKeyMap: Record<DosageResult['status'], string> = {
  calculated: 'workstation.doseCard.calculated',
  requires_input: 'workstation.doseCard.requiresInput',
  service_unavailable: 'workstation.doseCard.serviceUnavailable',
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
  const { t } = useTranslation('pharmacy');
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
    ? 'text-slate-700 dark:text-slate-300'
    : dose.status === 'service_unavailable'
      ? 'text-red-700 dark:text-red-300'
      : 'text-amber-700 dark:text-amber-300';
  const resultBadge = dose.isEquivalentEstimate ? t('workstation.doseCard.equivalentEstimate') : dose.orderTypeLabel || t('workstation.doseCard.continuousInfusion');
  const doseUnitShort = dose.doseUnit?.replace('/kg', '') || '/hr';

  const isModified = minDose !== defaultMin || maxDose !== defaultMax || conc !== defaultConc;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-sm">
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-sm sm:text-base">{dose.drugName}</p>
          <Badge className={statusClassMap[dose.status]}>
            {t(statusKeyMap[dose.status])}
          </Badge>
          <Badge variant="outline" className="text-xs border-slate-400 dark:border-slate-600 text-slate-600 dark:text-slate-400">
            {resultBadge}
          </Badge>
          {showAdjustmentBadge && (
            <Badge variant="outline" className="text-xs border-[#f59e0b] text-[#f59e0b]">
              {t('workstation.doseCard.adjustBadge')}
            </Badge>
          )}
          {isModified && (
            <Badge variant="outline" className="text-xs border-blue-400 text-blue-600">
              {t('workstation.doseCard.modifiedBadge')}
            </Badge>
          )}
        </div>

        {/* Rate range output — primary display */}
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-lg border border-[#ead7e1] bg-[#fdf6fa] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{t('workstation.doseCard.rateRangeLabel')}</p>
            <p className="text-lg font-bold text-brand">
              {rateMin} ~ {rateMax} <span className="text-sm font-normal">{t('workstation.doseCard.rateUnit')}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {dosePerHrMin} ~ {dosePerHrMax} {doseUnitShort}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-3 text-center min-w-[80px]">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{t('workstation.doseCard.weightLabel')}</p>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('workstation.doseCard.weightValue', { value: dosingWt })}</p>
            <p className="text-[10px] text-muted-foreground">{dose.weightBasis || 'TBW'}</p>
          </div>
        </div>

        {/* Three adjustment controls */}
        {canAdjust && (
          <div className="space-y-3 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-3">
            {/* Min dose slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('workstation.doseCard.minDoseLabel', { unit: dose.doseUnit })}</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{minDose.toFixed(decimals)}</span>
              </div>
              <input
                type="range"
                min={defaultMin}
                max={defaultMax}
                step={sliderStep}
                value={minDose}
                onChange={handleMinChange}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-emerald-600 bg-slate-200 dark:bg-slate-700"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{defaultMin}</span>
                <span>{t('workstation.doseCard.rateArrow', { value: calcRate(dosingWt, minDose, conc) })}</span>
              </div>
            </div>

            {/* Max dose slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('workstation.doseCard.maxDoseLabel', { unit: dose.doseUnit })}</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{maxDose.toFixed(decimals)}</span>
              </div>
              <input
                type="range"
                min={defaultMin}
                max={defaultMax}
                step={sliderStep}
                value={maxDose}
                onChange={handleMaxChange}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-brand bg-slate-200 dark:bg-slate-700"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{defaultMin}</span>
                <span>{t('workstation.doseCard.rateArrow', { value: calcRate(dosingWt, maxDose, conc) })}</span>
              </div>
            </div>

            {/* Concentration slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('workstation.doseCard.concentrationLabel', { unit: dose.concentrationUnit || 'mg/ml' })}</span>
                <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{conc}</span>
              </div>
              {(() => {
                const concMin = dose.concentrationRange ? dose.concentrationRange[0] : Math.max(defaultConc * 0.25, 0.1);
                const concMax = dose.concentrationRange ? dose.concentrationRange[1] : defaultConc * 4;
                const concStep = parseFloat(Math.max((concMax - concMin) / 100, 0.01).toPrecision(1));
                return (
                  <>
                    <input
                      type="range"
                      min={concMin}
                      max={concMax}
                      step={concStep}
                      value={conc}
                      onChange={handleConcChange}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-violet-600 bg-slate-200 dark:bg-slate-700"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{concMin}</span>
                      <span>{t('workstation.doseCard.defaultPrefix', { value: defaultConc })}</span>
                      <span>{concMax}</span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Reset button */}
            {isModified && (
              <button
                type="button"
                onClick={() => { setMinDose(defaultMin); setMaxDose(defaultMax); setConc(defaultConc); }}
                className="text-xs text-brand hover:underline"
              >
                {t('workstation.doseCard.resetDefaults')}
              </button>
            )}
          </div>
        )}

        {/* Calculation details */}
        {dose.weightBasis && dose.dosingWeightKg && (
          <p className="text-xs text-muted-foreground">
            {t('workstation.doseCard.weightBasis', { basis: dose.weightBasis, weight: dose.dosingWeightKg })}
          </p>
        )}
        {dose.calculationSteps && dose.calculationSteps.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-slate-600">{t('workstation.doseCard.stepsToggle')}</summary>
            <ol className="mt-1 ml-4 list-decimal space-y-0.5">
              {dose.calculationSteps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
});
