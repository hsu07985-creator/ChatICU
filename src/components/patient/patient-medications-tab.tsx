import { useState, useMemo, useCallback } from 'react';
import type { Medication } from '../../lib/api';
import type { DrugInteraction as ApiDrugInteraction } from '../../lib/api/medications';
import type { UserRole } from '../../lib/auth-context';
import { isAntibiotic } from '../../lib/antibiotic-codes';
import { updateMedication } from '../../lib/api/medications';
import { DrugInteractionBadges, type DrugInteraction as BadgeDrugInteraction } from './drug-interaction-badges';
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

/** 判定門診藥物是否已過期（endDate 已過） */
function isOutpatientExpired(med: Medication): boolean {
  if (!med.endDate) return false;
  const end = new Date(med.endDate);
  if (isNaN(end.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

/** 取得門診藥物的服用狀態 */
function getOutpatientStatus(med: Medication): { label: string; color: string } {
  if (med.status === 'discontinued') return { label: '已停用', color: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300' };
  if (isOutpatientExpired(med)) return { label: '已過期', color: 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400' };
  return { label: '服用中', color: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' };
}

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
  antibiotic: { label: '抗生素', color: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300' },
  antifungal: { label: '抗黴菌', color: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300' },
  antiviral: { label: '抗病毒', color: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300' },
  vasopressor: { label: '升壓劑', color: 'bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-300' },
  anticoagulant: { label: '抗凝血', color: 'bg-rose-100 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300' },
  steroid: { label: '類固醇', color: 'bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300' },
  ppi: { label: 'PPI', color: 'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300' },
  h2_blocker: { label: 'H2 Blocker', color: 'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300' },
  diuretic: { label: '利尿劑', color: 'bg-cyan-100 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-300' },
  insulin: { label: '胰島素', color: 'bg-teal-100 dark:bg-teal-950/30 text-teal-800 dark:text-teal-300' },
  electrolyte: { label: '電解質', color: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300' },
  bronchodilator: { label: '支氣管擴張', color: 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300' },
  antiarrhythmic: { label: '抗心律不整', color: 'bg-pink-100 dark:bg-pink-950/30 text-pink-800 dark:text-pink-300' },
  antiepileptic: { label: '抗癲癇', color: 'bg-purple-100 dark:bg-purple-950/30 text-purple-800 dark:text-purple-300' },
  laxative: { label: '緩瀉劑', color: 'bg-lime-100 dark:bg-lime-950/30 text-lime-800 dark:text-lime-300' },
  antiemetic: { label: '止吐', color: 'bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-300' },
};

/** Pain 0-10 色階：綠→黃→橙→紅 */
function painColor(v: number): string {
  if (v <= 1) return 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
  if (v <= 3) return 'bg-lime-100 dark:bg-lime-950/30 text-lime-700 dark:text-lime-400 border-lime-200 dark:border-lime-800';
  if (v <= 5) return 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
  if (v <= 7) return 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800';
  return 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
}

/** RASS -5~+4 色階：深藍(深鎮靜)→淡藍→綠(平靜)→橙→紅(躁動) */
function rassColor(v: number): string {
  if (v <= -3) return 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800';
  if (v <= -1) return 'bg-sky-100 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800';
  if (v === 0) return 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
  if (v <= 2) return 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
  return 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
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
          const color = colorFn ? colorFn(v) : 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
          return (
            <button
              key={v}
              type="button"
              disabled={submitting}
              onClick={() => setPending(v)}
              className={`flex-1 py-1.5 text-xs font-semibold tabular-nums rounded transition-all border
                ${isSelected
                  ? `${color} ring-2 ring-brand ring-offset-1 scale-105 shadow-sm`
                  : 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-700 dark:hover:text-gray-300 hover:scale-105'
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
  onDetail,
}: {
  medication: Medication;
  canEdit: boolean;
  patientId?: string;
  onEdit: (med: Medication) => void;
  onDetail: (med: Medication) => void;
}) {
  const spec = medication.concentration || null;
  const noteText = medication.notes || null;

  return (
    <div className="rounded-md border dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 space-y-1.5 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onDetail(medication)}>
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
        <div className="rounded bg-slate-100 dark:bg-slate-800 px-2.5 py-2">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">醫令備註</p>
          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{noteText}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Medication Detail Modal ─── */
function MedicationDetailModal({
  medication,
  open,
  onClose,
}: {
  medication: Medication | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!medication) return null;
  const med = medication;
  const isOutpatient = med.sourceType === 'outpatient';
  const hasSource = isOutpatient || med.prescribingDepartment || med.prescribingDoctorName;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg leading-tight">
            {med.name}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {[med.dose, med.unit, '·', med.frequency].filter(Boolean).join(' ')}
          </DialogDescription>
        </DialogHeader>

        {/* Status badge */}
        <div className="flex gap-2 flex-wrap">
          {isOutpatient ? (
            <>
              {(() => { const s = getOutpatientStatus(med); return <Badge className={`${s.color} border-0`}>{s.label}</Badge>; })()}
              <Badge className="bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-0">門診用藥</Badge>
            </>
          ) : (
            <>
              {med.status === 'active' && (
                <Badge className="bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-0">使用中</Badge>
              )}
              {med.status === 'on-hold' && (
                <Badge className="bg-yellow-100 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 border-0">暫停</Badge>
              )}
              {(med.status === 'discontinued' || med.status === 'completed' || med.status === 'inactive') && (
                <Badge className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-0">
                  {med.status === 'completed' ? '療程完成' : med.status === 'inactive' ? '未啟用' : '已停用'}
                </Badge>
              )}
            </>
          )}
          {med.isExternal && (
            <Badge className="bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-0">院外</Badge>
          )}
        </div>

        {/* 處方來源 */}
        {hasSource && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">處方來源</p>
            <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {isOutpatient && (
                  <>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">院內/院外</span>
                      <Badge variant="secondary" className={`text-xs h-5 ${med.isExternal ? 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400' : 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'}`}>
                        {med.isExternal ? '院外' : '院內'}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">開立醫院</span>
                      <span className="font-medium">{med.prescribingHospital || '—'}</span>
                    </div>
                  </>
                )}
                {med.prescribingDepartment && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">處方科別</span>
                    <span className="font-medium">{med.prescribingDepartment}</span>
                  </div>
                )}
                {med.prescribingDoctorName && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">處方醫師</span>
                    <span className="font-medium">{med.prescribingDoctorName}</span>
                  </div>
                )}
                {med.sourceCampus && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">院區</span>
                    <span className="font-medium">{med.sourceCampus}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 處方明細 */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">處方明細</p>
          <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">學名</span>
                <span className="font-medium">{med.genericName || '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">頻率</span>
                <span className="font-medium">{med.frequency || '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">劑量</span>
                <span className="font-medium">{[med.dose, med.unit].filter(Boolean).join(' ') || '—'}</span>
              </div>
              {med.daysSupply != null && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">給藥天數</span>
                  <span className="font-medium">{med.daysSupply} 天</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">給藥途徑</span>
                <span className="font-medium">{med.route || '—'}</span>
              </div>
              {med.concentration && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">濃度</span>
                  <span className="font-medium">{[med.concentration, med.concentrationUnit].filter(Boolean).join(' ')}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">開始日期</span>
                <span className="font-medium">{med.startDate ? new Date(med.startDate).toLocaleDateString('zh-TW') : '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">結束日期</span>
                <span className="font-medium">{med.endDate ? new Date(med.endDate).toLocaleDateString('zh-TW') : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 適應症 / 備註 */}
        {(med.indication || med.notes) && (
          <div className="space-y-2">
            {med.indication && (
              <div className="text-sm">
                <span className="text-muted-foreground">適應症：</span>
                <span>{med.indication}</span>
              </div>
            )}
            {med.notes && (
              <div className="rounded bg-slate-100 dark:bg-slate-800 px-2.5 py-2">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">醫令備註</p>
                <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{med.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Warnings */}
        {med.warnings && med.warnings.length > 0 && (
          <div className="space-y-1">
            {med.warnings.map((w, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1">
                <span>⚠</span><span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>關閉</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Extract a comparison key for duplicate detection.
 *  Priority: actual generic from parentheses > genericName field > brand prefix.
 *  Returns alpha-only lowercase string to handle Tall Man Lettering. */
function medCompareKey(med: Medication): string {
  // 1. Try to extract actual generic from parenthesized content in drug name
  //    e.g. "Seroquel [25mg] tab (Quetiapine)" → "quetiapine"
  //    e.g. "[包] Actein 發泡顆粒 600mg (Acetylcysteine)" → "acetylcysteine"
  const parens = [...(med.name || '').matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim());
  for (let i = parens.length - 1; i >= 0; i--) {
    const p = parens[i];
    // Skip non-drug markers: 抗3, 軟袋, digits, ml suffix
    if (/^[抗軟]/.test(p) || /^\d/.test(p) || /ml$/i.test(p)) continue;
    // Take first semicolon segment if compound
    const first = p.includes(';') ? p.split(';')[0].trim() : p;
    const alpha = first.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (alpha.length >= 3) return alpha;
  }
  // 2. Fall back to genericName field (brand prefix from converter)
  const gn = (med.genericName || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (gn.length >= 3) return gn;
  // 3. Last resort: first English word from name
  const fw = (med.name || '').match(/^(?:\[.*?\]\s*)*([A-Za-z]{3,})/);
  return fw ? fw[1].toLowerCase() : '';
}

interface DuplicateMedGroup {
  generic: string;        // display name (actual generic when available)
  inpatient: Medication[];
  outpatient: Medication[];
}

function detectDuplicates(
  inpatientMeds: Medication[],
  outpatientMeds: Medication[],
): DuplicateMedGroup[] {
  // Build map: comparison key → inpatient meds
  const inpMap = new Map<string, Medication[]>();
  for (const m of inpatientMeds) {
    const key = medCompareKey(m);
    if (!key) continue;
    const arr = inpMap.get(key) || [];
    arr.push(m);
    inpMap.set(key, arr);
  }

  // Check outpatient meds against the inpatient map
  const result = new Map<string, DuplicateMedGroup>();
  for (const m of outpatientMeds) {
    const key = medCompareKey(m);
    if (!key || !inpMap.has(key)) continue;
    if (!result.has(key)) {
      // Display the actual generic from parentheses if available
      const parens = [...(m.name || '').matchAll(/\(([^)]+)\)/g)].map(p => p[1].trim());
      const displayGeneric = parens.filter(p => /^[A-Za-z]/.test(p) && !/^[抗軟]/.test(p)).pop();
      result.set(key, {
        generic: displayGeneric || m.genericName || m.name,
        inpatient: inpMap.get(key)!,
        outpatient: [],
      });
    }
    result.get(key)!.outpatient.push(m);
  }

  return [...result.values()];
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
  outpatientMedications?: Medication[];
  drugInteractions?: ApiDrugInteraction[];
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
  outpatientMedications,
  drugInteractions,
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
  const [medView, setMedView] = useState<'active' | 'discontinued' | 'all' | 'duplicate'>('active');
  const [filterPrn, setFilterPrn] = useState(false);
  const [detailMedication, setDetailMedication] = useState<Medication | null>(null);
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
    med.status === 'discontinued' || med.status === 'completed' || med.status === 'inactive' || med.status === 'on-hold';

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

  // Outpatient medications — grouped by prescribing department, sorted by startDate ascending
  const allOutpatientMeds = outpatientMedications || [];
  const activeOutpatientMeds = allOutpatientMeds.filter((m) => !isOutpatientExpired(m) && m.status !== 'discontinued');
  const outpatientCount = allOutpatientMeds.length;

  // Group outpatient meds by department, then sort by startDate within each group
  const outpatientByDept = useMemo(() => {
    const sorted = [...allOutpatientMeds].sort((a, b) =>
      (a.startDate || '').localeCompare(b.startDate || ''),
    );
    const groups = new Map<string, Medication[]>();
    for (const med of sorted) {
      const dept = med.prescribingDepartment || '未標示科別';
      const arr = groups.get(dept) || [];
      arr.push(med);
      groups.set(dept, arr);
    }
    return groups;
  }, [allOutpatientMeds]);

  // Current base list depends on view mode
  const baseMeds = medView === 'active' ? activeOtherMeds : medView === 'discontinued' ? allDiscontinuedMeds : allOtherMeds;
  const prnCount = baseMeds.filter(isPrnOrStat).length;

  // Sort by prescription start date ascending (earliest first)
  const sortOtherMeds = (meds: Medication[]) => [...meds].sort((a, b) => {
    const dateA = a.startDate || '';
    const dateB = b.startDate || '';
    return dateA.localeCompare(dateB);
  });

  const applyFilters = (meds: Medication[]) => meds
    .filter((m) => !filterPrn || isPrnOrStat(m));

  const clearSubFilters = () => { setFilterPrn(false); };

  const displayedMeds = applyFilters(sortOtherMeds(baseMeds));
  const canEditMedication = userRole === 'doctor' || userRole === 'np' || userRole === 'pharmacist';

  // Duplicate medication detection: same generic across inpatient ↔ outpatient (active only)
  const duplicateMeds = useMemo(() => {
    const allActiveInpatient = [...activePainMeds, ...activeSedationMeds, ...activeNmbMeds, ...activeOtherMeds];
    return detectDuplicates(allActiveInpatient, activeOutpatientMeds);
  }, [activePainMeds, activeSedationMeds, activeNmbMeds, activeOtherMeds, activeOutpatientMeds]);

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
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">Pain 止痛</CardTitle>
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
                        <SanMedCard key={medication.id} medication={medication} canEdit={canEditMedication} patientId={patientId} onEdit={openMedicationEditor} onDetail={setDetailMedication} />
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
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">Sedation 鎮靜</CardTitle>
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
                        <SanMedCard key={medication.id} medication={medication} canEdit={canEditMedication} patientId={patientId} onEdit={openMedicationEditor} onDetail={setDetailMedication} />
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Neuromuscular Blockade (N) */}
            <Card className="border-border">
              <CardHeader className="pb-2 space-y-1">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">Neuromuscular Blockade 神經肌肉阻斷</CardTitle>
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
                      <SanMedCard key={medication.id} medication={medication} canEdit={canEditMedication} patientId={patientId} onEdit={openMedicationEditor} onDetail={setDetailMedication} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Inpatient Medications */}
          <Card className={`border-border ${medView === 'discontinued' ? 'border-dashed' : ''}`}>
            <CardHeader className="pb-2 space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">住院用藥 Inpatient Medications</CardTitle>
              </div>
              {/* Primary toggle: active vs discontinued */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'all' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => { setMedView('all'); clearSubFilters(); }}
                  >
                    全部 ({totalCount})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'active' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => { setMedView('active'); clearSubFilters(); }}
                  >
                    使用中 ({activeCount})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={discontinuedCount === 0}
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'discontinued' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => { setMedView('discontinued'); clearSubFilters(); }}
                  >
                    已停用 ({discontinuedCount})
                  </Button>
                </div>
                {duplicateMeds.length > 0 && (
                  <Button
                    variant={medView === 'duplicate' ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 px-2 text-xs ${medView === 'duplicate' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30'}`}
                    onClick={() => { setMedView(medView === 'duplicate' ? 'active' : 'duplicate'); clearSubFilters(); }}
                  >
                    重複用藥 ({duplicateMeds.length})
                  </Button>
                )}
                {prnCount > 0 && (
                  <Button
                    variant={filterPrn ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 px-2 text-xs ${filterPrn ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30'}`}
                    onClick={() => setFilterPrn(!filterPrn)}
                  >
                    PRN/STAT ({prnCount})
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {drugInteractions && drugInteractions.length > 0 && medView !== 'discontinued' && medView !== 'duplicate' && (() => {
                const mapped: BadgeDrugInteraction[] = drugInteractions.map((i) => ({
                  drug_a: i.drug1,
                  drug_b: i.drug2,
                  risk: i.riskRating || (i.severity === 'major' ? 'D' : i.severity === 'moderate' ? 'C' : 'B'),
                  title: i.clinicalEffect || i.mechanism || '',
                  severity: i.severity,
                }));
                const hasRiskX = mapped.some((m) => m.risk.toUpperCase() === 'X');
                return <DrugInteractionBadges interactions={mapped} hasRiskX={hasRiskX} />;
              })()}
              {medView === 'duplicate' ? (
                <div className="space-y-2">
                  <p className="text-xs text-orange-700 dark:text-orange-400 mb-2">
                    以下藥物同時出現在住院醫令與門診處方中（以學名比對），請確認是否需要調整
                  </p>
                  {duplicateMeds.map((dup) => (
                    <div key={dup.generic} className="rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="font-semibold text-sm text-orange-900 dark:text-orange-300">{dup.generic}</p>
                        <Badge className="bg-orange-200 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-950/30 text-xs px-1.5 py-0 h-4">
                          住院+門診
                        </Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {dup.inpatient.map((m) => (
                          <div
                            key={m.id}
                            className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 cursor-pointer hover:shadow-sm transition-shadow"
                            onClick={() => setDetailMedication(m)}
                          >
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 shrink-0">住院</Badge>
                              <span className="text-sm font-medium truncate">{m.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[m.dose && m.unit ? `${m.dose} ${m.unit}` : null, m.frequency, m.route].filter(Boolean).join(' / ')}
                              {m.startDate && ` (${formatMedDate(m.startDate)})`}
                            </p>
                          </div>
                        ))}
                        {dup.outpatient.map((m) => (
                          <div
                            key={m.id}
                            className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-2.5 py-1.5 cursor-pointer hover:shadow-sm transition-shadow"
                            onClick={() => setDetailMedication(m)}
                          >
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 shrink-0">門診</Badge>
                              <span className="text-sm font-medium truncate">{m.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[m.dose && m.unit ? `${m.dose} ${m.unit}` : null, m.frequency, m.route].filter(Boolean).join(' / ')}
                              {m.prescribingDepartment && ` [${m.prescribingDepartment}]`}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
              <>
              {medView === 'discontinued' && (
                <p className="mb-2 text-xs text-muted-foreground">本次住院期間曾使用，現已停用的藥品</p>
              )}
              {displayedMeds.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {filterPrn ? '無 PRN/STAT 藥物' : medView === 'discontinued' ? '無已停用藥物' : medView === 'all' ? '無藥物' : '無住院用藥'}
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {displayedMeds.map((medication) => {
                    const category = MED_CATEGORY_LABELS[medication.category];
                    const abx = isAntibiotic(medication);
                    const prn = isPrnOrStat(medication);
                    const isStat = medication.frequency?.toUpperCase() === 'STAT';
                    const discontinued = isDiscontinued(medication);
                    const statusLabel = medication.status === 'completed' ? '療程完成' : medication.status === 'inactive' ? '未啟用' : medication.status === 'on-hold' ? '暫停' : '已停用';
                    return (
                      <div
                        key={medication.id}
                        className={`rounded-md border px-3 py-2 cursor-pointer hover:shadow-md transition-shadow ${
                          discontinued
                            ? 'border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-slate-800 opacity-75'
                            : abx
                              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                              : 'bg-[rgba(196,196,196,0.15)] dark:bg-slate-800/50'
                        }`}
                        onClick={() => setDetailMedication(medication)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-medium leading-tight ${discontinued ? 'text-gray-500 dark:text-gray-400 line-through' : ''}`}>
                              {formatDisplayValue(medication.name)}
                            </p>
                            {discontinued ? (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                {statusLabel}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                                使用中
                              </Badge>
                            )}
                            {abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 ${discontinued ? 'opacity-60' : ''}`}>
                                抗生素
                              </Badge>
                            )}
                            {prn && !discontinued && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-violet-100 dark:bg-violet-950/30 text-violet-800 dark:text-violet-300">
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
                        <div className={`mt-1 flex items-center gap-2 text-sm ${discontinued ? 'text-gray-400 dark:text-gray-500' : 'text-muted-foreground'}`}>
                          <span>{formatMedicationRegimen(medication)}</span>
                          {medication.startDate && (
                            <span className="text-xs">{formatMedDate(medication.startDate)}</span>
                          )}
                          {discontinued && medication.endDate && (
                            <span className="text-xs">→ {formatMedDate(medication.endDate)}</span>
                          )}
                        </div>
                        {!discontinued && formatMedicationConcentration(medication) && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">濃度 {formatMedicationConcentration(medication)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </>
              )}
            </CardContent>
          </Card>

          {/* Outpatient Medications — grouped by prescribing department */}
          {outpatientCount > 0 && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">
                  門診用藥 Outpatient Medications
                  <span className="ml-2 text-sm font-normal text-muted-foreground">({outpatientCount})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {[...outpatientByDept.entries()].map(([dept, meds]) => (
                  <div key={dept}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                        {dept}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{meds.length} 筆</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {meds.map((medication) => (
                        <div
                          key={medication.id}
                          className="rounded-md border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 px-3 py-2 cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => setDetailMedication(medication)}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium leading-tight">
                              {formatDisplayValue(medication.name)}
                            </p>
                            {medication.sourceCampus && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                                {medication.sourceCampus}
                              </Badge>
                            )}
                            {medication.isExternal && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
                                院外
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{formatMedicationRegimen(medication)}</span>
                            {medication.daysSupply != null && (
                              <span className="text-xs">({medication.daysSupply}天)</span>
                            )}
                          </div>
                          {medication.startDate && (
                            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                              開立 {formatMedDate(medication.startDate)}
                              {medication.endDate && <span> → {formatMedDate(medication.endDate)}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Score Trend Chart Dialog */}
          <ScoreTrendChart
            isOpen={scoreTrendOpen}
            onClose={onCloseScoreTrend}
            scoreType={scoreTrendType}
            trendData={scoreTrendData}
            scoreEntries={scoreEntries}
            onDeleteEntry={onDeleteScoreEntry}
          />

          <MedicationDetailModal
            medication={detailMedication}
            open={detailMedication !== null}
            onClose={() => setDetailMedication(null)}
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
                <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{editingMedication?.name || '—'}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{editingMedication?.genericName || '未提供 generic name'}</p>
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
