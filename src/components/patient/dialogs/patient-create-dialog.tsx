import { Plus } from 'lucide-react';
import type { NewPatientFormData } from '../../../features/patients/types';
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

interface PatientCreateDialogProps {
  open: boolean;
  creatingPatient: boolean;
  newPatient: NewPatientFormData;
  onOpenChange: (open: boolean) => void;
  onNewPatientChange: (patient: NewPatientFormData) => void;
  onCreate: () => void;
}

export function PatientCreateDialog({
  open,
  creatingPatient,
  newPatient,
  onOpenChange,
  onNewPatientChange,
  onCreate,
}: PatientCreateDialogProps) {
  const updateNewPatientField = <K extends keyof NewPatientFormData>(
    key: K,
    value: NewPatientFormData[K],
  ) => {
    onNewPatientChange({ ...newPatient, [key]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-brand" />
            新增病患
          </DialogTitle>
          <DialogDescription>
            建立新病患後，可在病患詳情頁持續補齊檢驗、用藥與照護資訊。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">床號 *</Label>
            <Input
              value={newPatient.bedNumber}
              onChange={(event) => updateNewPatientField('bedNumber', event.target.value)}
              className="col-span-3"
              placeholder="例：I-1"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">病歷號 *</Label>
            <Input
              value={newPatient.medicalRecordNumber}
              onChange={(event) => updateNewPatientField('medicalRecordNumber', event.target.value)}
              className="col-span-3"
              placeholder="例：123456"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">姓名 *</Label>
            <Input
              value={newPatient.name}
              onChange={(event) => updateNewPatientField('name', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">性別 *</Label>
            <Select
              value={newPatient.gender}
              onValueChange={(value) => updateNewPatientField('gender', value as '男' | '女')}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="男">男</SelectItem>
                <SelectItem value="女">女</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">年齡 *</Label>
            <Input
              type="number"
              value={newPatient.age}
              onChange={(event) => updateNewPatientField('age', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">主治醫師</Label>
            <Input
              value={newPatient.attendingPhysician}
              onChange={(event) => updateNewPatientField('attendingPhysician', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">科別</Label>
            <Input
              value={newPatient.department}
              onChange={(event) => updateNewPatientField('department', event.target.value)}
              className="col-span-3"
              placeholder="例：內科 / 外科"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">入院診斷 *</Label>
            <Input
              value={newPatient.diagnosis}
              onChange={(event) => updateNewPatientField('diagnosis', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">入院日期</Label>
            <Input
              type="date"
              value={newPatient.admissionDate}
              onChange={(event) => updateNewPatientField('admissionDate', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">ICU 入院日期</Label>
            <Input
              type="date"
              value={newPatient.icuAdmissionDate}
              onChange={(event) => updateNewPatientField('icuAdmissionDate', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">呼吸器天數</Label>
            <Input
              type="number"
              value={newPatient.ventilatorDays}
              onChange={(event) => updateNewPatientField('ventilatorDays', event.target.value)}
              className="col-span-3"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">插管狀態</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={newPatient.intubated}
                onCheckedChange={(checked) => updateNewPatientField('intubated', Boolean(checked))}
              />
              <span className="text-sm text-muted-foreground">勾選表示插管中</span>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">DNR</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={newPatient.hasDNR}
                onCheckedChange={(checked) => updateNewPatientField('hasDNR', Boolean(checked))}
              />
              <span className="text-sm text-muted-foreground">有 DNR</span>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">隔離</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={newPatient.isIsolated}
                onCheckedChange={(checked) => updateNewPatientField('isIsolated', Boolean(checked))}
              />
              <span className="text-sm text-muted-foreground">隔離中</span>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">鎮靜劑 (S)</Label>
            <Input
              value={newPatient.sedation}
              onChange={(event) => updateNewPatientField('sedation', event.target.value)}
              className="col-span-3"
              placeholder="多個藥品用逗號分隔，例：Dormicum, Propofol"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">止痛劑 (A)</Label>
            <Input
              value={newPatient.analgesia}
              onChange={(event) => updateNewPatientField('analgesia', event.target.value)}
              className="col-span-3"
              placeholder="多個藥品用逗號分隔，例：Morphine, Fentanyl"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">神經肌肉阻斷 (N)</Label>
            <Input
              value={newPatient.nmb}
              onChange={(event) => updateNewPatientField('nmb', event.target.value)}
              className="col-span-3"
              placeholder="多個藥品用逗號分隔，例：Cisatracurium"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creatingPatient}>
            取消
          </Button>
          <Button onClick={onCreate} disabled={creatingPatient} className="bg-brand hover:bg-brand-hover">
            {creatingPatient ? '建立中...' : '建立病患'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
