import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
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
            辦理出院（封存病患）
          </DialogTitle>
          <DialogDescription>
            出院後病患將從住院中清單移除，但所有用藥/檢驗/對話紀錄都會保留，可於「已出院病人」頁回顧或復住院。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {lockTarget ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">對象病患：</span>
              <span className="font-medium ml-1">{label || '—'}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>選擇病患</Label>
              <Select value={archiveTargetId} onValueChange={onArchiveTargetChange}>
                <SelectTrigger>
                  <SelectValue placeholder="請選擇病患..." />
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
              <Label>出院類別 *</Label>
              <Select value={dischargeType} onValueChange={(v) => setDischargeType(v as DischargeType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="discharge">一般出院</SelectItem>
                  <SelectItem value="transfer">轉院 / 轉出</SelectItem>
                  <SelectItem value="death">死亡</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>出院日期 *</Label>
              <Input
                type="date"
                value={dischargeDate}
                onChange={(e) => setDischargeDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>備註（選填）</Label>
            <Textarea
              placeholder="轉院目的醫院、死亡原因、其他備註..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={archivingPatient}>
            取消
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
            {archivingPatient ? '處理中...' : '確認出院'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
