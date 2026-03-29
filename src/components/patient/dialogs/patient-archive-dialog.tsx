import { Archive } from 'lucide-react';
import type { PatientWithFrontendFields } from '../../../features/patients/types';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

interface PatientArchiveDialogProps {
  open: boolean;
  archivingPatient: boolean;
  archiveTargetId: string;
  patients: PatientWithFrontendFields[];
  onOpenChange: (open: boolean) => void;
  onArchiveTargetChange: (patientId: string) => void;
  onConfirmArchive: (patientId: string) => void;
}

export function PatientArchiveDialog({
  open,
  archivingPatient,
  archiveTargetId,
  patients,
  onOpenChange,
  onArchiveTargetChange,
  onConfirmArchive,
}: PatientArchiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-[#7f265b]" />
            封存病患
          </DialogTitle>
          <DialogDescription>
            封存後該病患將不會出現在一般清單中（可用於出院/轉出/結案）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label>選擇病患</Label>
          <Select value={archiveTargetId} onValueChange={onArchiveTargetChange}>
            <SelectTrigger>
              <SelectValue placeholder="請選擇病患..." />
            </SelectTrigger>
            <SelectContent>
              {patients.map((patient) => (
                <SelectItem key={patient.id} value={patient.id}>
                  {patient.bedNumber} - {patient.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={archivingPatient}>
            取消
          </Button>
          <Button
            onClick={() => onConfirmArchive(archiveTargetId)}
            disabled={archivingPatient || !archiveTargetId}
            className="bg-[#7f265b] hover:bg-[#631e4d]"
          >
            {archivingPatient ? '封存中...' : '確認封存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
