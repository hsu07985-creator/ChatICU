import { useState, useCallback } from 'react';
import type { Medication } from '../../lib/api';
import type { UserRole } from '../../lib/auth-context';
import { isAntibiotic } from '../../lib/antibiotic-codes';
import { updateMedication } from '../../lib/api/medications';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { MedicationsSkeleton } from '../ui/skeletons';
import { TabsContent } from '../ui/tabs';
import { Textarea } from '../ui/textarea';
import { ScoreTrendChart } from '../score-trend-chart';
import { toast } from 'sonner';

const PRN_FREQ_PATTERN = /PRN|STAT/i;

function isPrnOrStat(med: Medication): boolean {
  if (med.prn) return true;
  if (med.frequency && PRN_FREQ_PATTERN.test(med.frequency)) return true;
  return false;
}

function formatMedDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatMedicationConcentration(medication: Medication): string | null {
  if (!medication.concentration) return null;
  return [medication.concentration, medication.concentrationUnit].filter(Boolean).join(' ');
}

const MED_CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  antibiotic: { label: '抗生素', color: 'bg-amber-100 text-amber-800' },
  antifungal: { label: '抗黴菌', color: 'bg-amber-100 text-amber-800' },
  antiviral: { label: '抗病毒', color: 'bg-amber-100 text-amber-800' },
  vasopressor: { label: '升壓劑', color: 'bg-red-100 text-red-800' },
  anticoagulant: { label: '抗凝血', color: 'bg-rose-100 text-rose-800' },
  steroid: { label: '類固醇', color: 'bg-orange-100 text-orange-800' },
  ppi: { label: 'PPI', color: 'bg-sky-100 text-sky-800' },
  h2_blocker: { label: 'H2 Blocker', color: 'bg-sky-100 text-sky-800' },
  diuretic: { label: '利尿劑', color: 'bg-cyan-100 text-cyan-800' },
  insulin: { label: '胰島素', color: 'bg-teal-100 text-teal-800' },
  electrolyte: { label: '電解質', color: 'bg-emerald-100 text-emerald-800' },
  bronchodilator: { label: '支氣管擴張', color: 'bg-indigo-100 text-indigo-800' },
  antiarrhythmic: { label: '抗心律不整', color: 'bg-pink-100 text-pink-800' },
  antiepileptic: { label: '抗癲癇', color: 'bg-purple-100 text-purple-800' },
  laxative: { label: '緩瀉劑', color: 'bg-lime-100 text-lime-800' },
  antiemetic: { label: '止吐', color: 'bg-green-100 text-green-800' },
};

/** Pain 0-10 色階：綠→黃→橙→紅 */
function painColor(v: number): string {
  if (v <= 1) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (v <= 3) return 'bg-lime-100 text-lime-700 border-lime-200';
  if (v <= 5) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (v <= 7) return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

/** RASS -5~+4 色階：深藍(深鎮靜)→淡藍→綠(平靜)→橙→紅(躁動) */
function rassColor(v: number): string {
  if (v <= -3) return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (v <= -1) return 'bg-sky-100 text-sky-700 border-sky-200';
  if (v === 0) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (v <= 2) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function ScoreSelector({
  min,
  max,
  currentValue,
  onSelect,
  formatLabel,
  colorFn,
}: {
  min: number;
  max: number;
  currentValue: number | null;
  onSelect: (v: number) => void;
  formatLabel?: (v: number) => string;
  colorFn?: (v: number) => string;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasPending = pending !== null && pending !== currentValue;
  const fmt = useCallback((v: number) => formatLabel ? formatLabel(v) : `${v}`, [formatLabel]);
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const handleConfirm = async () => {
    if (pending === null) return;
    setSubmitting(true);
    try {
      await onSelect(pending);
      setPending(null);
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
          const color = colorFn ? colorFn(v) : 'bg-emerald-100 text-emerald-700 border-emerald-200';
          return (
            <button
              key={v}
              type="button"
              disabled={submitting}
              onClick={() => setPending(v)}
              className={`flex-1 py-1.5 text-xs font-semibold tabular-nums rounded transition-all border
                ${isSelected
                  ? `${color} ring-2 ring-brand ring-offset-1 scale-105 shadow-sm`
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100 hover:text-gray-700 hover:scale-105'
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
          <span className="text-sm font-medium text-brand">
            {fmt(pending!)}
          </span>
          <Button
            size="sm"
            className="h-7 px-3 text-xs font-medium bg-brand hover:bg-brand-hover rounded-md"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? '記錄中...' : '確認記錄'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={submitting}
            onClick={() => setPending(null)}
          >
            取消
          </Button>
        </div>
      )}
    </div>
  );
}

function SanMedCard({
  medication,
  canEdit,
  patientId,
  onEdit,
}: {
  medication: Medication;
  canEdit: boolean;
  patientId?: string;
  onEdit: (med: Medication) => void;
}) {
  const spec = medication.concentration || null;
  const noteText = medication.notes || null;

  return (
    <div className="rounded-md border bg-white px-3 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium leading-tight">
          {medication.name || '—'}
          {spec && <span className="font-normal text-muted-foreground ml-1.5">{spec}</span>}
        </p>
        {canEdit && patientId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs shrink-0"
            onClick={() => onEdit(medication)}
          >
            編輯
          </Button>
        )}
      </div>
      {noteText && (
        <div className="rounded bg-slate-100 px-2.5 py-2">
          <p className="text-[11px] font-medium text-slate-500 mb-1">醫令備註</p>
          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{noteText}</p>
        </div>
      )}
    </div>
  );
}

interface PatientMedicationsTabProps {
  patientId?: string;
  userRole?: UserRole;
  medicationsLoading: boolean;
  painIndication?: string;
  sedationIndication?: string;
  nmbIndication?: string;
  painMedications: Medication[];
  sedationMedications: Medication[];
  nmbMedications: Medication[];
  otherMedications: Medication[];
  formatDisplayValue: (value: unknown) => string;
  formatMedicationRegimen: (medication: Medication) => string;
  painScoreValue: number | null;
  rassScoreValue: number | null;
  onRecordScore: (scoreType: 'pain' | 'rass', value: number) => Promise<void>;
  onOpenScoreTrend: (scoreType: 'pain' | 'rass') => void;
  scoreTrendOpen: boolean;
  scoreTrendType: 'pain' | 'rass';
  scoreTrendData: { date: string; value: number }[];
  scoreEntries: import('@/lib/api/scores').ScoreEntry[];
  onDeleteScoreEntry?: (scoreId: string) => Promise<void>;
  onCloseScoreTrend: () => void;
  onRefreshMedications: () => Promise<void>;
}

export function PatientMedicationsTab({
  patientId,
  userRole,
  medicationsLoading,
  painIndication,
  sedationIndication,
  nmbIndication,
  painMedications,
  sedationMedications,
  nmbMedications,
  otherMedications,
  formatDisplayValue,
  formatMedicationRegimen,
  painScoreValue,
  rassScoreValue,
  onRecordScore,
  onOpenScoreTrend,
  scoreTrendOpen,
  scoreTrendType,
  scoreTrendData,
  scoreEntries,
  onDeleteScoreEntry,
  onCloseScoreTrend,
  onRefreshMedications,
}: PatientMedicationsTabProps) {
  const [medView, setMedView] = useState<'active' | 'discontinued' | 'all'>('active');
  const [filterAbx, setFilterAbx] = useState(false);
  const [filterPrn, setFilterPrn] = useState(false);
  const [editingMedication, setEditingMedication] = useState<Medication | null>(null);
  const [editForm, setEditForm] = useState({
    dose: '',
    unit: '',
    concentration: '',
    concentrationUnit: '',
    frequency: '',
    route: '',
    indication: '',
  });
  const [isSavingMedication, setIsSavingMedication] = useState(false);

  const isDiscontinued = (med: Medication) =>
    med.status === 'discontinued' || med.status === 'completed' || med.status === 'inactive';

  // Separate active vs discontinued across all groups
  const activePainMeds = painMedications.filter((m) => !isDiscontinued(m));
  const activeSedationMeds = sedationMedications.filter((m) => !isDiscontinued(m));
  const activeNmbMeds = nmbMedications.filter((m) => !isDiscontinued(m));
  const activeOtherMeds = otherMedications.filter((m) => !isDiscontinued(m));

  const allDiscontinuedMeds = [
    ...painMedications.filter(isDiscontinued),
    ...sedationMedications.filter(isDiscontinued),
    ...nmbMedications.filter(isDiscontinued),
    ...otherMedications.filter(isDiscontinued),
  ];

  const allOtherMeds = [...activeOtherMeds, ...allDiscontinuedMeds];
  const activeCount = activeOtherMeds.length;
  const discontinuedCount = allDiscontinuedMeds.length;
  const totalCount = allOtherMeds.length;

  // Current base list depends on view mode
  const baseMeds = medView === 'active' ? activeOtherMeds : medView === 'discontinued' ? allDiscontinuedMeds : allOtherMeds;
  const prnCount = baseMeds.filter(isPrnOrStat).length;
  const abxCount = baseMeds.filter(isAntibiotic).length;

  // Sort: antibiotics first, then by name
  const sortOtherMeds = (meds: Medication[]) => [...meds].sort((a, b) => {
    const aAbx = isAntibiotic(a) ? 0 : 1;
    const bAbx = isAntibiotic(b) ? 0 : 1;
    if (aAbx !== bAbx) return aAbx - bAbx;
    return (a.name || '').localeCompare(b.name || '');
  });

  const applyFilters = (meds: Medication[]) => meds
    .filter((m) => !filterPrn || isPrnOrStat(m))
    .filter((m) => !filterAbx || isAntibiotic(m));

  const displayedMeds = applyFilters(sortOtherMeds(baseMeds));
  const canEditMedication = userRole === 'doctor' || userRole === 'pharmacist';

  const openMedicationEditor = (medication: Medication) => {
    setEditingMedication(medication);
    setEditForm({
      dose: medication.dose || '',
      unit: medication.unit || '',
      concentration: medication.concentration || '',
      concentrationUnit: medication.concentrationUnit || '',
      frequency: medication.frequency || '',
      route: medication.route || '',
      indication: medication.indication || '',
    });
  };

  const closeMedicationEditor = () => {
    if (isSavingMedication) return;
    setEditingMedication(null);
  };

  const handleEditFieldChange = (field: keyof typeof editForm, value: string) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveMedication = async () => {
    if (!patientId || !editingMedication) return;
    setIsSavingMedication(true);
    try {
      await updateMedication(patientId, editingMedication.id, {
        dose: editForm.dose,
        unit: editForm.unit,
        concentration: editForm.concentration,
        concentrationUnit: editForm.concentrationUnit,
        frequency: editForm.frequency,
        route: editForm.route,
        indication: editForm.indication,
      });
      await onRefreshMedications();
      toast.success('藥物資料已更新');
      setEditingMedication(null);
    } catch (error) {
      console.error('更新藥物失敗:', error);
      toast.error('更新藥物失敗');
    } finally {
      setIsSavingMedication(false);
    }
  };

  return (
    <TabsContent value="meds" className="space-y-3">
      {medicationsLoading ? (
        <MedicationsSkeleton />
      ) : (
        <>
          {/* S/A/N 藥物 */}
          <div className="grid gap-3 md:grid-cols-3">
            {/* Pain (A) */}
            <Card className="border-border">
              <CardHeader className="pb-2 space-y-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800">Pain 止痛</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('pain')}
                  >
                    趨勢
                  </Button>
                </div>
                <CardDescription className="text-sm leading-tight">
                  {painIndication || 'Pain Score: -'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ScoreSelector
                  min={0}
                  max={10}
                  currentValue={painScoreValue}
                  onSelect={(v) => onRecordScore('pain', v)}
                  colorFn={painColor}
                />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">止痛藥物</p>
                  {activePainMeds.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">無止痛藥物</p>
                  ) : (
                    <div className="space-y-2">
                      {activePainMeds.map((medication) => (
                        <SanMedCard key={medication.id} medication={medication} canEdit={canEditMedication} patientId={patientId} onEdit={openMedicationEditor} />
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sedation (S) */}
            <Card className="border-border">
              <CardHeader className="pb-2 space-y-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800">Sedation 鎮靜</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('rass')}
                  >
                    趨勢
                  </Button>
                </div>
                <CardDescription className="text-sm leading-tight">
                  {sedationIndication || 'RASS Score: -/+4'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ScoreSelector
                  min={-5}
                  max={4}
                  currentValue={rassScoreValue}
                  onSelect={(v) => onRecordScore('rass', v)}
                  formatLabel={(v) => v > 0 ? `+${v}` : `${v}`}
                  colorFn={rassColor}
                />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">鎮靜藥物</p>
                  {activeSedationMeds.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">無鎮靜藥物</p>
                  ) : (
                    <div className="space-y-2">
                      {activeSedationMeds.map((medication) => (
                        <SanMedCard key={medication.id} medication={medication} canEdit={canEditMedication} patientId={patientId} onEdit={openMedicationEditor} />
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Neuromuscular Blockade (N) */}
            <Card className="border-border">
              <CardHeader className="pb-2 space-y-1">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800">Neuromuscular Blockade 神經肌肉阻斷</CardTitle>
                <CardDescription className="text-sm leading-tight">
                  {nmbIndication || '-'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">神經肌肉阻斷藥物</p>
                {activeNmbMeds.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">無神經肌肉阻斷藥物</p>
                ) : (
                  <div className="space-y-2">
                    {activeNmbMeds.map((medication) => (
                      <SanMedCard key={medication.id} medication={medication} canEdit={canEditMedication} patientId={patientId} onEdit={openMedicationEditor} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Other Medications */}
          <Card className={`border-border ${medView === 'discontinued' ? 'border-dashed' : ''}`}>
            <CardHeader className="pb-2 space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800">其他藥物 Other Medications</CardTitle>
              </div>
              {/* Primary toggle: active vs discontinued */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'all' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => { setMedView('all'); setFilterAbx(false); setFilterPrn(false); }}
                  >
                    全部 ({totalCount})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'active' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => { setMedView('active'); setFilterAbx(false); setFilterPrn(false); }}
                  >
                    使用中 ({activeCount})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={discontinuedCount === 0}
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'discontinued' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                    onClick={() => { setMedView('discontinued'); setFilterAbx(false); setFilterPrn(false); }}
                  >
                    已停用 ({discontinuedCount})
                  </Button>
                </div>
                {abxCount > 0 && (
                  <Button
                    variant={filterAbx ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 px-2 text-xs ${filterAbx ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                    onClick={() => { setFilterAbx(!filterAbx); if (!filterAbx) setFilterPrn(false); }}
                  >
                    抗生素 ({abxCount})
                  </Button>
                )}
                {prnCount > 0 && (
                  <Button
                    variant={filterPrn ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 px-2 text-xs ${filterPrn ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'border-violet-300 text-violet-700 hover:bg-violet-50'}`}
                    onClick={() => { setFilterPrn(!filterPrn); if (!filterPrn) setFilterAbx(false); }}
                  >
                    PRN/STAT ({prnCount})
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {medView === 'discontinued' && (
                <p className="mb-2 text-xs text-muted-foreground">本次住院期間曾使用，現已停用的藥品</p>
              )}
              {displayedMeds.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {filterAbx ? '無抗生素藥物' : filterPrn ? '無 PRN/STAT 藥物' : medView === 'discontinued' ? '無已停用藥物' : medView === 'all' ? '無藥物' : '無其他藥物'}
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {displayedMeds.map((medication) => {
                    const category = MED_CATEGORY_LABELS[medication.category];
                    const abx = isAntibiotic(medication);
                    const prn = isPrnOrStat(medication);
                    const isStat = medication.frequency?.toUpperCase() === 'STAT';
                    const discontinued = isDiscontinued(medication);
                    const statusLabel = medication.status === 'completed' ? '療程完成' : medication.status === 'inactive' ? '未啟用' : '已停用';
                    return (
                      <div
                        key={medication.id}
                        className={`rounded-md border px-3 py-2 ${
                          discontinued
                            ? 'border-dashed border-gray-300 bg-gray-50 opacity-75'
                            : abx
                              ? 'bg-amber-50 border-amber-200'
                              : 'bg-[rgba(196,196,196,0.15)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-medium leading-tight ${discontinued ? 'text-gray-500 line-through' : ''}`}>
                              {formatDisplayValue(medication.name)}
                            </p>
                            {discontinued && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-gray-200 text-gray-600">
                                {statusLabel}
                              </Badge>
                            )}
                            {abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 bg-amber-100 text-amber-800 ${discontinued ? 'opacity-60' : ''}`}>
                                抗生素
                              </Badge>
                            )}
                            {prn && !discontinued && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-violet-100 text-violet-800">
                                {isStat ? 'STAT' : 'PRN'}
                              </Badge>
                            )}
                            {category && !abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 ${category.color} ${discontinued ? 'opacity-60' : ''}`}>
                                {category.label}
                              </Badge>
                            )}
                          </div>
                          {!discontinued && canEditMedication && patientId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs shrink-0"
                              onClick={() => openMedicationEditor(medication)}
                            >
                              編輯
                            </Button>
                          )}
                        </div>
                        <div className={`mt-1 flex items-center gap-2 text-sm ${discontinued ? 'text-gray-400' : 'text-muted-foreground'}`}>
                          <span>{formatMedicationRegimen(medication)}</span>
                          {medication.startDate && (
                            <span className="text-xs">{formatMedDate(medication.startDate)}</span>
                          )}
                          {discontinued && medication.endDate && (
                            <span className="text-xs">→ {formatMedDate(medication.endDate)}</span>
                          )}
                        </div>
                        {!discontinued && formatMedicationConcentration(medication) && (
                          <p className="mt-1 text-xs text-slate-500">濃度 {formatMedicationConcentration(medication)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score Trend Chart Dialog */}
          <ScoreTrendChart
            isOpen={scoreTrendOpen}
            onClose={onCloseScoreTrend}
            scoreType={scoreTrendType}
            trendData={scoreTrendData}
            scoreEntries={scoreEntries}
            onDeleteEntry={onDeleteScoreEntry}
          />

          <Dialog open={editingMedication !== null} onOpenChange={(open) => { if (!open) closeMedicationEditor(); }}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>編輯用藥</DialogTitle>
                <DialogDescription>
                  可直接維護劑量、頻次、途徑與濃度欄位。濃度留空時，PAD 工作台才會要求手動補填。
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border bg-slate-50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{editingMedication?.name || '—'}</p>
                  <p className="mt-1 text-xs text-slate-500">{editingMedication?.genericName || '未提供 generic name'}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="med-dose">Dose</Label>
                    <Input id="med-dose" value={editForm.dose} onChange={(e) => handleEditFieldChange('dose', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-unit">Unit</Label>
                    <Input id="med-unit" value={editForm.unit} onChange={(e) => handleEditFieldChange('unit', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-concentration">濃度</Label>
                    <Input
                      id="med-concentration"
                      placeholder="例 10"
                      value={editForm.concentration}
                      onChange={(e) => handleEditFieldChange('concentration', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-concentration-unit">濃度單位</Label>
                    <Input
                      id="med-concentration-unit"
                      placeholder="例 mcg/mL"
                      value={editForm.concentrationUnit}
                      onChange={(e) => handleEditFieldChange('concentrationUnit', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-frequency">Frequency</Label>
                    <Input id="med-frequency" value={editForm.frequency} onChange={(e) => handleEditFieldChange('frequency', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-route">Route</Label>
                    <Input id="med-route" value={editForm.route} onChange={(e) => handleEditFieldChange('route', e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="med-indication">Indication / Notes</Label>
                  <Textarea
                    id="med-indication"
                    rows={4}
                    value={editForm.indication}
                    onChange={(e) => handleEditFieldChange('indication', e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeMedicationEditor} disabled={isSavingMedication}>
                  取消
                </Button>
                <Button onClick={handleSaveMedication} disabled={isSavingMedication || !patientId}>
                  {isSavingMedication ? '儲存中...' : '儲存變更'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </TabsContent>
  );
}
