import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, ChevronDown, ChevronRight, Loader2, RotateCcw, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';

import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';
import { maskPatientName } from '../../lib/utils/patient-name';
import { padCalculate, type PadCalculateResult, type PadDrugInfo } from '../../lib/api/pharmacy';
import { type Patient } from '../../lib/api/patients';
import { getCachedPatients, getCachedPatientsSync, subscribePatientsCache } from '../../lib/patients-cache';
import { getCachedPadDrugs, getCachedPadDrugsSync } from '../../lib/pad-drugs-cache';
import { normalizePatientGender } from '../../lib/patient-gender';

type CalculatorMode = 'standalone' | 'patient';

interface PadDosageCalculatorProps {
  mode?: CalculatorMode;
  patient?: Patient | null;
  allowPatientSelect?: boolean;
  allowManualAnthropometrics?: boolean;
}

/** Parse dose_range like "0.03-0.6" or "0.03\u20130.6" into [0.03, 0.6]. */
function parseDoseRange(range?: string): [number, number] | null {
  if (!range) return null;
  const parts = range.split(/[\u2013-]/);
  if (parts.length !== 2) return null;
  const lo = parseFloat(parts[0]);
  const hi = parseFloat(parts[1]);
  if (isNaN(lo) || isNaN(hi)) return null;
  return [lo, hi];
}

function numericString(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

export function PadDosageCalculator({
  mode = 'standalone',
  patient,
  allowPatientSelect = mode === 'standalone',
  allowManualAnthropometrics = true,
}: PadDosageCalculatorProps) {
  const { t } = useTranslation('pharmacy');

  const [padDrugs, setPadDrugs] = useState<PadDrugInfo[]>(getCachedPadDrugsSync() ?? []);
  const [drugsLoading, setDrugsLoading] = useState(!getCachedPadDrugsSync());

  const [patients, setPatients] = useState<Patient[]>(allowPatientSelect ? (getCachedPatientsSync() ?? []) : []);
  const [patientsLoading, setPatientsLoading] = useState(allowPatientSelect && !getCachedPatientsSync());
  const [selectedPatientId, setSelectedPatientId] = useState(patient?.id ?? '');

  const [selectedDrug, setSelectedDrug] = useState('');
  const [weight, setWeight] = useState(numericString(patient?.weight));
  const [targetDoseMin, setTargetDoseMin] = useState('');
  const [targetDoseMax, setTargetDoseMax] = useState('');
  const [concentration, setConcentration] = useState('');
  const [sex, setSex] = useState(normalizePatientGender(patient?.gender) ?? 'none');
  const [height, setHeight] = useState(numericString(patient?.height));

  const [resultMin, setResultMin] = useState<PadCalculateResult | null>(null);
  const [resultMax, setResultMax] = useState<PadCalculateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  const drugInfo = padDrugs.find(d => d.key === selectedDrug);
  const isFixedDose = drugInfo?.weight_basis === 'fixed';
  const doseRange = useMemo(() => parseDoseRange(drugInfo?.dose_range), [drugInfo]);
  const targetDoseMinNum = targetDoseMin ? parseFloat(targetDoseMin) : NaN;
  const targetDoseMaxNum = targetDoseMax ? parseFloat(targetDoseMax) : NaN;
  const missingWeightAdjustmentFields = !isFixedDose && selectedDrug && (!height || sex === 'none');

  const isDoseMinOutOfRange = doseRange && !isNaN(targetDoseMinNum) && targetDoseMinNum > 0 &&
    (targetDoseMinNum < doseRange[0] || targetDoseMinNum > doseRange[1]);
  const isDoseMaxOutOfRange = doseRange && !isNaN(targetDoseMaxNum) && targetDoseMaxNum > 0 &&
    (targetDoseMaxNum < doseRange[0] || targetDoseMaxNum > doseRange[1]);

  const doseStep = useMemo(() => {
    if (!doseRange) return 0.01;
    const minVal = doseRange[0];
    if (minVal >= 1) return 0.1;
    if (minVal >= 0.1) return 0.01;
    return 0.001;
  }, [doseRange]);

  const isConcentrationChanged = drugInfo &&
    concentration !== '' &&
    (() => {
      const val = parseFloat(concentration);
      if (drugInfo.concentration_range) {
        return val < drugInfo.concentration_range[0] || val > drugInfo.concentration_range[1];
      }
      return val !== drugInfo.concentration;
    })();

  const applyPatientAnthropometrics = useCallback((nextPatient: Patient) => {
    setHeight(numericString(nextPatient.height));
    setWeight(numericString(nextPatient.weight));
    setSex(normalizePatientGender(nextPatient.gender) ?? 'none');
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!getCachedPadDrugsSync()) {
      getCachedPadDrugs()
        .then(drugs => {
          if (!cancelled) {
            setPadDrugs(drugs);
            setDrugsLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) setDrugsLoading(false);
        });
    }

    if (allowPatientSelect && !getCachedPatientsSync()) {
      getCachedPatients()
        .then(data => {
          if (!cancelled) {
            setPatients(data);
            setPatientsLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            toast.error(t('common.patientLoadError'));
            setPatientsLoading(false);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [allowPatientSelect, t]);

  useEffect(() => {
    if (!allowPatientSelect) return undefined;
    return subscribePatientsCache((nextPatients) => {
      setPatients(nextPatients);
      setPatientsLoading(false);
    });
  }, [allowPatientSelect]);

  useEffect(() => {
    if (!patient || allowPatientSelect) return;
    setSelectedPatientId(patient.id);
    applyPatientAnthropometrics(patient);
    setResultMin(null);
    setResultMax(null);
    setStepsOpen(false);
  }, [allowPatientSelect, applyPatientAnthropometrics, patient]);

  const handleDoseMinBlur = useCallback(() => {
    if (!doseRange || !targetDoseMin) return;
    const val = parseFloat(targetDoseMin);
    if (isNaN(val)) return;
    const clamped = Math.min(Math.max(val, doseRange[0]), doseRange[1]);
    if (clamped !== val) setTargetDoseMin(String(clamped));
  }, [doseRange, targetDoseMin]);

  const handleDoseMaxBlur = useCallback(() => {
    if (!doseRange || !targetDoseMax) return;
    const val = parseFloat(targetDoseMax);
    if (isNaN(val)) return;
    const clamped = Math.min(Math.max(val, doseRange[0]), doseRange[1]);
    if (clamped !== val) setTargetDoseMax(String(clamped));
  }, [doseRange, targetDoseMax]);

  const clearResults = useCallback(() => {
    setResultMin(null);
    setResultMax(null);
    setStepsOpen(false);
  }, []);

  const handleDrugChange = useCallback((drugKey: string) => {
    setSelectedDrug(drugKey);
    clearResults();
    const info = padDrugs.find(d => d.key === drugKey);
    if (info) {
      setConcentration(String(info.concentration));
      const range = parseDoseRange(info.dose_range);
      if (range) {
        setTargetDoseMin(String(range[0]));
        setTargetDoseMax(String(range[1]));
      } else {
        setTargetDoseMin('');
        setTargetDoseMax('');
      }
    } else {
      setTargetDoseMin('');
      setTargetDoseMax('');
    }
  }, [clearResults, padDrugs]);

  const handlePatientSelect = useCallback((patientId: string) => {
    setSelectedPatientId(patientId);
    clearResults();
    if (!patientId) return;
    const selectedPatient = patients.find(pt => pt.id === patientId);
    if (selectedPatient) {
      applyPatientAnthropometrics(selectedPatient);
      toast.success(t('dosage.patient.filledFromPatient', { name: maskPatientName(selectedPatient.name) }));
    }
  }, [applyPatientAnthropometrics, clearResults, patients, t]);

  const handleClearPatient = useCallback(() => {
    setSelectedPatientId('');
    clearResults();
  }, [clearResults]);

  const handleReset = useCallback(() => {
    setSelectedDrug('');
    setTargetDoseMin('');
    setTargetDoseMax('');
    setConcentration('');
    if (patient && !allowPatientSelect) {
      setSelectedPatientId(patient.id);
      applyPatientAnthropometrics(patient);
    } else {
      setWeight('');
      setSex('none');
      setHeight('');
      setSelectedPatientId('');
    }
    clearResults();
  }, [allowPatientSelect, applyPatientAnthropometrics, clearResults, patient]);

  const handleCalculate = async () => {
    if (!selectedDrug) {
      toast.error(t('dosage.validation.noDrug'));
      return;
    }
    if (!weight || parseFloat(weight) <= 0) {
      toast.error(t('dosage.validation.noWeight'));
      return;
    }
    if (!isFixedDose && (!targetDoseMin || parseFloat(targetDoseMin) < 0)) {
      toast.error(t('dosage.validation.noMinDose'));
      return;
    }
    if (!isFixedDose && (!targetDoseMax || parseFloat(targetDoseMax) < 0)) {
      toast.error(t('dosage.validation.noMaxDose'));
      return;
    }
    if (!isFixedDose && (!concentration || parseFloat(concentration) <= 0)) {
      toast.error(t('dosage.validation.noConcentration'));
      return;
    }

    setLoading(true);
    try {
      let clampedMin = parseFloat(targetDoseMin);
      let clampedMax = parseFloat(targetDoseMax);
      if (!isFixedDose && doseRange) {
        clampedMin = Math.max(clampedMin, doseRange[0]);
        clampedMax = Math.min(clampedMax, doseRange[1]);
        setTargetDoseMin(String(clampedMin));
        setTargetDoseMax(String(clampedMax));
      }

      const common = {
        drug: selectedDrug,
        weight_kg: parseFloat(weight),
        concentration: isFixedDose ? (drugInfo?.concentration || 1) : parseFloat(concentration),
        sex: sex !== 'none' ? sex : undefined,
        height_cm: height ? parseFloat(height) : undefined,
      };

      if (isFixedDose) {
        const res = await padCalculate({ ...common, target_dose_per_kg_hr: 0 });
        setResultMin(res);
        setResultMax(null);
      } else {
        const [resMin, resMax] = await Promise.all([
          padCalculate({ ...common, target_dose_per_kg_hr: clampedMin }),
          padCalculate({ ...common, target_dose_per_kg_hr: clampedMax }),
        ]);
        setResultMin(resMin);
        setResultMax(resMax);
      }
      setStepsOpen(false);
    } catch (err) {
      console.error(`${t('dosage.validation.calcFailedLog')}:`, err);
      if (isAxiosError(err)) {
        const msg = String((err.response?.data as Record<string, unknown>)?.message || '');
        toast.error(msg || t('dosage.validation.calcFailedFallback'));
      } else {
        toast.error(t('dosage.validation.calcFailedFallback'));
      }
    } finally {
      setLoading(false);
    }
  };

  const doseUnitShort = drugInfo?.dose_unit?.replace('/kg/hr', '/hr') || '/hr';
  const inputClassName = `h-9 ${allowManualAnthropometrics ? '' : 'bg-muted/50'}`;
  const selectedPatient = patient ?? patients.find(item => item.id === selectedPatientId);
  const shouldShowPatientSelector = allowPatientSelect;
  const hasInput = selectedDrug || weight || targetDoseMin || targetDoseMax || concentration || sex !== 'none' || height || selectedPatientId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('dosage.card.title')}</CardTitle>
        <CardDescription className="text-xs">
          {mode === 'patient' ? t('dosage.card.patientDescription') : t('dosage.card.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          {shouldShowPatientSelector ? (
            <div className="space-y-1">
              <label className="text-xs font-medium">
                <User className="inline h-3 w-3 mr-0.5" />{t('dosage.patient.label')}
              </label>
              <div className="flex gap-1">
                <Select value={selectedPatientId} onValueChange={handlePatientSelect} disabled={patientsLoading}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={patientsLoading ? t('dosage.patient.placeholderLoading') : t('dosage.patient.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {t('common.patientOption', { bed: p.bedNumber, name: maskPatientName(p.name), mrn: p.medicalRecordNumber })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPatientId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={handleClearPatient}
                    aria-label={t('dosage.patient.clear')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs font-medium">
                <User className="inline h-3 w-3 mr-0.5" />{t('dosage.patient.current')}
              </label>
              <div className="h-9 rounded-md border bg-muted/30 px-3 text-sm flex items-center truncate">
                {selectedPatient
                  ? t('common.patientOption', {
                      bed: selectedPatient.bedNumber,
                      name: maskPatientName(selectedPatient.name),
                      mrn: selectedPatient.medicalRecordNumber,
                    })
                  : t('dosage.patient.noPatient')}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium">{t('dosage.drug.label')}</label>
            <Select value={selectedDrug} onValueChange={handleDrugChange} disabled={drugsLoading}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={drugsLoading ? t('dosage.drug.placeholderLoading') : t('dosage.drug.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {padDrugs.map(d => (
                  <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">{t('dosage.weight.label')}</label>
            <Input
              type="number"
              step="any"
              className={inputClassName}
              placeholder={allowManualAnthropometrics ? t('dosage.weight.manualPlaceholder') : t('dosage.weight.placeholder')}
              value={weight}
              readOnly={!allowManualAnthropometrics}
              tabIndex={allowManualAnthropometrics ? undefined : -1}
              onChange={(event) => {
                setWeight(event.target.value);
                clearResults();
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">{t('dosage.sex.label')}</label>
            <Select
              value={sex || 'none'}
              onValueChange={(value) => {
                setSex(value);
                clearResults();
              }}
              disabled={!allowManualAnthropometrics}
            >
              <SelectTrigger className={inputClassName}>
                <SelectValue placeholder={t('dosage.sex.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('dosage.sex.none')}</SelectItem>
                <SelectItem value="male">{t('dosage.sex.male')}</SelectItem>
                <SelectItem value="female">{t('dosage.sex.female')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {drugInfo && !isFixedDose && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md text-xs overflow-x-auto">
            <Badge variant="outline" className="text-xs px-1.5 py-0 shrink-0">{drugInfo.label}</Badge>
            <span className="text-muted-foreground shrink-0">{t('dosage.info.rangeLabel')}</span>
            <span className="font-medium shrink-0">{drugInfo.dose_range} {drugInfo.dose_unit}</span>
            <span className="text-muted-foreground mx-1 shrink-0">|</span>
            <span className="text-muted-foreground shrink-0">{drugInfo.concentration_range ? t('dosage.info.concAllowedLabel') : t('dosage.info.concDefaultLabel')}</span>
            <span className="font-medium shrink-0">{drugInfo.concentration_range ? `${drugInfo.concentration_range[0]}-${drugInfo.concentration_range[1]}` : drugInfo.concentration} {drugInfo.concentration_unit}</span>
            <span className="text-muted-foreground mx-1 shrink-0">|</span>
            <span className="text-muted-foreground shrink-0">{t('dosage.info.obeseBasisLabel')}</span>
            <span className="font-medium shrink-0">{drugInfo.weight_basis}</span>
            {resultMin && (
              <>
                <span className="text-muted-foreground mx-1 shrink-0">|</span>
                <span className="text-muted-foreground shrink-0">{t('dosage.info.thisCalcBasisLabel')}</span>
                <span className="font-medium shrink-0">{resultMin.weight_basis}</span>
              </>
            )}
          </div>
        )}

        {missingWeightAdjustmentFields && (
          <Alert className="py-2 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            <AlertDescription className="text-xs leading-relaxed">
              {t('dosage.info.tbwFallbackHint')}
            </AlertDescription>
          </Alert>
        )}

        {isFixedDose && drugInfo && (
          <Alert className="py-2">
            <AlertDescription className="text-xs leading-relaxed">
              {t('dosage.fixedAlert', { label: drugInfo.label, range: drugInfo.dose_range })}
            </AlertDescription>
          </Alert>
        )}

        {!isFixedDose && (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t('dosage.doseMin.label')}
                {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-xs">({drugInfo.dose_unit})</span>}
              </label>
              <Input
                type="number"
                step={doseStep}
                className={`h-9 ${isDoseMinOutOfRange ? 'border-red-500 dark:border-red-400 border-2 focus-visible:ring-red-500' : ''}`}
                min={doseRange ? doseRange[0] : undefined}
                max={doseRange ? doseRange[1] : undefined}
                placeholder={doseRange ? String(doseRange[0]) : ''}
                value={targetDoseMin}
                onChange={(event) => {
                  setTargetDoseMin(event.target.value);
                  clearResults();
                }}
                onBlur={handleDoseMinBlur}
              />
              {doseRange && (
                <p className="text-xs text-muted-foreground">{t('dosage.doseMin.rangeHint', { lo: doseRange[0], hi: doseRange[1] })}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t('dosage.doseMax.label')}
                {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-xs">({drugInfo.dose_unit})</span>}
              </label>
              <Input
                type="number"
                step={doseStep}
                className={`h-9 ${isDoseMaxOutOfRange ? 'border-red-500 dark:border-red-400 border-2 focus-visible:ring-red-500' : ''}`}
                min={doseRange ? doseRange[0] : undefined}
                max={doseRange ? doseRange[1] : undefined}
                placeholder={doseRange ? String(doseRange[1]) : ''}
                value={targetDoseMax}
                onChange={(event) => {
                  setTargetDoseMax(event.target.value);
                  clearResults();
                }}
                onBlur={handleDoseMaxBlur}
              />
              {doseRange && (
                <p className="text-xs text-muted-foreground">{t('dosage.doseMax.rangeHint', { lo: doseRange[0], hi: doseRange[1] })}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t('dosage.concentration.label')}
                {drugInfo && <span className="text-muted-foreground font-normal ml-0.5 text-xs">({drugInfo.concentration_unit})</span>}
              </label>
              <Input
                type="number"
                step="any"
                className={`h-9 ${isConcentrationChanged ? 'border-red-500 dark:border-red-400 border-2 focus-visible:ring-red-500' : ''}`}
                placeholder={drugInfo ? String(drugInfo.concentration) : ''}
                value={concentration}
                onChange={(event) => {
                  setConcentration(event.target.value);
                  clearResults();
                }}
              />
              {isConcentrationChanged && drugInfo && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {drugInfo.concentration_range
                    ? t('dosage.concentration.outOfRange', { lo: drugInfo.concentration_range[0], hi: drugInfo.concentration_range[1], unit: drugInfo.concentration_unit })
                    : t('dosage.concentration.differentDefault', { value: drugInfo.concentration, unit: drugInfo.concentration_unit })}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{t('dosage.height.label')}</label>
              <Input
                type="number"
                step="any"
                className={inputClassName}
                placeholder={allowManualAnthropometrics ? t('dosage.height.manualPlaceholder') : t('dosage.height.placeholder')}
                value={height}
                readOnly={!allowManualAnthropometrics}
                tabIndex={allowManualAnthropometrics ? undefined : -1}
                onChange={(event) => {
                  setHeight(event.target.value);
                  clearResults();
                }}
              />
            </div>
          </div>
        )}

        {isFixedDose && (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('dosage.height.label')}</label>
              <Input
                type="number"
                step="any"
                className={inputClassName}
                placeholder={allowManualAnthropometrics ? t('dosage.height.manualPlaceholder') : t('dosage.height.placeholder')}
                value={height}
                readOnly={!allowManualAnthropometrics}
                tabIndex={allowManualAnthropometrics ? undefined : -1}
                onChange={(event) => {
                  setHeight(event.target.value);
                  clearResults();
                }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleCalculate} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Calculator className="mr-1.5 h-3.5 w-3.5" />}
            {t('dosage.buttons.calculate')}
          </Button>
          {hasInput && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />{t('dosage.buttons.reset')}
            </Button>
          )}
        </div>

        {loading && (
          <div className="text-center py-6">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-brand" />
            <p className="text-xs text-muted-foreground">{t('dosage.result.calculating')}</p>
          </div>
        )}

        {resultMin && (
          <>
            <Separator />

            {resultMin.note && resultMin.rate_ml_hr === 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{drugInfo?.label || resultMin.drug}</span>
                  <Badge variant="secondary" className="text-xs">{t('dosage.result.fixedDoseBadge')}</Badge>
                </div>
                <Alert className="py-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <AlertDescription className="text-xs leading-relaxed">{resultMin.note}</AlertDescription>
                </Alert>
                {resultMin.steps.length > 0 && (
                  <p className="text-xs text-muted-foreground">{resultMin.steps[0]}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{drugInfo?.label || resultMin.drug}</span>
                  <Badge variant="outline" className="text-xs px-1.5 py-0">{resultMin.weight_basis}</Badge>
                </div>

                <div className="flex items-stretch gap-0 rounded-lg overflow-hidden border border-brand/20">
                  <div className="flex-1 px-4 py-3 bg-brand/10 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight mb-1">{resultMax ? t('dosage.result.rateMin') : t('dosage.result.rate')}</p>
                    <p className="text-3xl font-bold text-brand leading-none">{resultMin.rate_ml_hr}</p>
                    <p className="text-xs font-medium text-brand/70 mt-0.5">{t('dosage.result.rateUnit')}</p>
                  </div>
                  {resultMax && (
                    <>
                      <div className="flex items-center bg-brand/5 px-2">
                        <span className="text-xl text-brand/40 font-light">&rarr;</span>
                      </div>
                      <div className="flex-1 px-4 py-3 bg-brand/10 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight mb-1">{t('dosage.result.rateMax')}</p>
                        <p className="text-3xl font-bold text-brand leading-none">{resultMax.rate_ml_hr}</p>
                        <p className="text-xs font-medium text-brand/70 mt-0.5">{t('dosage.result.rateUnit')}</p>
                      </div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs bg-muted/30 rounded-md px-3 py-2">
                  <div>
                    <span className="text-muted-foreground">{t('dosage.result.secondaryDoseLabel')}</span>
                    <p className="font-semibold">{t('dosage.result.weightWithUnit', { value: resultMin.dosing_weight_kg })}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('dosage.result.secondaryHourlyLabel')}</span>
                    <p className="font-semibold">
                      {resultMin.dose_per_hr}{resultMax ? ` - ${resultMax.dose_per_hr}` : ''} {doseUnitShort}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('dosage.result.secondaryConcentrationLabel')}</span>
                    <p className="font-semibold">{resultMin.concentration}</p>
                  </div>
                </div>

                {resultMin.BMI != null && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs px-1">
                    <span><span className="text-muted-foreground">BMI</span> <span className="font-medium">{resultMin.BMI}</span></span>
                    {resultMin.weight_basis.includes('IBW') && !resultMin.weight_basis.includes('Adj') && (
                      <span><span className="text-muted-foreground">{t('dosage.result.ibwLabel')}</span> <span className="font-medium">{t('dosage.result.weightWithUnit', { value: resultMin.IBW_kg })}</span></span>
                    )}
                    {resultMin.weight_basis.includes('AdjBW') && (
                      <span><span className="text-muted-foreground">{t('dosage.result.adjBwLabel')}</span> <span className="font-medium">{t('dosage.result.weightWithUnit', { value: resultMin.AdjBW_kg })}</span></span>
                    )}
                    <span>
                      <span className="text-muted-foreground">{t('dosage.result.pctIbwLabel')}</span>{' '}
                      <span className="font-medium">{resultMin.pct_IBW}%</span>
                      {resultMin.is_obese && <Badge variant="destructive" className="ml-1 text-xs px-1 py-0">{t('dosage.result.weightObese')}</Badge>}
                      {!resultMin.is_obese && resultMin.pct_IBW != null && resultMin.pct_IBW < 90 && (
                        <Badge className="ml-1 text-xs px-1 py-0 bg-amber-500 hover:bg-amber-600">{t('dosage.result.weightUnderweight')}</Badge>
                      )}
                    </span>
                  </div>
                )}

                {resultMin.steps.length > 0 && (
                  <div>
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setStepsOpen(!stepsOpen)}
                    >
                      {stepsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {t('dosage.result.stepsToggle')}
                    </button>
                    {stepsOpen && (
                      <ol className="list-decimal list-inside space-y-0.5 text-xs text-muted-foreground mt-1.5 pl-1">
                        {resultMin.steps.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                {resultMin.note && (
                  <div className="flex items-start gap-1.5 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{resultMin.note}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
