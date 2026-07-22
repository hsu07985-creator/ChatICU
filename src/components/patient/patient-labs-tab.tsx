import { Activity, Bug, FileText, Flame, Plus, Stethoscope, TestTube, Wind } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LabData, VitalSigns, VentilatorSettings, WeaningAssessment } from '../../lib/api';
import { createVitalSigns, type VitalSignsInput } from '../../lib/api/vital-signs';
import {
  createVentilatorSettings,
  createWeaningAssessment,
  type VentilatorInput,
  type WeaningAssessmentInput,
} from '../../lib/api/ventilator';
import { LabDataDisplay } from '../lab-data-display';
import { InflammationIndicesPanel } from '../lab-data-display/InflammationIndicesPanel';
import { PatientDiagnosticReports } from './patient-diagnostic-reports';
import { PatientMicrobiologyCard } from './patient-microbiology-card';
import { VitalSignCard } from '../vital-signs-card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { LoadingSpinner } from '../ui/state-display';
import { TabsContent } from '../ui/tabs';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { DataOwnershipBadge, DataOwnershipLegend, type DataOwnership } from './data-ownership-badge';

type TrendSource = 'vital' | 'ventilator';

interface PatientLabsTabProps {
  patientId: string;
  patientIntubated: boolean;
  labData: LabData;
  vitalSignsLoading: boolean;
  vitalSignsTimestamp?: string | null;
  respiratoryRate?: number | null;
  temperature?: number | null;
  systolicBP?: number | null;
  diastolicBP?: number | null;
  heartRate?: number | null;
  spo2?: number | null;
  cvp?: number | null;
  icp?: number | null;
  cpp?: number | null;
  etco2?: number | null;
  bodyWeight?: number | null;
  bodyHeight?: number | null;
  ventilatorLoading: boolean;
  ventTimestamp?: string | null;
  ventMode?: unknown;
  ventFiO2?: number | null;
  ventPeep?: number | null;
  ventTidalVolume?: number | null;
  ventRespRate?: number | null;
  ventPip?: number | null;
  ventPlateau?: number | null;
  ventCompliance?: number | null;
  ventInspiratoryPressure?: number | null;
  ventPressureSupport?: number | null;
  ventIeRatio?: string | null;
  ventResistance?: number | null;
  weaningAssessment?: WeaningAssessment | null;
  formatDisplayTimestamp: (timestamp?: string | null) => string;
  formatDisplayValue: (value: unknown) => string;
  onVitalSignClick: (labName: string, value: number, unit: string, source: TrendSource) => void;
  isAdmin?: boolean;
  canEditWeaning?: boolean;
  onVitalSignsUpdate?: (vs: VitalSigns) => void;
  onVentilatorUpdate?: (v: VentilatorSettings) => void;
  onWeaningAssessmentUpdate?: (assessment: WeaningAssessment) => void;
}

const metricGridStyle = {
  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
  gap: '8px',
} as const;

const VALID_LABS_SECTIONS = new Set(['lab-data', 'microbiology', 'reports', 'inflammation']);
const VALID_MONITOR_SECTIONS = new Set(['vital-signs', 'ventilator']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function vitalDirection(value: number | null | undefined, low: number, high: number): 'high' | 'low' | 'normal' {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'normal';
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'normal';
}

export function PatientLabsTab({
  patientId,
  patientIntubated,
  labData,
  vitalSignsLoading,
  vitalSignsTimestamp,
  respiratoryRate,
  temperature,
  systolicBP,
  diastolicBP,
  heartRate,
  spo2,
  cvp,
  icp,
  cpp,
  etco2,
  bodyWeight,
  bodyHeight,
  ventilatorLoading,
  ventTimestamp,
  ventMode,
  ventFiO2,
  ventPeep,
  ventTidalVolume,
  ventRespRate,
  ventPip,
  ventPlateau,
  ventCompliance,
  ventInspiratoryPressure,
  ventPressureSupport,
  ventIeRatio,
  ventResistance,
  weaningAssessment,
  formatDisplayTimestamp,
  formatDisplayValue,
  onVitalSignClick,
  isAdmin = false,
  canEditWeaning = false,
  onVitalSignsUpdate,
  onVentilatorUpdate,
  onWeaningAssessmentUpdate,
}: PatientLabsTabProps) {
  const { t, i18n } = useTranslation('patient-tabs');
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSection = searchParams.get('section');

  // 手動輸入 dialog 狀態
  const [isVitalDialogOpen, setIsVitalDialogOpen] = useState(false);
  const [isVentDialogOpen, setIsVentDialogOpen] = useState(false);
  const [isWeaningDialogOpen, setIsWeaningDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [vitalForm, setVitalForm] = useState<Record<string, string>>({});
  const [ventForm, setVentForm] = useState<Record<string, string>>({});
  const [weaningForm, setWeaningForm] = useState<Record<string, string>>({});

  const parseNum = (v: string): number | null => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const handleVitalSubmit = async () => {
    setIsSubmitting(true);
    try {
      const data: VitalSignsInput = {
        spo2: parseNum(vitalForm.spo2 ?? ''),
        cvp: parseNum(vitalForm.cvp ?? ''),
        icp: parseNum(vitalForm.icp ?? ''),
        cpp: parseNum(vitalForm.cpp ?? ''),
        etco2: parseNum(vitalForm.etco2 ?? ''),
      };
      const result = await createVitalSigns(patientId, data);
      onVitalSignsUpdate?.(result);
      setIsVitalDialogOpen(false);
      setVitalForm({});
      toast.success(t('labs.vitalDialog.saveSuccess'));
    } catch {
      toast.error(t('labs.vitalDialog.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVentSubmit = async () => {
    setIsSubmitting(true);
    try {
      const data: VentilatorInput = {
        mode: ventForm.mode || null,
        fio2: parseNum(ventForm.fio2 ?? ''),
        peep: parseNum(ventForm.peep ?? ''),
        tidal_volume: parseNum(ventForm.tidal_volume ?? ''),
        respiratory_rate: parseNum(ventForm.respiratory_rate ?? ''),
        pip: parseNum(ventForm.pip ?? ''),
        plateau: parseNum(ventForm.plateau ?? ''),
        compliance: parseNum(ventForm.compliance ?? ''),
        inspiratory_pressure: parseNum(ventForm.inspiratory_pressure ?? ''),
        pressure_support: parseNum(ventForm.pressure_support ?? ''),
        ie_ratio: ventForm.ie_ratio || null,
        resistance: parseNum(ventForm.resistance ?? ''),
      };
      const result = await createVentilatorSettings(patientId, data);
      onVentilatorUpdate?.(result);
      setIsVentDialogOpen(false);
      setVentForm({});
      toast.success(t('labs.ventDialog.saveSuccess'));
    } catch {
      toast.error(t('labs.ventDialog.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWeaningSubmit = async () => {
    setIsSubmitting(true);
    try {
      const stability = weaningForm.hemodynamicStability;
      const data: WeaningAssessmentInput = {
        rsbi: parseNum(weaningForm.rsbi ?? ''),
        nif: parseNum(weaningForm.nif ?? ''),
        vt: parseNum(weaningForm.vt ?? ''),
        rr: parseNum(weaningForm.rr ?? ''),
        spo2: parseNum(weaningForm.spo2 ?? ''),
        fio2: parseNum(weaningForm.fio2 ?? ''),
        peep: parseNum(weaningForm.peep ?? ''),
        gcs: parseNum(weaningForm.gcs ?? ''),
        coughStrength: weaningForm.coughStrength || null,
        secretions: weaningForm.secretions || null,
        hemodynamicStability: stability === '' || stability === undefined ? null : stability === 'true',
        recommendation: weaningForm.recommendation || null,
        readinessScore: parseNum(weaningForm.readinessScore ?? ''),
      };
      const result = await createWeaningAssessment(patientId, data);
      onWeaningAssessmentUpdate?.(result);
      setIsWeaningDialogOpen(false);
      setWeaningForm({});
      toast.success(t('labs.weaningDialog.saveSuccess'));
    } catch {
      toast.error(t('labs.weaningDialog.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };
  const activeSection = rawSection && VALID_LABS_SECTIONS.has(rawSection) ? rawSection : 'lab-data';
  const rawMonitor = searchParams.get('monitor');
  const activeMonitor = rawMonitor && VALID_MONITOR_SECTIONS.has(rawMonitor) ? rawMonitor : 'vital-signs';
  const map = isFiniteNumber(systolicBP) && isFiniteNumber(diastolicBP)
    ? Math.round((systolicBP + 2 * diastolicBP) / 3)
    : null;
  const hasAnyVitalSign = [temperature, heartRate, respiratoryRate, systolicBP, diastolicBP, spo2, cvp, icp, cpp, etco2, bodyWeight, bodyHeight].some(isFiniteNumber);
  const [monitorOnlyAbnormal, setMonitorOnlyAbnormal] = useState(false);
  const [monitorHideMissing, setMonitorHideMissing] = useState(false);

  interface VitalItem {
    label: string; value: number | string | null | undefined; unit: string;
    isAbnormal: boolean; abnormalDirection: 'high' | 'low' | 'normal';
    clickName: string; source: TrendSource; timestamp: string | undefined;
    ownership: DataOwnership;
  }

  const vitalItems: VitalItem[] = useMemo(() => [
    { label: 'Temp', value: temperature, unit: '°C', isAbnormal: isFiniteNumber(temperature) && (temperature > 37.5 || temperature < 36), abnormalDirection: vitalDirection(temperature, 36, 37.5), clickName: 'Temperature', source: 'vital' as TrendSource, timestamp: vitalSignsTimestamp || undefined, ownership: 'auto' },
    { label: 'HR', value: heartRate, unit: 'bpm', isAbnormal: isFiniteNumber(heartRate) && (heartRate > 100 || heartRate < 60), abnormalDirection: vitalDirection(heartRate, 60, 100), clickName: 'HeartRate', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'auto' },
    { label: 'RR', value: respiratoryRate, unit: 'rpm', isAbnormal: isFiniteNumber(respiratoryRate) && (respiratoryRate > 25 || respiratoryRate < 12), abnormalDirection: vitalDirection(respiratoryRate, 12, 25), clickName: 'RespiratoryRate', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'auto' },
    { label: 'SBP', value: systolicBP, unit: 'mmHg', isAbnormal: isFiniteNumber(systolicBP) && (systolicBP > 140 || systolicBP < 90), abnormalDirection: vitalDirection(systolicBP, 90, 140), clickName: 'BloodPressureSystolic', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'auto' },
    { label: 'DBP', value: diastolicBP, unit: 'mmHg', isAbnormal: isFiniteNumber(diastolicBP) && (diastolicBP > 90 || diastolicBP < 60), abnormalDirection: vitalDirection(diastolicBP, 60, 90), clickName: 'BloodPressureDiastolic', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'auto' },
    { label: 'MAP', value: map, unit: 'mmHg', isAbnormal: isFiniteNumber(map) && (map > 110 || map < 65), abnormalDirection: vitalDirection(map, 65, 110), clickName: 'MAP', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'auto' },
    { label: 'SpO₂', value: spo2, unit: '%', isAbnormal: isFiniteNumber(spo2) && spo2 < 94, abnormalDirection: vitalDirection(spo2, 94, Infinity), clickName: 'SpO2', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'manual' },
    { label: 'EtCO₂', value: etco2, unit: 'mmHg', isAbnormal: false, abnormalDirection: 'normal', clickName: 'EtCO2', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'manual' },
    { label: 'CVP', value: cvp, unit: 'mmHg', isAbnormal: isFiniteNumber(cvp) && (cvp > 12 || cvp < 2), abnormalDirection: vitalDirection(cvp, 2, 12), clickName: 'CVP', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'manual' },
    { label: 'ICP', value: icp, unit: 'mmHg', isAbnormal: isFiniteNumber(icp) && icp > 20, abnormalDirection: vitalDirection(icp, -Infinity, 20), clickName: 'ICP', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'manual' },
    { label: 'CPP', value: cpp, unit: 'mmHg', isAbnormal: false, abnormalDirection: 'normal', clickName: 'CPP', source: 'vital', timestamp: vitalSignsTimestamp || undefined, ownership: 'manual' },
    { label: 'BW', value: bodyWeight, unit: 'kg', isAbnormal: false, abnormalDirection: 'normal' as const, clickName: 'BodyWeight', source: 'vital' as TrendSource, timestamp: vitalSignsTimestamp || undefined, ownership: 'auto' },
    { label: 'BH', value: bodyHeight, unit: 'cm', isAbnormal: false, abnormalDirection: 'normal' as const, clickName: 'BodyHeight', source: 'vital' as TrendSource, timestamp: undefined, ownership: 'auto' },
  ], [temperature, heartRate, respiratoryRate, systolicBP, diastolicBP, map, spo2, etco2, cvp, icp, cpp, bodyWeight, bodyHeight, vitalSignsTimestamp]);

  const ventItems: VitalItem[] = useMemo(() => [
    { label: 'Mode', value: typeof ventMode === 'string' ? ventMode : null, unit: '', isAbnormal: false, abnormalDirection: 'normal', clickName: 'Mode', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'FiO₂', value: ventFiO2, unit: '%', isAbnormal: isFiniteNumber(ventFiO2) && ventFiO2 > 60, abnormalDirection: vitalDirection(ventFiO2, -Infinity, 60), clickName: 'FiO2', source: 'ventilator' as TrendSource, timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'PEEP', value: ventPeep, unit: 'cmH₂O', isAbnormal: isFiniteNumber(ventPeep) && ventPeep > 12, abnormalDirection: vitalDirection(ventPeep, -Infinity, 12), clickName: 'PEEP', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'Vt', value: ventTidalVolume, unit: 'mL', isAbnormal: isFiniteNumber(ventTidalVolume) && ventTidalVolume > 500, abnormalDirection: vitalDirection(ventTidalVolume, -Infinity, 500), clickName: 'TidalVolume', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'RR set', value: ventRespRate, unit: '/min', isAbnormal: false, abnormalDirection: 'normal' as const, clickName: 'VentRR', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'PIP', value: ventPip, unit: 'cmH₂O', isAbnormal: isFiniteNumber(ventPip) && ventPip > 30, abnormalDirection: vitalDirection(ventPip, -Infinity, 30), clickName: 'PIP', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'Pplat', value: ventPlateau, unit: 'cmH₂O', isAbnormal: isFiniteNumber(ventPlateau) && ventPlateau > 30, abnormalDirection: vitalDirection(ventPlateau, -Infinity, 30), clickName: 'Plateau', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'Cstat', value: ventCompliance, unit: 'mL/cmH₂O', isAbnormal: isFiniteNumber(ventCompliance) && ventCompliance < 30, abnormalDirection: vitalDirection(ventCompliance, 30, Infinity), clickName: 'Compliance', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'Pinsp', value: ventInspiratoryPressure, unit: 'cmH₂O', isAbnormal: false, abnormalDirection: 'normal', clickName: 'InspiratoryPressure', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'PS', value: ventPressureSupport, unit: 'cmH₂O', isAbnormal: false, abnormalDirection: 'normal', clickName: 'PressureSupport', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'I:E', value: ventIeRatio, unit: '', isAbnormal: false, abnormalDirection: 'normal', clickName: 'IERatio', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
    { label: 'Raw', value: ventResistance, unit: 'cmH₂O/L/s', isAbnormal: false, abnormalDirection: 'normal', clickName: 'Resistance', source: 'ventilator', timestamp: ventTimestamp || undefined, ownership: 'manual' },
  ], [ventMode, ventFiO2, ventPeep, ventTidalVolume, ventRespRate, ventPip, ventPlateau, ventCompliance, ventInspiratoryPressure, ventPressureSupport, ventIeRatio, ventResistance, ventTimestamp]);

  function filterItems(items: VitalItem[]): VitalItem[] {
    return items.filter((item) => {
      if (monitorHideMissing && (item.value === null || item.value === undefined || item.value === '')) return false;
      if (monitorOnlyAbnormal && !item.isAbnormal) return false;
      return true;
    });
  }
  const setActiveSection = useCallback((section: 'lab-data' | 'microbiology' | 'reports' | 'inflammation') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (section === 'lab-data') {
        next.delete('section');
      } else {
        next.set('section', section);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const setActiveMonitor = useCallback((monitor: 'vital-signs' | 'ventilator') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (monitor === 'vital-signs') {
        next.delete('monitor');
      } else {
        next.set('monitor', monitor);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return (
    <TabsContent value="labs" className="space-y-3">
      <DataOwnershipLegend />
      {/* 生命徵象 / 呼吸器 切換按鈕 */}
      <div className="flex justify-start">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-slate-50 dark:bg-slate-800 p-1">
          <button
            type="button"
            className={`flex h-10 min-w-[136px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
              activeMonitor === 'vital-signs'
                ? 'bg-brand text-white shadow-sm'
                : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-brand'
            }`}
            onClick={() => setActiveMonitor('vital-signs')}
            aria-pressed={activeMonitor === 'vital-signs'}
          >
            <Activity className="h-4 w-4" />
            {t('labs.monitor.vitalSigns')}
          </button>
          {patientIntubated && (
            <button
              type="button"
              className={`flex h-10 min-w-[136px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
                activeMonitor === 'ventilator'
                  ? 'bg-brand text-white shadow-sm'
                  : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-brand'
              }`}
              onClick={() => setActiveMonitor('ventilator')}
              aria-pressed={activeMonitor === 'ventilator'}
            >
              <Wind className="h-4 w-4" />
              {t('labs.monitor.ventilator')}
            </button>
          )}
        </div>
      </div>

      {/* 篩選按鈕（生命徵象 & 呼吸器共用） */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              monitorOnlyAbnormal
                ? 'border-brand bg-brand text-white'
                : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-brand/40'
            }`}
            aria-pressed={monitorOnlyAbnormal}
            onClick={() => setMonitorOnlyAbnormal((prev) => !prev)}
          >
            {t('labs.monitor.filterAbnormal')}
          </button>
          <button
            type="button"
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              monitorHideMissing
                ? 'border-brand bg-brand text-white'
                : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-brand/40'
            }`}
            aria-pressed={monitorHideMissing}
            onClick={() => setMonitorHideMissing((prev) => !prev)}
          >
            {t('labs.monitor.filterHideMissing')}
          </button>
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">{t('labs.monitor.filterEfficiency')}</span>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1 text-xs h-7 px-2"
            onClick={() => activeMonitor === 'vital-signs' ? setIsVitalDialogOpen(true) : setIsVentDialogOpen(true)}
          >
            <Plus className="h-3 w-3" />
            {t('labs.monitor.manualInput')}
          </Button>
        )}
      </div>

      {/* 生命徵象 / 呼吸器 內容 */}
      {activeMonitor === 'vital-signs' ? (
        vitalSignsLoading ? (
          <div className="flex items-center justify-center py-4">
            <LoadingSpinner size="md" text={t('labs.monitor.loadingVitals')} />
          </div>
        ) : !hasAnyVitalSign ? (
          <p className="py-2 text-center text-sm text-slate-400 dark:text-slate-500">{t('labs.monitor.noVitals')}</p>
        ) : filterItems(vitalItems).length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('labs.monitor.noFiltered')}
          </div>
        ) : (
          <div className="grid" style={metricGridStyle}>
            {filterItems(vitalItems).map((item) => (
              <VitalSignCard
                key={item.label}
                label={item.label}
                value={item.value}
                unit={item.unit}
                isAbnormal={item.isAbnormal}
                abnormalDirection={item.abnormalDirection}
                onClick={isFiniteNumber(item.value) ? () => onVitalSignClick(item.clickName, item.value as number, item.unit, item.source) : undefined}
                timestamp={item.timestamp}
                ownership={item.ownership}
              />
            ))}
          </div>
        )
      ) : activeMonitor === 'ventilator' && patientIntubated ? (
        ventilatorLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" text={t('labs.monitor.loadingVent')} />
          </div>
        ) : (
          <div className="space-y-3">
            {filterItems(ventItems).length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('labs.monitor.noFiltered')}
              </div>
            ) : (
              <div className="grid" style={metricGridStyle}>
                {filterItems(ventItems).map((item) => (
                  <VitalSignCard
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    unit={item.unit}
                    isAbnormal={item.isAbnormal}
                    abnormalDirection={item.abnormalDirection}
                    onClick={isFiniteNumber(item.value) ? () => onVitalSignClick(item.clickName, item.value as number, item.unit, item.source) : undefined}
                    timestamp={item.timestamp}
                    ownership={item.ownership}
                  />
                ))}
              </div>
            )}

            {/* 脫機評估：尚未串接 HIS，暫時人工補登。 */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/20">
              <div className="flex items-center gap-2">
                <DataOwnershipBadge kind="orphan" />
                {!weaningAssessment && <span className="text-sm text-rose-700 dark:text-rose-300">{t('labs.weaning.empty')}</span>}
              </div>
              {canEditWeaning && (
                <Button size="sm" variant="outline" className="h-8 border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300" onClick={() => setIsWeaningDialogOpen(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('labs.weaning.manualEntry')}
                </Button>
              )}
            </div>
            {weaningAssessment && (
              <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Stethoscope className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    {t('labs.weaning.title')} <DataOwnershipBadge kind="orphan" />
                  </CardTitle>
                  <CardDescription>
                    {t('labs.weaning.evaluatedAt', { timestamp: weaningAssessment.timestamp ? new Date(weaningAssessment.timestamp).toLocaleString(i18n.language) : '-' })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4 mb-4">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">{t('labs.weaning.rsbi')}</p>
                      <p className={`text-2xl font-bold ${weaningAssessment.rsbi !== null && weaningAssessment.rsbi > 105 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {formatDisplayValue(weaningAssessment.rsbi)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">{t('labs.weaning.nif')}</p>
                      <p className={`text-2xl font-bold ${weaningAssessment.nif !== null && weaningAssessment.nif > -25 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {weaningAssessment.nif === null ? '-' : t('labs.weaning.nifValue', { value: weaningAssessment.nif })}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">{t('labs.weaning.readiness')}</p>
                      <p className={`text-2xl font-bold ${weaningAssessment.readinessScore !== null && weaningAssessment.readinessScore >= 70 ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        {weaningAssessment.readinessScore === null ? '-' : `${weaningAssessment.readinessScore}%`}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">{t('labs.weaning.recommendation')}</p>
                      <Badge className={weaningAssessment.recommendation?.includes('可以') ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300'}>
                        {weaningAssessment.recommendation || '-'}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid gap-2 border-t border-blue-200 pt-3 text-sm dark:border-blue-800 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      [t('labs.weaning.vt'), weaningAssessment.vt, 'mL'],
                      [t('labs.weaning.rr'), weaningAssessment.rr, '/min'],
                      [t('labs.weaning.spo2'), weaningAssessment.spo2, '%'],
                      [t('labs.weaning.fio2'), weaningAssessment.fio2, '%'],
                      [t('labs.weaning.peep'), weaningAssessment.peep, 'cmH₂O'],
                      [t('labs.weaning.gcs'), weaningAssessment.gcs, ''],
                      [t('labs.weaning.coughStrength'), weaningAssessment.coughStrength, ''],
                      [t('labs.weaning.secretions'), weaningAssessment.secretions, ''],
                      [t('labs.weaning.hemodynamicStability'), weaningAssessment.hemodynamicStability === null ? null : t(weaningAssessment.hemodynamicStability ? 'labs.weaning.stable' : 'labs.weaning.unstable'), ''],
                    ].map(([label, value, unit]) => (
                      <div key={String(label)} className="rounded-md bg-white/70 px-2.5 py-2 dark:bg-slate-900/50">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <p className="font-semibold">{formatDisplayValue(value)}{value !== null && value !== undefined && value !== '' && unit ? ` ${unit}` : ''}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )
      ) : null}

      <div className="flex justify-start">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-slate-50 dark:bg-slate-800 p-1">
          <button
            type="button"
            className={`flex h-10 min-w-[136px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
              activeSection === 'lab-data'
                ? 'bg-brand text-white shadow-sm'
                : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-brand'
            }`}
            onClick={() => setActiveSection('lab-data')}
            aria-pressed={activeSection === 'lab-data'}
          >
            <TestTube className="h-4 w-4" />
            {t('labs.sections.labData')}
          </button>
          <button
            type="button"
            className={`flex h-10 min-w-[136px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
              activeSection === 'microbiology'
                ? 'bg-brand text-white shadow-sm'
                : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-brand'
            }`}
            onClick={() => setActiveSection('microbiology')}
            aria-pressed={activeSection === 'microbiology'}
          >
            <Bug className="h-4 w-4" />
            {t('labs.sections.microbiology')}
          </button>
          <button
            type="button"
            className={`flex h-10 min-w-[136px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
              activeSection === 'reports'
                ? 'bg-brand text-white shadow-sm'
                : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-brand'
            }`}
            onClick={() => setActiveSection('reports')}
            aria-pressed={activeSection === 'reports'}
          >
            <FileText className="h-4 w-4" />
            {t('labs.sections.reports')}
          </button>
          <button
            type="button"
            className={`flex h-10 min-w-[136px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
              activeSection === 'inflammation'
                ? 'bg-brand text-white shadow-sm'
                : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 hover:text-brand'
            }`}
            onClick={() => setActiveSection('inflammation')}
            aria-pressed={activeSection === 'inflammation'}
          >
            <Flame className="h-4 w-4" />
            {t('labs.sections.inflammation')}
          </button>
        </div>
      </div>

      {activeSection === 'lab-data' ? (
        <LabDataDisplay labData={labData} patientId={patientId} />
      ) : activeSection === 'microbiology' ? (
        <PatientMicrobiologyCard patientId={patientId} />
      ) : activeSection === 'inflammation' ? (
        <InflammationIndicesPanel labData={labData} patientId={patientId} />
      ) : (
        <PatientDiagnosticReports patientId={patientId} />
      )}

      {/* 生命徵象手動輸入 Dialog */}
      <Dialog open={isVitalDialogOpen} onOpenChange={setIsVitalDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('labs.vitalDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {[
              { key: 'spo2', label: 'SpO₂ (%)', placeholder: '98' },
              { key: 'cvp', label: 'CVP (mmHg)', placeholder: '8' },
              { key: 'icp', label: 'ICP (mmHg)', placeholder: '10' },
              { key: 'cpp', label: 'CPP (mmHg)', placeholder: '70' },
              { key: 'etco2', label: 'EtCO₂ (mmHg)', placeholder: '35' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  type="number"
                  placeholder={placeholder}
                  value={vitalForm[key] ?? ''}
                  onChange={(e) => setVitalForm(prev => ({ ...prev, [key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsVitalDialogOpen(false)}>{t('labs.vitalDialog.cancel')}</Button>
            <Button size="sm" onClick={handleVitalSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('labs.vitalDialog.saving') : t('labs.vitalDialog.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 呼吸器設定手動輸入 Dialog */}
      <Dialog open={isVentDialogOpen} onOpenChange={setIsVentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('labs.ventDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">{t('labs.ventDialog.modeLabel')}</Label>
              <Input
                placeholder="AC / SIMV / PC / PS / CPAP"
                value={ventForm.mode ?? ''}
                onChange={(e) => setVentForm(prev => ({ ...prev, mode: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            {[
              { key: 'fio2', label: 'FiO₂ (%)', placeholder: '40' },
              { key: 'peep', label: 'PEEP (cmH₂O)', placeholder: '5' },
              { key: 'tidal_volume', label: 'Vt (mL)', placeholder: '450' },
              { key: 'respiratory_rate', label: 'RR set (/min)', placeholder: '14' },
              { key: 'pip', label: 'PIP (cmH₂O)', placeholder: '25' },
              { key: 'plateau', label: 'Pplat (cmH₂O)', placeholder: '22' },
              { key: 'compliance', label: 'Cstat (mL/cmH₂O)', placeholder: '40' },
              { key: 'inspiratory_pressure', label: 'Pinsp (cmH₂O)', placeholder: '18' },
              { key: 'pressure_support', label: 'PS (cmH₂O)', placeholder: '10' },
              { key: 'resistance', label: 'Raw (cmH₂O/L/s)', placeholder: '12' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  type="number"
                  placeholder={placeholder}
                  value={ventForm[key] ?? ''}
                  onChange={(e) => setVentForm(prev => ({ ...prev, [key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">{t('labs.ventDialog.ieRatioLabel')}</Label>
              <Input
                placeholder="1:2"
                value={ventForm.ie_ratio ?? ''}
                onChange={(e) => setVentForm(prev => ({ ...prev, ie_ratio: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsVentDialogOpen(false)}>{t('labs.ventDialog.cancel')}</Button>
            <Button size="sm" onClick={handleVentSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('labs.ventDialog.saving') : t('labs.ventDialog.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isWeaningDialogOpen} onOpenChange={setIsWeaningDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t('labs.weaningDialog.title')}
              <DataOwnershipBadge kind="orphan" />
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2 sm:grid-cols-3">
            {[
              { key: 'rsbi', label: 'RSBI', placeholder: '72' },
              { key: 'nif', label: 'NIF (cmH₂O)', placeholder: '-30' },
              { key: 'vt', label: 'Vt (mL)', placeholder: '420' },
              { key: 'rr', label: 'RR (/min)', placeholder: '18' },
              { key: 'spo2', label: 'SpO₂ (%)', placeholder: '96' },
              { key: 'fio2', label: 'FiO₂ (%)', placeholder: '35' },
              { key: 'peep', label: 'PEEP (cmH₂O)', placeholder: '5' },
              { key: 'gcs', label: 'GCS', placeholder: '15' },
              { key: 'readinessScore', label: t('labs.weaning.readiness'), placeholder: '80' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input type="number" step="1" placeholder={placeholder} value={weaningForm[key] ?? ''} onChange={(event) => setWeaningForm((current) => ({ ...current, [key]: event.target.value }))} className="h-8 text-sm" />
              </div>
            ))}
            {[
              { key: 'coughStrength', label: t('labs.weaning.coughStrength') },
              { key: 'secretions', label: t('labs.weaning.secretions') },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input value={weaningForm[key] ?? ''} onChange={(event) => setWeaningForm((current) => ({ ...current, [key]: event.target.value }))} className="h-8 text-sm" />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">{t('labs.weaning.hemodynamicStability')}</Label>
              <select value={weaningForm.hemodynamicStability ?? ''} onChange={(event) => setWeaningForm((current) => ({ ...current, hemodynamicStability: event.target.value }))} className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="">-</option>
                <option value="true">{t('labs.weaning.stable')}</option>
                <option value="false">{t('labs.weaning.unstable')}</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-3">
              <Label className="text-xs">{t('labs.weaning.recommendation')}</Label>
              <Input value={weaningForm.recommendation ?? ''} onChange={(event) => setWeaningForm((current) => ({ ...current, recommendation: event.target.value }))} className="h-8 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsWeaningDialogOpen(false)}>{t('labs.weaningDialog.cancel')}</Button>
            <Button size="sm" onClick={handleWeaningSubmit} disabled={isSubmitting}>
              {isSubmitting ? t('labs.weaningDialog.saving') : t('labs.weaningDialog.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
