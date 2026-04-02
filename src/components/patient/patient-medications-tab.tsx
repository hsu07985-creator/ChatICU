import { useState } from 'react';
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
import { LabTrendChart } from '../lab-trend-chart';
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

const PAIN_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const RASS_VALUES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4];

function ScoreButtonRow({
  values,
  currentValue,
  onSelect,
}: {
  values: number[];
  currentValue: number | null;
  onSelect: (v: number) => void;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => {
          const isActive = currentValue === v && pending === null;
          const isPending = pending === v;
          const label = v > 0 ? `+${v}` : `${v}`;
          const buttonStyle = isPending
            ? {
                backgroundColor: '#f6ecf1',
                color: '#7f265b',
                borderColor: '#d9b6c8',
                boxShadow: '0 0 0 2px #e8d4df',
              }
            : isActive
              ? {
                  backgroundColor: '#7f265b',
                  color: '#ffffff',
                  borderColor: '#7f265b',
                }
              : undefined;
          return (
            <button
              key={v}
              disabled={submitting}
              className={`
                min-w-[40px] h-10 rounded-lg text-sm font-semibold border-2 transition-colors
                ${isPending
                  ? ''
                  : isActive
                    ? ''
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-[#fbf4f8] hover:border-[#d9b6c8] hover:text-[#7f265b]'
                }
                ${submitting ? 'opacity-50' : ''}
              `}
              style={buttonStyle}
              onClick={() => setPending(pending === v ? null : v)}
            >
              {values[0] < 0 && v >= 0 ? label : v}
            </button>
          );
        })}
      </div>
      {pending !== null && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 px-4 text-sm"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? '記錄中...' : `確認記錄 ${values[0] < 0 && pending > 0 ? `+${pending}` : pending}`}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-sm text-muted-foreground"
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
  onCloseScoreTrend,
  onRefreshMedications,
}: PatientMedicationsTabProps) {
  const [hidePrn, setHidePrn] = useState(false);
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

  const prnCount = otherMedications.filter(isPrnOrStat).length;
  const displayedOtherMeds = hidePrn
    ? otherMedications.filter((m) => !isPrnOrStat(m))
    : otherMedications;
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
    <TabsContent value="meds" className="space-y-4" style={{ paddingBottom: '10rem' }}>
      {medicationsLoading ? (
        <MedicationsSkeleton />
      ) : (
        <>
          {/* S/A/N 藥物 */}
          <div className="grid gap-3 md:grid-cols-3">
            {/* Pain (A) */}
            <Card className="border-[#e5e7eb]">
              <CardHeader className="pb-2 space-y-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800">Pain 止痛</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-[#7f265b] hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('pain')}
                  >
                    📈 趨勢
                  </Button>
                </div>
                <CardDescription className="text-sm leading-tight">
                  {painIndication || 'Pain Score: -'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ScoreButtonRow
                  values={PAIN_VALUES}
                  currentValue={painScoreValue}
                  onSelect={(v) => onRecordScore('pain', v)}
                />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">止痛藥物</p>
                  {painMedications.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">無止痛藥物</p>
                  ) : (
                    <div className="space-y-2">
                      {painMedications.map((medication) => (
                        <div key={medication.id} className="rounded-md border bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium leading-tight">{formatDisplayValue(medication.name)}</p>
                            {canEditMedication && patientId && (
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
                          <p className="mt-1 text-sm text-muted-foreground">{formatMedicationRegimen(medication)}</p>
                          {formatMedicationConcentration(medication) && (
                            <p className="mt-1 text-xs text-slate-500">濃度 {formatMedicationConcentration(medication)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sedation (S) */}
            <Card className="border-[#e5e7eb]">
              <CardHeader className="pb-2 space-y-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800">Sedation 鎮靜</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-[#7f265b] hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('rass')}
                  >
                    📈 趨勢
                  </Button>
                </div>
                <CardDescription className="text-sm leading-tight">
                  {sedationIndication || 'RASS Score: -/+4'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ScoreButtonRow
                  values={RASS_VALUES}
                  currentValue={rassScoreValue}
                  onSelect={(v) => onRecordScore('rass', v)}
                />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">鎮靜藥物</p>
                  {sedationMedications.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">無鎮靜藥物</p>
                  ) : (
                    <div className="space-y-2">
                      {sedationMedications.map((medication) => (
                        <div key={medication.id} className="rounded-md border bg-white px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-medium leading-tight">{formatDisplayValue(medication.name)}</p>
                            {canEditMedication && patientId && (
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
                          <p className="mt-1 text-sm text-muted-foreground">{formatMedicationRegimen(medication)}</p>
                          {formatMedicationConcentration(medication) && (
                            <p className="mt-1 text-xs text-slate-500">濃度 {formatMedicationConcentration(medication)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Neuromuscular Blockade (N) */}
            <Card className="border-[#e5e7eb]">
              <CardHeader className="pb-2 space-y-1">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800">Neuromuscular Blockade 神經肌肉阻斷</CardTitle>
                <CardDescription className="text-sm leading-tight">
                  {nmbIndication || '-'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">神經肌肉阻斷藥物</p>
                {nmbMedications.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">無神經肌肉阻斷藥物</p>
                ) : (
                  <div className="space-y-2">
                    {nmbMedications.map((medication) => (
                      <div key={medication.id} className="rounded-md border bg-white px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium leading-tight">{formatDisplayValue(medication.name)}</p>
                          {canEditMedication && patientId && (
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
                        <p className="mt-1 text-sm text-muted-foreground">{formatMedicationRegimen(medication)}</p>
                        {formatMedicationConcentration(medication) && (
                          <p className="mt-1 text-xs text-slate-500">濃度 {formatMedicationConcentration(medication)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Other Medications */}
          <Card className="border-[#e5e7eb]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800">其他藥物 Other Medications</CardTitle>
                {prnCount > 0 && (
                  <Button
                    variant={hidePrn ? 'outline' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setHidePrn(!hidePrn)}
                  >
                    {hidePrn ? `顯示 PRN/STAT (${prnCount})` : `隱藏 PRN/STAT (${prnCount})`}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="mb-2 text-xs font-medium text-muted-foreground">其他藥物清單</p>
              {displayedOtherMeds.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {hidePrn && otherMedications.length > 0 ? `已隱藏 ${prnCount} 項 PRN/STAT 藥物` : '無其他藥物'}
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {displayedOtherMeds.map((medication) => {
                    const category = MED_CATEGORY_LABELS[medication.category];
                    const abx = isAntibiotic(medication);
                    const prn = isPrnOrStat(medication);
                    const isStat = medication.frequency?.toUpperCase() === 'STAT';
                    return (
                      <div key={medication.id} className={`rounded-md border px-3 py-2 ${abx ? 'bg-amber-50 border-amber-200' : 'bg-[rgba(196,196,196,0.15)]'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium leading-tight">{formatDisplayValue(medication.name)}</p>
                            {abx && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-amber-100 text-amber-800">
                                抗生素
                              </Badge>
                            )}
                            {prn && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-violet-100 text-violet-800">
                                {isStat ? 'STAT' : 'PRN'}
                              </Badge>
                            )}
                            {category && !abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 ${category.color}`}>
                                {category.label}
                              </Badge>
                            )}
                          </div>
                          {canEditMedication && patientId && (
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
                        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{formatMedicationRegimen(medication)}</span>
                          {medication.startDate && (
                            <span className="text-xs text-muted-foreground/70">{formatMedDate(medication.startDate)}</span>
                          )}
                        </div>
                        {formatMedicationConcentration(medication) && (
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
          <LabTrendChart
            isOpen={scoreTrendOpen}
            onClose={onCloseScoreTrend}
            labName={scoreTrendType === 'pain' ? 'Pain Score' : 'RASS Score'}
            labNameChinese={scoreTrendType === 'pain' ? '疼痛分數' : '鎮靜分數'}
            unit={scoreTrendType === 'pain' ? '分 (0-10)' : '分 (-5~+4)'}
            trendData={scoreTrendData}
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
