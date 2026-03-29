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
            <Edit2 className="h-5 w-5 text-[#7f265b]" />
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
            <Label htmlFor="name" className="text-right">
              姓名
            </Label>
            <Input
              id="name"
              value={patient.name}
              onChange={(event) => updatePatientField('name', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="gender" className="text-right">
              性別
            </Label>
            <Select value={patient.gender} onValueChange={(value) => updatePatientField('gender', value)}>
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
            <Label htmlFor="age" className="text-right">
              年齡
            </Label>
            <Input
              id="age"
              type="number"
              value={patient.age}
              onChange={(event) => updatePatientField('age', parseInt(event.target.value))}
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
            <Label htmlFor="diagnosis" className="text-right">
              入院診斷
            </Label>
            <Input
              id="diagnosis"
              value={patient.diagnosis}
              onChange={(event) => updatePatientField('diagnosis', event.target.value)}
              className="col-span-3"
            />
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
            <Label htmlFor="ventilatorDays" className="text-right">
              呼吸器天數
            </Label>
            <Input
              id="ventilatorDays"
              type="number"
              value={patient.ventilatorDays}
              onChange={(event) => updatePatientField('ventilatorDays', parseInt(event.target.value))}
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
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="sedation" className="text-right">
              鎮靜劑 (S)
            </Label>
            <Input
              id="sedation"
              value={(patient.sedation ?? []).join(', ')}
              onChange={(event) =>
                updatePatientField(
                  'sedation',
                  event.target.value ? event.target.value.split(',').map((item) => item.trim()) : [],
                )
              }
              className="col-span-3"
              placeholder="多個藥品用逗號分隔，例：Dormicum, Propofol"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="analgesia" className="text-right">
              止痛劑 (A)
            </Label>
            <Input
              id="analgesia"
              value={(patient.analgesia ?? []).join(', ')}
              onChange={(event) =>
                updatePatientField(
                  'analgesia',
                  event.target.value ? event.target.value.split(',').map((item) => item.trim()) : [],
                )
              }
              className="col-span-3"
              placeholder="多個藥品用逗號分隔，例：Morphine, Fentanyl"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nmb" className="text-right">
              神經肌肉阻斷劑 (N)
            </Label>
            <Input
              id="nmb"
              value={(patient.nmb ?? []).join(', ')}
              onChange={(event) =>
                updatePatientField(
                  'nmb',
                  event.target.value ? event.target.value.split(',').map((item) => item.trim()) : [],
                )
              }
              className="col-span-3"
              placeholder="多個藥品用逗號分隔，例：Cisatracurium"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="consentStatus" className="text-right">
              同意書狀態
            </Label>
            <Select
              value={patient.consentStatus}
              onValueChange={(value) => updatePatientField('consentStatus', value)}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="valid">已同意</SelectItem>
                <SelectItem value="expired">已過期</SelectItem>
                <SelectItem value="none">未簽署</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="hasUnreadMessages" className="text-right">
              未讀留言
            </Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                id="hasUnreadMessages"
                checked={patient.hasUnreadMessages}
                onCheckedChange={(checked) => updatePatientField('hasUnreadMessages', checked === true)}
              />
              <span className="text-sm text-muted-foreground">勾選表示有未讀留言</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <X className="mr-2 h-4 w-4" />
            取消
          </Button>
          <Button onClick={onSave} className="bg-[#7f265b] hover:bg-[#631e4d]">
            <Save className="mr-2 h-4 w-4" />
            儲存變更
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
