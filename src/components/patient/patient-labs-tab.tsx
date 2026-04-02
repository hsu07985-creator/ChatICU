import { Activity, Bug, Calendar, ChevronDown, ChevronRight, Stethoscope, TestTube, Wind } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LabData, WeaningAssessment } from '../../lib/api';
import { LabDataDisplay } from '../lab-data-display';
import { PatientMicrobiologyCard } from './patient-microbiology-card';
import { VitalSignCard } from '../vital-signs-card';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { LoadingSpinner } from '../ui/state-display';
import { TabsContent } from '../ui/tabs';

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
}

const metricGridStyle = {
  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
  gap: '8px',
} as const;

const VALID_LABS_SECTIONS = new Set(['lab-data', 'microbiology']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
}: PatientLabsTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [vitalSignsOpen, setVitalSignsOpen] = useState(true);
  const [ventilatorOpen, setVentilatorOpen] = useState(true);
  const rawSection = searchParams.get('section');
  const activeSection = rawSection && VALID_LABS_SECTIONS.has(rawSection) ? rawSection : 'lab-data';
  const hasAnyVitalSign = [temperature, heartRate, respiratoryRate, systolicBP, diastolicBP, spo2, cvp, icp].some(isFiniteNumber);
  const setActiveSection = useCallback((section: 'lab-data' | 'microbiology') => {
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

  return (
    <TabsContent value="labs" className="space-y-4" style={{ paddingBottom: '10rem' }}>
      {/* 生命徵象 */}
      <Collapsible open={vitalSignsOpen} onOpenChange={setVitalSignsOpen}>
        <Card className="gap-0">
          <CardHeader className={`min-h-14 bg-[#f8f9fa] px-0 py-0 ${vitalSignsOpen ? 'border-b' : ''}`}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-slate-100/70"
                aria-label={vitalSignsOpen ? '收合生命徵象' : '展開生命徵象'}
              >
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                    <Activity className="h-6 w-6 text-[#7f265b]" />
                    生命徵象 Vital Signs
                  </CardTitle>
                  <CardDescription className="mt-1 flex items-center gap-1 text-sm">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDisplayTimestamp(vitalSignsTimestamp)}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center text-slate-500">
                  {vitalSignsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
              </button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent className="overflow-hidden">
            <CardContent className="pt-4">
              {vitalSignsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <LoadingSpinner size="md" text="載入生命徵象..." />
                </div>
              ) : !hasAnyVitalSign ? (
                <p className="py-2 text-center text-sm text-slate-400">尚無生命徵象資料</p>
              ) : (
                <div className="grid" style={metricGridStyle}>
                  <VitalSignCard
                    label="Temp"
                    value={temperature}
                    unit="°C"
                    isAbnormal={isFiniteNumber(temperature) && (temperature > 37.5 || temperature < 36)}
                    onClick={isFiniteNumber(temperature) ? () => onVitalSignClick('Temperature', temperature, '°C', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />

                  <VitalSignCard
                    label="HR"
                    value={heartRate}
                    unit="bpm"
                    isAbnormal={isFiniteNumber(heartRate) && (heartRate > 100 || heartRate < 60)}
                    onClick={isFiniteNumber(heartRate) ? () => onVitalSignClick('HeartRate', heartRate, 'bpm', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />

                  <VitalSignCard
                    label="RR"
                    value={respiratoryRate}
                    unit="rpm"
                    isAbnormal={isFiniteNumber(respiratoryRate) && (respiratoryRate > 25 || respiratoryRate < 12)}
                    onClick={isFiniteNumber(respiratoryRate) ? () => onVitalSignClick('RespiratoryRate', respiratoryRate, 'rpm', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />

                  <VitalSignCard
                    label="SBP"
                    value={systolicBP}
                    unit="mmHg"
                    isAbnormal={isFiniteNumber(systolicBP) && (systolicBP > 140 || systolicBP < 90)}
                    onClick={isFiniteNumber(systolicBP) ? () => onVitalSignClick('BloodPressureSystolic', systolicBP, 'mmHg', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />

                  <VitalSignCard
                    label="DBP"
                    value={diastolicBP}
                    unit="mmHg"
                    isAbnormal={isFiniteNumber(diastolicBP) && (diastolicBP > 90 || diastolicBP < 60)}
                    onClick={isFiniteNumber(diastolicBP) ? () => onVitalSignClick('BloodPressureDiastolic', diastolicBP, 'mmHg', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />

                  <VitalSignCard
                    label="SpO₂"
                    value={spo2}
                    unit="%"
                    isAbnormal={isFiniteNumber(spo2) && spo2 < 94}
                    onClick={isFiniteNumber(spo2) ? () => onVitalSignClick('SpO2', spo2, '%', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />

                  <VitalSignCard
                    label="CVP"
                    value={cvp}
                    unit="mmHg"
                    isAbnormal={isFiniteNumber(cvp) && (cvp > 12 || cvp < 2)}
                    onClick={isFiniteNumber(cvp) ? () => onVitalSignClick('CVP', cvp, 'mmHg', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />

                  <VitalSignCard
                    label="ICP"
                    value={icp}
                    unit="mmHg"
                    isAbnormal={isFiniteNumber(icp) && icp > 20}
                    onClick={isFiniteNumber(icp) ? () => onVitalSignClick('ICP', icp, 'mmHg', 'vital') : undefined}
                    timestamp={vitalSignsTimestamp || undefined}
                  />
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* 呼吸器設定 - 僅在插管病人顯示 */}
      {patientIntubated && (
        <Collapsible open={ventilatorOpen} onOpenChange={setVentilatorOpen}>
          <Card className="gap-0">
            <CardHeader className={`min-h-14 bg-[#f8f9fa] px-0 py-0 ${ventilatorOpen ? 'border-b' : ''}`}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-slate-100/70"
                  aria-label={ventilatorOpen ? '收合呼吸器設定' : '展開呼吸器設定'}
                >
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                      <Wind className="h-6 w-6 text-[#7f265b]" />
                      呼吸器設定 Ventilator Settings
                    </CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-1 text-sm">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDisplayTimestamp(ventTimestamp)} | Mode: {formatDisplayValue(ventMode)}
                    </CardDescription>
                  </div>
                <div className="flex shrink-0 items-center text-slate-500">
                    {ventilatorOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
                </button>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent className="overflow-hidden">
              <CardContent className="pt-4">
                {ventilatorLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner size="md" text="載入呼吸器設定..." />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid" style={metricGridStyle}>
                      <VitalSignCard
                        label="FiO₂"
                        value={ventFiO2}
                        unit="%"
                        isAbnormal={isFiniteNumber(ventFiO2) && ventFiO2 > 60}
                        onClick={isFiniteNumber(ventFiO2) ? () => onVitalSignClick('FiO2', ventFiO2, '%', 'ventilator') : undefined}
                        timestamp={ventTimestamp || undefined}
                      />
                      <VitalSignCard
                        label="PEEP"
                        value={ventPeep}
                        unit="cmH₂O"
                        isAbnormal={isFiniteNumber(ventPeep) && ventPeep > 12}
                        onClick={isFiniteNumber(ventPeep) ? () => onVitalSignClick('PEEP', ventPeep, 'cmH₂O', 'ventilator') : undefined}
                        timestamp={ventTimestamp || undefined}
                      />
                      <VitalSignCard
                        label="Vt"
                        value={ventTidalVolume}
                        unit="mL"
                        isAbnormal={isFiniteNumber(ventTidalVolume) && ventTidalVolume > 500}
                        onClick={isFiniteNumber(ventTidalVolume) ? () => onVitalSignClick('TidalVolume', ventTidalVolume, 'mL', 'ventilator') : undefined}
                        timestamp={ventTimestamp || undefined}
                      />
                      <VitalSignCard
                        label="RR set"
                        value={ventRespRate}
                        unit="/min"
                        onClick={isFiniteNumber(ventRespRate) ? () => onVitalSignClick('VentRR', ventRespRate, '/min', 'ventilator') : undefined}
                        timestamp={ventTimestamp || undefined}
                      />
                      <VitalSignCard
                        label="PIP"
                        value={ventPip}
                        unit="cmH₂O"
                        isAbnormal={isFiniteNumber(ventPip) && ventPip > 30}
                        onClick={isFiniteNumber(ventPip) ? () => onVitalSignClick('PIP', ventPip, 'cmH₂O', 'ventilator') : undefined}
                        timestamp={ventTimestamp || undefined}
                      />
                      <VitalSignCard
                        label="Pplat"
                        value={ventPlateau}
                        unit="cmH₂O"
                        isAbnormal={isFiniteNumber(ventPlateau) && ventPlateau > 30}
                        onClick={isFiniteNumber(ventPlateau) ? () => onVitalSignClick('Plateau', ventPlateau, 'cmH₂O', 'ventilator') : undefined}
                        timestamp={ventTimestamp || undefined}
                      />
                      <VitalSignCard
                        label="Cstat"
                        value={ventCompliance}
                        unit="mL/cmH₂O"
                        isAbnormal={isFiniteNumber(ventCompliance) && ventCompliance < 30}
                        onClick={isFiniteNumber(ventCompliance) ? () => onVitalSignClick('Compliance', ventCompliance, 'mL/cmH₂O', 'ventilator') : undefined}
                        timestamp={ventTimestamp || undefined}
                      />
                    </div>

                    {/* 脫機評估 */}
                    {weaningAssessment && (
                      <Card className="bg-blue-50 border-blue-200">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Stethoscope className="h-5 w-5 text-blue-600" />
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
                              <p className={`text-2xl font-bold ${weaningAssessment.rsbi > 105 ? 'text-red-600' : 'text-green-600'}`}>
                                {weaningAssessment.rsbi}
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm text-muted-foreground">NIF</p>
                              <p className={`text-2xl font-bold ${weaningAssessment.nif > -25 ? 'text-red-600' : 'text-green-600'}`}>
                                {weaningAssessment.nif} cmH₂O
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm text-muted-foreground">準備度分數</p>
                              <p className={`text-2xl font-bold ${weaningAssessment.readinessScore >= 70 ? 'text-green-600' : 'text-orange-600'}`}>
                                {weaningAssessment.readinessScore}%
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-sm text-muted-foreground">建議</p>
                              <Badge className={weaningAssessment.recommendation.includes('可以') ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}>
                                {weaningAssessment.recommendation}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      <div className="flex justify-start">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#e5e7eb] bg-[#f8f9fa] p-1">
          <button
            type="button"
            className={`flex h-10 min-w-[136px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${
              activeSection === 'lab-data'
                ? 'bg-[#7f265b] text-white shadow-sm'
                : 'bg-transparent text-slate-600 hover:bg-white hover:text-[#7f265b]'
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
                ? 'bg-[#7f265b] text-white shadow-sm'
                : 'bg-transparent text-slate-600 hover:bg-white hover:text-[#7f265b]'
            }`}
            onClick={() => setActiveSection('microbiology')}
            aria-pressed={activeSection === 'microbiology'}
          >
            <Bug className="h-4 w-4" />
            Microbiology
          </button>
        </div>
      </div>

      {activeSection === 'lab-data' ? (
        <>
          <Card>
            <CardHeader className="min-h-14 bg-[#f8f9fa] border-b py-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <TestTube className="h-6 w-6 text-[#7f265b]" />
                檢驗數據 Lab Data
              </CardTitle>
              <CardDescription className="mt-1 text-sm flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatDisplayTimestamp(labData?.timestamp)}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-3">
              <LabDataDisplay labData={labData} patientId={patientId} />
            </CardContent>
          </Card>

        </>
      ) : (
        <PatientMicrobiologyCard patientId={patientId} />
      )}
    </TabsContent>
  );
}
