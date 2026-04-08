import { Edit2, Save, X } from 'lucide-react';
import { ICU_DEPARTMENTS, type PatientWithFrontendFields } from '../../../features/patients/types';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
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

interface PatientEditDialogProps {
  patient: PatientWithFrontendFields | null;
  onPatientChange: (patient: PatientWithFrontendFields) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function PatientEditDialog({
  patient,
  onPatientChange,
  onCancel,
  onSave,
}: PatientEditDialogProps) {
  if (!patient) {
    return null;
  }

  const updatePatientField = <K extends keyof PatientWithFrontendFields>(
    key: K,
    value: PatientWithFrontendFields[K],
  ) => {
    onPatientChange({ ...patient, [key]: value });
  };

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-5 w-5 text-brand" />
            編輯病人資料
          </DialogTitle>
          <DialogDescription>請修改病人資料並儲存。只有管理員可以編輯。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="bedNumber" className="text-right">
              床號
            </Label>
            <Input
              id="bedNumber"
              value={patient.bedNumber}
              onChange={(event) => updatePatientField('bedNumber', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="attendingPhysician" className="text-right">
              主治醫師
            </Label>
            <Input
              id="attendingPhysician"
              value={patient.attendingPhysician}
              onChange={(event) => updatePatientField('attendingPhysician', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="department" className="text-right">
              科別
            </Label>
            <Select value={patient.department} onValueChange={(value) => updatePatientField('department', value)}>
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ICU_DEPARTMENTS.map((department) => (
                  <SelectItem key={department} value={department}>
                    {department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="admissionDate" className="text-right">
              入院日期
            </Label>
            <Input
              id="admissionDate"
              type="date"
              value={patient.admissionDate}
              onChange={(event) => updatePatientField('admissionDate', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="icuAdmissionDate" className="text-right">
              ICU入院日期
            </Label>
            <Input
              id="icuAdmissionDate"
              type="date"
              value={patient.icuAdmissionDate}
              onChange={(event) => updatePatientField('icuAdmissionDate', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="intubated" className="text-right">
              插管狀態
            </Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                id="intubated"
                checked={patient.intubated}
                onCheckedChange={(checked) => updatePatientField('intubated', checked === true)}
              />
              <span className="text-sm text-muted-foreground">勾選表示插管中</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <X className="mr-2 h-4 w-4" />
            取消
          </Button>
          <Button onClick={onSave} className="bg-brand hover:bg-brand-hover">
            <Save className="mr-2 h-4 w-4" />
            儲存變更
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
