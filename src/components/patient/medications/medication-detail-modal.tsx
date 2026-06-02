// MedicationDetailModal — read-only detail dialog for a single medication.
// Extracted from patient-medications-tab.tsx (behavior-preserving).
import { useTranslation } from 'react-i18next';
import type { Medication } from '../../../lib/api';
import i18n from '../../../i18n/config';
import {
  formatDoseValue,
  getOutpatientStatus,
  getMedicationEndDate,
  formatCalendarDate,
} from '../../../lib/medications/medication-formatters';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';

export function MedicationDetailModal({
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
