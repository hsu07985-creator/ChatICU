import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PatientWithFrontendFields } from '../../../features/patients/types';
import { maskPatientName } from '../../../lib/utils/patient-name';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Textarea } from '../../ui/textarea';

export type DischargeType = 'discharge' | 'transfer' | 'death' | 'other';

export interface ArchivePayload {
  patientId: string;
  dischargeType: DischargeType;
  dischargeDate: string;
  reason?: string;
}

interface PatientArchiveDialogProps {
  open: boolean;
  archivingPatient: boolean;
  archiveTargetId: string;
  patients: PatientWithFrontendFields[];
  onOpenChange: (open: boolean) => void;
  onArchiveTargetChange: (patientId: string) => void;
  /**
   * Called when user confirms. Receives dischargeType/dischargeDate/reason
   * for soft-discharge (archive) flows.
   */
  onConfirmArchive: (payload: ArchivePayload) => void;
  /** When true, hide the patient picker (used for per-row discharge). */
  lockTarget?: boolean;
}

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function PatientArchiveDialog({
  open,
  archivingPatient,
  archiveTargetId,
  patients,
  onOpenChange,
  onArchiveTargetChange,
  onConfirmArchive,
  lockTarget = false,
}: PatientArchiveDialogProps) {
  const { t } = useTranslation(['patients', 'common']);
  const [dischargeType, setDischargeType] = useState<DischargeType>('discharge');
  const [dischargeDate, setDischargeDate] = useState<string>(todayIso());
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (open) {
      setDischargeType('discharge');
      setDischargeDate(todayIso());
      setReason('');
    }
  }, [open]);

  const target = patients.find((p) => p.id === archiveTargetId);
  const label = target ? `${target.bedNumber} ${maskPatientName(target.name)}` : '';

  const canConfirm = !!archiveTargetId && !archivingPatient && !!dischargeDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-brand" />
            {t('patients:archive.transferOutTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('patients:archive.transferOutDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {lockTarget ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('patients:archive.targetLabel')}</span>
              <span className="font-medium ml-1">{label || t('patients:archive.targetLabelEmpty')}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{t('patients:archive.selectLabel')}</Label>
              <Select value={archiveTargetId} onValueChange={onArchiveTargetChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t('patients:archive.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.bedNumber} - {maskPatientName(patient.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('patients:archive.transferOutTypeLabel')}</Label>
              <Select value={dischargeType} onValueChange={(v) => setDischargeType(v as DischargeType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="discharge">{t('patients:dischargeType.discharge')}</SelectItem>
                  <SelectItem value="transfer">{t('patients:dischargeType.transferLong')}</SelectItem>
                  <SelectItem value="death">{t('patients:dischargeType.death')}</SelectItem>
                  <SelectItem value="other">{t('patients:dischargeType.other')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('patients:archive.transferOutDateLabel')}</Label>
              <Input
                type="date"
                value={dischargeDate}
                onChange={(e) => setDischargeDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('patients:archive.remarkLabel')}</Label>
            <Textarea
              placeholder={t('patients:archive.remarkPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={archivingPatient}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() =>
              onConfirmArchive({
                patientId: archiveTargetId,
                dischargeType,
                dischargeDate,
                reason: reason.trim() || undefined,
              })
            }
            disabled={!canConfirm}
            className="bg-brand hover:bg-brand-hover"
          >
            {archivingPatient ? t('patients:archive.transferOutSubmitting') : t('patients:archive.transferOutSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
