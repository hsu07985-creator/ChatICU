import { Activity, Bug, FileText, Flame, Plus, Stethoscope, TestTube, Wind } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LabData, VitalSigns, VentilatorSettings, WeaningAssessment } from '../../lib/api';
import { createVitalSigns, type VitalSignsInput } from '../../lib/api/vital-signs';
import { createVentilatorSettings, type VentilatorInput } from '../../lib/api/ventilator';
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
  weaningAssessment?: WeaningAssessment | null;
  formatDisplayTimestamp: (timestamp?: string | null) => string;
  formatDisplayValue: (value: unknown) => string;
  onVitalSignClick: (labName: string, value: number, unit: string, source: TrendSource) => void;
  isAdmin?: boolean;
  onVitalSignsUpdate?: (vs: VitalSigns) => void;
  onVentilatorUpdate?: (v: VentilatorSettings) => void;
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
  weaningAssessment,
  formatDisplayTimestamp,
  formatDisplayValue,
  onVitalSignClick,
  isAdmin = false,
  onVitalSignsUpdate,
  onVentilatorUpdate,
}: PatientLabsTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSection = searchParams.get('section');

  // 手動輸入 dialog 狀態
  const [isVitalDialogOpen, setIsVitalDialogOpen] = useState(false);
  const [isVentDialogOpen, setIsVentDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [vitalForm, setVitalForm] = useState<Record<string, string>>({});
  const [ventForm, setVentForm] = useState<Record<string, string>>({});

  const parseNum = (v: string): number | null => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const handleVitalSubmit = async () => {
    setIsSubmitting(true);
    try {
      const data: VitalSignsInput = {
        heart_rate: parseNum(vitalForm.heart_rate ?? ''),
        systolic_bp: parseNum(vitalForm.systolic_bp ?? ''),
        diastolic_bp: parseNum(vitalForm.diastolic_bp ?? ''),
        respiratory_rate: parseNum(vitalForm.respiratory_rate ?? ''),
        spo2: parseNum(vitalForm.spo2 ?? ''),
        temperature: parseNum(vitalForm.temperature ?? ''),
        cvp: parseNum(vitalForm.cvp ?? ''),
        icp: parseNum(vitalForm.icp ?? ''),
        body_weight: parseNum(vitalForm.body_weight ?? ''),
        etco2: parseNum(vitalForm.etco2 ?? ''),
      };
      const result = await createVitalSigns(patientId, data);
      onVitalSignsUpdate?.(result);
      setIsVitalDialogOpen(false);
      setVitalForm({});
      toast.success('生命徵象已新增');
    } catch {
      toast.error('新增失敗，請確認輸入值');
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
        pressure_support: parseNum(ventForm.pressure_support ?? ''),
        ie_ratio: ventForm.ie_ratio || null,
      };
      const result = await createVentilatorSettings(patientId, data);
      onVentilatorUpdate?.(result);
      setIsVentDialogOpen(false);
      setVentForm({});
      toast.success('呼吸器設定已新增');
    } catch {
      toast.error('新增失敗，請確認輸入值');
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
  const hasAnyVitalSign = [temperature, heartRate, respiratoryRate, systolicBP, diastolicBP, spo2, cvp, icp, bodyWeight, bodyHeight].some(isFiniteNumber);
  const [monitorOnlyAbnormal, setMonitorOnlyAbnormal] = useState(false);
  const [monitorHideMissing, setMonitorHideMissing] = useState(false);

  interface VitalItem {
    label: string; value: number | null | undefined; unit: string;
    isAbnormal: boolean; abnormalDirection: 'high' | 'low' | 'normal';
    clickName: string; source: TrendSource; timestamp: string | undefined;
  }

  const vitalItems: VitalItem[] = useMemo(() => [
    { label: 'Temp', value: temperature, unit: '°C', isAbnormal: isFiniteNumber(temperature) && (temperature > 37.5 || temperature < 36), abnormalDirection: vitalDirection(temperature, 36, 37.5), clickName: 'Temperature', source: 'vital' as TrendSource, timestamp: vitalSignsTimestamp || undefined },
    { label: 'HR', value: heartRate, unit: 'bpm', isAbnormal: isFiniteNumber(heartRate) && (heartRate > 100 || heartRate < 60), abnormalDirection: vitalDirection(heartRate, 60, 100), clickName: 'HeartRate', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'RR', value: respiratoryRate, unit: 'rpm', isAbnormal: isFiniteNumber(respiratoryRate) && (respiratoryRate > 25 || respiratoryRate < 12), abnormalDirection: vitalDirection(respiratoryRate, 12, 25), clickName: 'RespiratoryRate', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'SBP', value: systolicBP, unit: 'mmHg', isAbnormal: isFiniteNumber(systolicBP) && (systolicBP > 140 || systolicBP < 90), abnormalDirection: vitalDirection(systolicBP, 90, 140), clickName: 'BloodPressureSystolic', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'DBP', value: diastolicBP, unit: 'mmHg', isAbnormal: isFiniteNumber(diastolicBP) && (diastolicBP > 90 || diastolicBP < 60), abnormalDirection: vitalDirection(diastolicBP, 60, 90), clickName: 'BloodPressureDiastolic', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'MAP', value: map, unit: 'mmHg', isAbnormal: isFiniteNumber(map) && (map > 110 || map < 65), abnormalDirection: vitalDirection(map, 65, 110), clickName: 'MAP', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'SpO₂', value: spo2, unit: '%', isAbnormal: isFiniteNumber(spo2) && spo2 < 94, abnormalDirection: vitalDirection(spo2, 94, Infinity), clickName: 'SpO2', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'CVP', value: cvp, unit: 'mmHg', isAbnormal: isFiniteNumber(cvp) && (cvp > 12 || cvp < 2), abnormalDirection: vitalDirection(cvp, 2, 12), clickName: 'CVP', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'ICP', value: icp, unit: 'mmHg', isAbnormal: isFiniteNumber(icp) && icp > 20, abnormalDirection: vitalDirection(icp, -Infinity, 20), clickName: 'ICP', source: 'vital', timestamp: vitalSignsTimestamp || undefined },
    { label: 'BW', value: bodyWeight, unit: 'kg', isAbnormal: false, abnormalDirection: 'normal' as const, clickName: 'BodyWeight', source: 'vital' as TrendSource, timestamp: vitalSignsTimestamp || undefined },
    { label: 'BH', value: bodyHeight, unit: 'cm', isAbnormal: false, abnormalDirection: 'normal' as const, clickName: 'BodyHeight', source: 'vital' as TrendSource, timestamp: undefined },
  ], [temperature, heartRate, respiratoryRate, systolicBP, diastolicBP, map, spo2, cvp, icp, bodyWeight, bodyHeight, vitalSignsTimestamp]);

  const ventItems: VitalItem[] = useMemo(() => [
    { label: 'FiO₂', value: ventFiO2, unit: '%', isAbnormal: isFiniteNumber(ventFiO2) && ventFiO2 > 60, abnormalDirection: vitalDirection(ventFiO2, -Infinity, 60), clickName: 'FiO2', source: 'ventilator' as TrendSource, timestamp: ventTimestamp || undefined },
    { label: 'PEEP', value: ventPeep, unit: 'cmH₂O', isAbnormal: isFiniteNumber(ventPeep) && ventPeep > 12, abnormalDirection: vitalDirection(ventPeep, -Infinity, 12), clickName: 'PEEP', source: 'ventilator', timestamp: ventTimestamp || undefined },
    { label: 'Vt', value: ventTidalVolume, unit: 'mL', isAbnormal: isFiniteNumber(ventTidalVolume) && ventTidalVolume > 500, abnormalDirection: vitalDirection(ventTidalVolume, -Infinity, 500), clickName: 'TidalVolume', source: 'ventilator', timestamp: ventTimestamp || undefined },
    { label: 'RR set', value: ventRespRate, unit: '/min', isAbnormal: false, abnormalDirection: 'normal' as const, clickName: 'VentRR', source: 'ventilator', timestamp: ventTimestamp || undefined },
    { label: 'PIP', value: ventPip, unit: 'cmH₂O', isAbnormal: isFiniteNumber(ventPip) && ventPip > 30, abnormalDirection: vitalDirection(ventPip, -Infinity, 30), clickName: 'PIP', source: 'ventilator', timestamp: ventTimestamp || undefined },
    { label: 'Pplat', value: ventPlateau, unit: 'cmH₂O', isAbnormal: isFiniteNumber(ventPlateau) && ventPlateau > 30, abnormalDirection: vitalDirection(ventPlateau, -Infinity, 30), clickName: 'Plateau', source: 'ventilator', timestamp: ventTimestamp || undefined },
    { label: 'Cstat', value: ventCompliance, unit: 'mL/cmH₂O', isAbnormal: isFiniteNumber(ventCompliance) && ventCompliance < 30, abnormalDirection: vitalDirection(ventCompliance, 30, Infinity), clickName: 'Compliance', source: 'ventilator', timestamp: ventTimestamp || undefined },
  ], [ventFiO2, ventPeep, ventTidalVolume, ventRespRate, ventPip, ventPlateau, ventCompliance, ventTimestamp]);

  function filterItems(items: VitalItem[]): VitalItem[] {
    return items.filter((item) => {
      if (monitorHideMissing && !isFiniteNumber(item.value)) return false;
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
            Vital Signs
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
              Ventilator
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
            只看異常
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
            隱藏無資料
          </button>
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">高效率篩選</span>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1 text-xs h-7 px-2"
            onClick={() => activeMonitor === 'vital-signs' ? setIsVitalDialogOpen(true) : setIsVentDialogOpen(true)}
          >
            <Plus className="h-3 w-3" />
            手動輸入
          </Button>
        )}
      </div>

      {/* 生命徵象 / 呼吸器 內容 */}
      {activeMonitor === 'vital-signs' ? (
        vitalSignsLoading ? (
          <div className="flex items-center justify-center py-4">
            <LoadingSpinner size="md" text="載入生命徵象..." />
          </div>
        ) : !hasAnyVitalSign ? (
          <p className="py-2 text-center text-sm text-slate-400 dark:text-slate-500">尚無生命徵象資料</p>
        ) : filterItems(vitalItems).length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            目前篩選條件下沒有可顯示的項目
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
              />
            ))}
          </div>
        )
      ) : activeMonitor === 'ventilator' && patientIntubated ? (
        ventilatorLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" text="載入呼吸器設定..." />
          </div>
        ) : (
          <div className="space-y-3">
            {filterItems(ventItems).length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                目前篩選條件下沒有可顯示的項目
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
                  />
                ))}
              </div>
            )}

            {/* 脫機評估 */}
            {weaningAssessment && (
              <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Stethoscope className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    脫機評估 Weaning Assessment
                  </CardTitle>
                  <CardDescription>
                    評估時間: {new Date(weaningAssessment.timestamp).toLocaleString('zh-TW')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4 mb-4">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">RSBI</p>
                      <p className={`text-2xl font-bold ${weaningAssessment.rsbi > 105 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {weaningAssessment.rsbi}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">NIF</p>
                      <p className={`text-2xl font-bold ${weaningAssessment.nif > -25 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {weaningAssessment.nif} cmH₂O
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">準備度分數</p>
                      <p className={`text-2xl font-bold ${weaningAssessment.readinessScore >= 70 ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        {weaningAssessment.readinessScore}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">建議</p>
                      <Badge className={weaningAssessment.recommendation.includes('可以') ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300'}>
                        {weaningAssessment.recommendation}
                      </Badge>
                    </div>
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
            Lab Data
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
            Microbiology
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
            Reports
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
            Inflammation
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
            <DialogTitle>手動輸入生命徵象</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {[
              { key: 'temperature', label: 'Temp (°C)', placeholder: '36.5' },
              { key: 'heart_rate', label: 'HR (bpm)', placeholder: '72' },
              { key: 'systolic_bp', label: 'SBP (mmHg)', placeholder: '120' },
              { key: 'diastolic_bp', label: 'DBP (mmHg)', placeholder: '80' },
              { key: 'respiratory_rate', label: 'RR (/min)', placeholder: '16' },
              { key: 'spo2', label: 'SpO₂ (%)', placeholder: '98' },
              { key: 'cvp', label: 'CVP (mmHg)', placeholder: '8' },
              { key: 'icp', label: 'ICP (mmHg)', placeholder: '10' },
              { key: 'body_weight', label: 'BW (kg)', placeholder: '60' },
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
            <Button variant="outline" size="sm" onClick={() => setIsVitalDialogOpen(false)}>取消</Button>
            <Button size="sm" onClick={handleVitalSubmit} disabled={isSubmitting}>
              {isSubmitting ? '儲存中...' : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 呼吸器設定手動輸入 Dialog */}
      <Dialog open={isVentDialogOpen} onOpenChange={setIsVentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>手動輸入呼吸器設定</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Mode</Label>
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
              { key: 'pressure_support', label: 'PS (cmH₂O)', placeholder: '10' },
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
              <Label className="text-xs">I:E Ratio</Label>
              <Input
                placeholder="1:2"
                value={ventForm.ie_ratio ?? ''}
                onChange={(e) => setVentForm(prev => ({ ...prev, ie_ratio: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsVentDialogOpen(false)}>取消</Button>
            <Button size="sm" onClick={handleVentSubmit} disabled={isSubmitting}>
              {isSubmitting ? '儲存中...' : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
