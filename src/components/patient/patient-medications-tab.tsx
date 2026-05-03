import { lazy, Suspense, useState, useMemo, useCallback } from 'react';
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
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';

// Lazy-load recharts-backed trend chart (H4: keep 411 KB charts-*.js off the critical path)
const ScoreTrendChart = lazy(() =>
  import('../score-trend-chart').then((m) => ({ default: m.ScoreTrendChart }))
);

const PRN_FREQ_PATTERN = /PRN|STAT/i;

/**
 * 正規化藥物劑量顯示值：整數值去掉 .0（避免 1.0 被看成 10），
 * 有意義的小數（0.5、0.25）保留。非數字（「適量」）原樣返回。
 */
function formatDoseValue(dose: unknown): string {
  if (dose === null || dose === undefined) return '';
  const raw = typeof dose === 'string' ? dose.trim() : String(dose);
  if (raw === '') return '';
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  return String(num);
}

/** 判定門診藥物是否已過期（endDate 已過） */
function isOutpatientExpired(med: Medication): boolean {
  if (!med.endDate) return false;
  const end = new Date(med.endDate);
  if (isNaN(end.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

/** 取得門診藥物的服用狀態（key 用於 t() lookup） */
function getOutpatientStatus(med: Medication): { labelKey: 'discontinued' | 'expired' | 'active'; color: string } {
  if (med.status === 'discontinued') return { labelKey: 'discontinued', color: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300' };
  if (isOutpatientExpired(med)) return { labelKey: 'expired', color: 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400' };
  return { labelKey: 'active', color: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' };
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
  return d.toLocaleDateString(i18n.language, { month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatMedDateFromDate(date?: Date | null): string {
  if (!date || isNaN(date.getTime())) return '';
  return date.toLocaleDateString(i18n.language, { month: '2-digit', day: '2-digit' })
    + ' ' + date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function parseMedicationTime(dateStr?: string | null): number {
  if (!dateStr) return Number.NEGATIVE_INFINITY;
  const time = new Date(dateStr).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function formatOutpatientGroupDate(dateStr?: string | null, fallback: string = '未標示日期'): string {
  if (!dateStr) return fallback;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return fallback;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getMedicationEndDate(medication: Medication): Date | null {
  if (medication.endDate) {
    const explicitEnd = new Date(medication.endDate);
    if (!isNaN(explicitEnd.getTime())) return explicitEnd;
  }
  if (!medication.startDate || medication.daysSupply == null || medication.daysSupply <= 0) {
    return null;
  }
  const start = new Date(medication.startDate);
  if (isNaN(start.getTime())) return null;
  const calculatedEnd = new Date(start);
  calculatedEnd.setDate(calculatedEnd.getDate() + medication.daysSupply - 1);
  return calculatedEnd;
}

function formatCalendarDate(date?: Date | null): string {
  if (!date || isNaN(date.getTime())) return '';
  return date.toLocaleDateString(i18n.language);
}

function formatMedicationConcentration(medication: Medication): string | null {
  if (!medication.concentration) return null;
  return [medication.concentration, medication.concentrationUnit].filter(Boolean).join(' ');
}

// Color only — labels come from t('medications:tab.categories.<key>')
const MED_CATEGORY_COLORS: Record<string, string> = {
  antibiotic: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  antifungal: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  antiviral: 'bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  vasopressor: 'bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-300',
  anticoagulant: 'bg-rose-100 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300',
  steroid: 'bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300',
  ppi: 'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300',
  h2_blocker: 'bg-sky-100 dark:bg-sky-950/30 text-sky-800 dark:text-sky-300',
  diuretic: 'bg-cyan-100 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-300',
  insulin: 'bg-teal-100 dark:bg-teal-950/30 text-teal-800 dark:text-teal-300',
  electrolyte: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300',
  bronchodilator: 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300',
  antiarrhythmic: 'bg-pink-100 dark:bg-pink-950/30 text-pink-800 dark:text-pink-300',
  antiepileptic: 'bg-purple-100 dark:bg-purple-950/30 text-purple-800 dark:text-purple-300',
  laxative: 'bg-lime-100 dark:bg-lime-950/30 text-lime-800 dark:text-lime-300',
  antiemetic: 'bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-300',
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

function formatScoreTimestamp(ts: string): string {
  return new Date(ts).toLocaleString(i18n.language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function ScoreSelector({
  min,
  max,
  currentValue,
  onSelect,
  onPendingChange,
  formatLabel,
  colorFn,
}: {
  min: number;
  max: number;
  currentValue: number | null;
  onSelect: (v: number) => void;
  onPendingChange?: (v: number | null) => void;
  formatLabel?: (v: number) => string;
  colorFn?: (v: number) => string;
}) {
  const { t } = useTranslation('medications');
  const [pending, setPending] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasPending = pending !== null && pending !== currentValue;
  const fmt = useCallback((v: number) => formatLabel ? formatLabel(v) : `${v}`, [formatLabel]);
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const updatePending = (v: number | null) => {
    setPending(v);
    onPendingChange?.(v);
  };

  const handleConfirm = async () => {
    if (pending === null) return;
    setSubmitting(true);
    try {
      await onSelect(pending);
      updatePending(null);
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
              onClick={() => updatePending(v)}
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
          <Button
            size="sm"
            className="h-7 px-3 text-xs font-medium bg-brand hover:bg-brand-hover rounded-md"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? t('tab.scoreSelector.saving') : t('tab.scoreSelector.confirm')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={submitting}
            onClick={() => updatePending(null)}
          >
            {t('tab.scoreSelector.cancel')}
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
  const { t } = useTranslation('medications');
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
            {t('tab.sanMedCard.edit')}
          </Button>
        )}
      </div>
      {noteText && (
        <div className="rounded bg-slate-100 dark:bg-slate-800 px-2.5 py-2">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('tab.sanMedCard.orderNote')}</p>
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
  const { t } = useTranslation('medications');
  if (!medication) return null;
  const med = medication;
  const isOutpatient = med.sourceType === 'outpatient' || med.sourceType === 'self-supplied';
  const hasSource = isOutpatient || med.prescribingDepartment || med.prescribingDoctorName;
  const displayEndDate = getMedicationEndDate(med);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg leading-tight">
            {med.name}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {[formatDoseValue(med.dose), med.unit, '·', med.frequency].filter(Boolean).join(' ')}
          </DialogDescription>
        </DialogHeader>

        {/* Status badge */}
        <div className="flex gap-2 flex-wrap">
          {isOutpatient ? (
            <>
              {(() => { const status = getOutpatientStatus(med); return <Badge className={`${status.color} border-0`}>{t(`tab.outpatient.${status.labelKey}`)}</Badge>; })()}
              <Badge className="bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-0">{t('tab.detailModal.outpatientLabel')}</Badge>
            </>
          ) : (
            <>
              {med.status === 'active' && (
                <Badge className="bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-0">{t('tab.detailModal.active')}</Badge>
              )}
              {med.status === 'on-hold' && (
                <Badge className="bg-yellow-100 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 border-0">{t('tab.detailModal.onHold')}</Badge>
              )}
              {(med.status === 'discontinued' || med.status === 'completed') && (
                <Badge className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-0">
                  {med.status === 'completed' ? t('tab.detailModal.completed') : t('tab.detailModal.discontinued')}
                </Badge>
              )}
            </>
          )}
          {med.sourceType === 'self-supplied' ? (
            <Badge className="bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-0">{t('tab.detailModal.selfSupplied')}</Badge>
          ) : med.isExternal ? (
            <Badge className="bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-0">{t('tab.detailModal.external')}</Badge>
          ) : null}
        </div>

        {/* 處方來源 */}
        {hasSource && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('tab.detailModal.sourceTitle')}</p>
            <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {isOutpatient && (
                  <>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">{t('tab.detailModal.sourceTypeLabel')}</span>
                      <Badge variant="secondary" className={`text-xs h-5 ${med.sourceType === 'self-supplied' ? 'bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400' : med.isExternal ? 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400' : 'bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'}`}>
                        {med.sourceType === 'self-supplied' ? t('tab.detailModal.selfSupplied') : med.isExternal ? t('tab.detailModal.external') : t('tab.detailModal.internal')}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">{t('tab.detailModal.hospitalLabel')}</span>
                      <span className="font-medium">{med.prescribingHospital || '—'}</span>
                    </div>
                  </>
                )}
                {med.prescribingDepartment && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">{t('tab.detailModal.deptLabel')}</span>
                    <span className="font-medium">{med.prescribingDepartment}</span>
                  </div>
                )}
                {med.prescribingDoctorName && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">{t('tab.detailModal.doctorLabel')}</span>
                    <span className="font-medium">{med.prescribingDoctorName}</span>
                  </div>
                )}
                {med.sourceCampus && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">{t('tab.detailModal.campusLabel')}</span>
                    <span className="font-medium">{med.sourceCampus}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 處方明細 */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('tab.detailModal.rxTitle')}</p>
          <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{t('tab.detailModal.genericLabel')}</span>
                <span className="font-medium">{med.genericName || '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{t('tab.detailModal.frequencyLabel')}</span>
                <span className="font-medium">{med.frequency || '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{t('tab.detailModal.doseLabel')}</span>
                <span className="font-medium">{[formatDoseValue(med.dose), med.unit].filter(Boolean).join(' ') || '—'}</span>
              </div>
              {med.daysSupply != null && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{t('tab.detailModal.daysSupplyLabel')}</span>
                  <span className="font-medium">{t('tab.detailModal.daysValue', { count: med.daysSupply })}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{t('tab.detailModal.routeLabel')}</span>
                <span className="font-medium">{med.route || '—'}</span>
              </div>
              {med.concentration && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{t('tab.detailModal.concentrationLabel')}</span>
                  <span className="font-medium">{[med.concentration, med.concentrationUnit].filter(Boolean).join(' ')}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{t('tab.detailModal.startDateLabel')}</span>
                <span className="font-medium">{med.startDate ? new Date(med.startDate).toLocaleDateString(i18n.language) : '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0">{t('tab.detailModal.endDateLabel')}</span>
                <span className="font-medium">{formatCalendarDate(displayEndDate)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 適應症 / 備註 */}
        {(med.indication || med.notes) && (
          <div className="space-y-2">
            {med.indication && (
              <div className="text-sm">
                <span className="text-muted-foreground">{t('tab.detailModal.indicationLabel')}</span>
                <span>{med.indication}</span>
              </div>
            )}
            {med.notes && (
              <div className="rounded bg-slate-100 dark:bg-slate-800 px-2.5 py-2">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t('tab.sanMedCard.orderNote')}</p>
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
          <Button variant="outline" onClick={onClose}>{t('tab.detailModal.close')}</Button>
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
  nmbIndication?: string;
  painMedications: Medication[];
  sedationMedications: Medication[];
  nmbMedications: Medication[];
  otherMedications: Medication[];
  outpatientMedications?: Medication[];
  formatDisplayValue: (value: unknown) => string;
  formatMedicationRegimen: (medication: Medication) => string;
  painScoreValue: number | null;
  rassScoreValue: number | null;
  painScoreTimestamp?: string | null;
  rassScoreTimestamp?: string | null;
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
  nmbIndication,
  painMedications,
  sedationMedications,
  nmbMedications,
  otherMedications,
  outpatientMedications,
  formatDisplayValue,
  formatMedicationRegimen,
  painScoreValue,
  rassScoreValue,
  painScoreTimestamp,
  rassScoreTimestamp,
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
  const { t } = useTranslation('medications');
  // medView：all=全部 / active=使用中 / regular=常規（使用中且非 PRN,STAT）/ discontinued=已停用 / duplicate=重複用藥
  const [medView, setMedView] = useState<'active' | 'regular' | 'discontinued' | 'all' | 'duplicate'>('active');
  const [painPending, setPainPending] = useState<number | null>(null);
  const [rassPending, setRassPending] = useState<number | null>(null);
  const [selfSuppliedFilter, setSelfSuppliedFilter] = useState(false);
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
    med.status === 'discontinued' || med.status === 'completed' || med.status === 'on-hold';

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
  const regularOtherMeds = activeOtherMeds.filter((m) => !isPrnOrStat(m));
  const activeCount = activeOtherMeds.length;
  const regularCount = regularOtherMeds.length;
  const discontinuedCount = allDiscontinuedMeds.length;
  const totalCount = allOtherMeds.length;

  // Outpatient medications — grouped by start date + department + days supply, sorted by nearest date first
  const allOutpatientMeds = outpatientMedications || [];
  const activeOutpatientMeds = allOutpatientMeds.filter((m) => !isOutpatientExpired(m) && m.status !== 'discontinued');
  const outpatientCount = allOutpatientMeds.length;
  const selfSuppliedMeds = allOutpatientMeds.filter((m) => m.sourceType === 'self-supplied');
  const visibleOutpatientMeds = selfSuppliedFilter ? selfSuppliedMeds : allOutpatientMeds;

  const outpatientGroups = useMemo(() => {
    const groups = new Map<string, { label: string; sortTime: number; meds: Medication[] }>();
    const medsSortedWithinGroup = [...visibleOutpatientMeds].sort((a, b) => {
      const timeDiff = parseMedicationTime(b.startDate) - parseMedicationTime(a.startDate);
      if (timeDiff !== 0) return timeDiff;
      return (a.name || '').localeCompare(b.name || '', 'zh-Hant');
    });

    for (const med of medsSortedWithinGroup) {
      const dept = med.prescribingDepartment || t('tab.outpatientGroup.noDept');
      const groupDate = formatOutpatientGroupDate(med.startDate, t('tab.outpatientGroup.noDate'));
      const key = `${groupDate}__${dept}`;
      const existing = groups.get(key);
      if (existing) {
        existing.meds.push(med);
        existing.sortTime = Math.max(existing.sortTime, parseMedicationTime(med.startDate));
        continue;
      }
      groups.set(key, {
        label: `${groupDate}${dept}`,
        sortTime: parseMedicationTime(med.startDate),
        meds: [med],
      });
    }

    return [...groups.values()].sort((a, b) => b.sortTime - a.sortTime);
  }, [visibleOutpatientMeds, t]);

  // Current base list depends on view mode
  const baseMeds =
    medView === 'active' ? activeOtherMeds
    : medView === 'regular' ? regularOtherMeds
    : medView === 'discontinued' ? allDiscontinuedMeds
    : allOtherMeds;

  // Sort by prescription start date ascending (earliest first)
  const sortOtherMeds = (meds: Medication[]) => [...meds].sort((a, b) => {
    const dateA = a.startDate || '';
    const dateB = b.startDate || '';
    return dateA.localeCompare(dateB);
  });

  const displayedMeds = sortOtherMeds(baseMeds);
  const canEditMedication = false;

  // Duplicate medication detection: same generic across inpatient ↔ outpatient (active only)
  const duplicateMeds = useMemo(() => {
    const allActiveInpatient = [...activePainMeds, ...activeSedationMeds, ...activeNmbMeds, ...activeOtherMeds];
    return detectDuplicates(allActiveInpatient, activeOutpatientMeds);
  }, [activePainMeds, activeSedationMeds, activeNmbMeds, activeOtherMeds, activeOutpatientMeds]);

  const openMedicationEditor = (medication: Medication) => {
    setEditingMedication(medication);
    setEditForm({
      dose: formatDoseValue(medication.dose),
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
      toast.success(t('tab.edit.saveSuccess'));
      setEditingMedication(null);
    } catch (error) {
      console.error(`${t('tab.edit.saveErrorLog')}:`, error);
      toast.error(t('tab.edit.saveError'));
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
                  <div className="flex items-baseline gap-2">
                    <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">Pain Score</CardTitle>
                    {(painPending ?? painScoreValue) !== null && (
                      <span className="text-2xl font-bold tabular-nums leading-none text-slate-900 dark:text-slate-100">
                        {painPending ?? painScoreValue}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('pain')}
                  >
                    {t('tab.main.trendButton')}
                  </Button>
                </div>
                {painPending === null && painScoreTimestamp && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('tab.main.lastRecorded', { timestamp: formatScoreTimestamp(painScoreTimestamp) })}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ScoreSelector
                  min={0}
                  max={10}
                  currentValue={painScoreValue}
                  onSelect={(v) => onRecordScore('pain', v)}
                  onPendingChange={setPainPending}
                  colorFn={painColor}
                />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tab.main.painMedsLabel')}</p>
                  {activePainMeds.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">{t('tab.main.painMedsEmpty')}</p>
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
                  <div className="flex items-baseline gap-2">
                    <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">RASS Score</CardTitle>
                    {(() => {
                      const display = rassPending ?? rassScoreValue;
                      if (display === null) return null;
                      return (
                        <span className="text-2xl font-bold tabular-nums leading-none text-slate-900 dark:text-slate-100">
                          {display > 0 ? `+${display}` : display}
                        </span>
                      );
                    })()}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]"
                    onClick={() => onOpenScoreTrend('rass')}
                  >
                    {t('tab.main.trendButton')}
                  </Button>
                </div>
                {rassPending === null && rassScoreTimestamp && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('tab.main.lastRecorded', { timestamp: formatScoreTimestamp(rassScoreTimestamp) })}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ScoreSelector
                  min={-5}
                  max={4}
                  currentValue={rassScoreValue}
                  onSelect={(v) => onRecordScore('rass', v)}
                  onPendingChange={setRassPending}
                  formatLabel={(v) => v > 0 ? `+${v}` : `${v}`}
                  colorFn={rassColor}
                />
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tab.main.sedationMedsLabel')}</p>
                  {activeSedationMeds.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">{t('tab.main.sedationMedsEmpty')}</p>
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
                <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">{t('tab.main.nmbCardTitle')}</CardTitle>
                <CardDescription className="text-sm leading-tight">
                  {nmbIndication || '-'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t('tab.main.nmbMedsLabel')}</p>
                {activeNmbMeds.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">{t('tab.main.nmbMedsEmpty')}</p>
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
                <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">{t('tab.main.inpatientCardTitle')}</CardTitle>
              </div>
              {/* 主要切換：全部 / 使用中 / 常規 / 已停用 */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'all' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('all')}
                  >
                    {t('tab.main.viewAll', { count: totalCount })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'active' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('active')}
                  >
                    {t('tab.main.viewActive', { count: activeCount })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={regularCount === 0}
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'regular' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('regular')}
                  >
                    {t('tab.main.viewRegular', { count: regularCount })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={discontinuedCount === 0}
                    className={`h-7 px-3 text-xs rounded-md ${medView === 'discontinued' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    onClick={() => setMedView('discontinued')}
                  >
                    {t('tab.main.viewDiscontinued', { count: discontinuedCount })}
                  </Button>
                </div>
                {duplicateMeds.length > 0 && (
                  <Button
                    variant={medView === 'duplicate' ? 'default' : 'outline'}
                    size="sm"
                    className={`h-7 px-2 text-xs ${medView === 'duplicate' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30'}`}
                    onClick={() => setMedView(medView === 'duplicate' ? 'active' : 'duplicate')}
                  >
                    {t('tab.main.viewDuplicate', { count: duplicateMeds.length })}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {/*
                DDI + duplicate-medication badges are no longer auto-rendered
                on this tab — they live under the standalone 藥事工具 pages:
                「交互作用查詢」 (/pharmacy/interactions) and 「重複用藥」
                (/pharmacy/duplicates). The in-tab "重複用藥 ({N})" toggle
                below is a *different* check: same-generic overlap between
                inpatient orders and outpatient self-supplied meds.
              */}
              {medView === 'duplicate' ? (
                <div className="space-y-2">
                  <p className="text-xs text-orange-700 dark:text-orange-400 mb-2">
                    {t('tab.main.duplicateExplain')}
                  </p>
                  {duplicateMeds.map((dup) => (
                    <div key={dup.generic} className="rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="font-semibold text-sm text-orange-900 dark:text-orange-300">{dup.generic}</p>
                        <Badge className="bg-orange-200 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-950/30 text-xs px-1.5 py-0 h-4">
                          {t('tab.main.duplicateBadge')}
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
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 shrink-0">{t('tab.main.inpatientBadge')}</Badge>
                              <span className="text-sm font-medium truncate">{m.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[m.dose && m.unit ? `${formatDoseValue(m.dose)} ${m.unit}` : null, m.frequency, m.route].filter(Boolean).join(' / ')}
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
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 shrink-0">{t('tab.main.outpatientBadge')}</Badge>
                              <span className="text-sm font-medium truncate">{m.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[m.dose && m.unit ? `${formatDoseValue(m.dose)} ${m.unit}` : null, m.frequency, m.route].filter(Boolean).join(' / ')}
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
                <p className="mb-2 text-xs text-muted-foreground">{t('tab.main.discontinuedHint')}</p>
              )}
              {displayedMeds.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {medView === 'regular'
                    ? t('tab.main.noRegular')
                    : medView === 'discontinued'
                    ? t('tab.main.noDiscontinued')
                    : medView === 'all'
                    ? t('tab.main.noAll')
                    : t('tab.main.noActive')}
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {displayedMeds.map((medication) => {
                    const categoryColor = MED_CATEGORY_COLORS[medication.category];
                    const abx = isAntibiotic(medication);
                    const prn = isPrnOrStat(medication);
                    const isStat = medication.frequency?.toUpperCase() === 'STAT';
                    const discontinued = isDiscontinued(medication);
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
                                {t(`tab.detailModal.${medication.status === 'completed' ? 'completed' : medication.status === 'on-hold' ? 'onHold' : 'discontinued'}`)}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
                                {t('tab.detailModal.active')}
                              </Badge>
                            )}
                            {abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 bg-amber-100 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 ${discontinued ? 'opacity-60' : ''}`}>
                                {t('tab.main.antibioticBadge')}
                              </Badge>
                            )}
                            {prn && !discontinued && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-violet-100 dark:bg-violet-950/30 text-violet-800 dark:text-violet-300">
                                {isStat ? 'STAT' : 'PRN'}
                              </Badge>
                            )}
                            {categoryColor && !abx && (
                              <Badge variant="secondary" className={`text-xs px-1.5 py-0 h-4 ${MED_CATEGORY_COLORS[medication.category]} ${discontinued ? 'opacity-60' : ''}`}>
                                {t(`tab.categories.${medication.category}`, { defaultValue: medication.category })}
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
                              {t('tab.sanMedCard.edit')}
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
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('tab.main.concentrationLabel', { value: formatMedicationConcentration(medication) })}</p>
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
                <div className="flex flex-col items-start gap-2">
                  <CardTitle className="text-base font-semibold leading-tight text-slate-800 dark:text-slate-200">
                    {t('tab.main.outpatientCardTitle')}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">({outpatientCount})</span>
                  </CardTitle>
                  <Button
                    variant={selfSuppliedFilter ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={selfSuppliedFilter}
                    className={
                      selfSuppliedFilter
                        ? 'h-7 px-3 text-xs bg-brand text-white border-brand hover:bg-brand-hover'
                        : 'h-7 px-3 text-xs border-[#d9b6c8] text-brand hover:bg-[#fbf4f8]'
                    }
                    onClick={() => setSelfSuppliedFilter((v) => !v)}
                  >
                    {t('tab.main.selfSuppliedFilter')}
                    {selfSuppliedMeds.length > 0 && (
                      <span className={`ml-1 ${selfSuppliedFilter ? 'text-white/80' : 'text-muted-foreground'}`}>
                        ({selfSuppliedMeds.length})
                      </span>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {selfSuppliedFilter && outpatientGroups.length === 0 && (
                  <p className="py-3 text-sm text-muted-foreground">{t('tab.main.noSelfSupplied')}</p>
                )}
                {outpatientGroups.map((group) => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400">
                        {group.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{t('tab.outpatientGroup.countSuffix', { count: group.meds.length })}</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {group.meds.map((medication) => (
                        (() => {
                          const displayEndDate = getMedicationEndDate(medication);
                          return (
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
                                {medication.sourceType === 'self-supplied' ? (
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400">
                                    {t('tab.detailModal.selfSupplied')}
                                  </Badge>
                                ) : medication.isExternal ? (
                                  <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400">
                                    {t('tab.detailModal.external')}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                                <span>{formatMedicationRegimen(medication)}</span>
                                {medication.daysSupply != null && (
                                  <span className="text-xs">{t('tab.outpatientGroup.daysSupplyCompact', { days: medication.daysSupply })}</span>
                                )}
                              </div>
                              {medication.startDate && (
                                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                                  {t('tab.outpatientGroup.issuedPrefix', { date: formatMedDate(medication.startDate) })}
                                  {displayEndDate && <span> → {t('tab.outpatientGroup.untilSuffix', { date: formatMedDateFromDate(displayEndDate) })}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Score Trend Chart Dialog */}
          {scoreTrendOpen && (
            <Suspense fallback={null}>
              <ScoreTrendChart
                isOpen={scoreTrendOpen}
                onClose={onCloseScoreTrend}
                scoreType={scoreTrendType}
                trendData={scoreTrendData}
                scoreEntries={scoreEntries}
                onDeleteEntry={onDeleteScoreEntry}
              />
            </Suspense>
          )}

          <MedicationDetailModal
            medication={detailMedication}
            open={detailMedication !== null}
            onClose={() => setDetailMedication(null)}
          />

          <Dialog open={editingMedication !== null} onOpenChange={(open) => { if (!open) closeMedicationEditor(); }}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{t('tab.edit.title')}</DialogTitle>
                <DialogDescription>
                  {t('tab.edit.description')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{editingMedication?.name || '—'}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{editingMedication?.genericName || t('tab.edit.noGenericName')}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="med-dose">{t('tab.edit.doseLabel')}</Label>
                    <Input id="med-dose" value={editForm.dose} onChange={(e) => handleEditFieldChange('dose', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-unit">{t('tab.edit.unitLabel')}</Label>
                    <Input id="med-unit" value={editForm.unit} onChange={(e) => handleEditFieldChange('unit', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-concentration">{t('tab.edit.concentrationLabel')}</Label>
                    <Input
                      id="med-concentration"
                      placeholder={t('tab.edit.concentrationPlaceholder')}
                      value={editForm.concentration}
                      onChange={(e) => handleEditFieldChange('concentration', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-concentration-unit">{t('tab.edit.concentrationUnitLabel')}</Label>
                    <Input
                      id="med-concentration-unit"
                      placeholder={t('tab.edit.concentrationUnitPlaceholder')}
                      value={editForm.concentrationUnit}
                      onChange={(e) => handleEditFieldChange('concentrationUnit', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-frequency">{t('tab.edit.frequencyLabel')}</Label>
                    <Input id="med-frequency" value={editForm.frequency} onChange={(e) => handleEditFieldChange('frequency', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="med-route">{t('tab.edit.routeLabel')}</Label>
                    <Input id="med-route" value={editForm.route} onChange={(e) => handleEditFieldChange('route', e.target.value)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="med-indication">{t('tab.edit.indicationLabel')}</Label>
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
                  {t('tab.edit.cancel')}
                </Button>
                <Button onClick={handleSaveMedication} disabled={isSavingMedication || !patientId}>
                  {isSavingMedication ? t('tab.edit.submitting') : t('tab.edit.submit')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </TabsContent>
  );
}
