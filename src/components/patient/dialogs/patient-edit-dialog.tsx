import { Edit2, Save, X } from 'lucide-react';
import { ICU_DEPARTMENTS, type PatientWithFrontendFields } from '../../../features/patients/types';
import { Button } from '../../ui/button';
import { ButtonLoadingIndicator } from '../../ui/button-loading-indicator';
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
  isSaving?: boolean;
}

export function PatientEditDialog({
  patient,
  onPatientChange,
  onCancel,
  onSave,
  isSaving = false,
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
            <Label htmlFor="bedNumber" className="text-right">床號</Label>
            <Input
              id="bedNumber"
              value={patient.bedNumber}
              onChange={(e) => updatePatientField('bedNumber', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">姓名</Label>
            <Input
              id="name"
              value={patient.name}
              onChange={(e) => updatePatientField('name', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="gender" className="text-right">性別</Label>
            <Select
              value={patient.gender}
              onValueChange={(value) => updatePatientField('gender', value)}
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
            <Label htmlFor="age" className="text-right">年齡</Label>
            <Input
              id="age"
              type="number"
              value={patient.age}
              onChange={(e) => updatePatientField('age', parseInt(e.target.value) || 0)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="height" className="text-right">身高 (cm)</Label>
            <Input
              id="height"
              type="number"
              step="0.1"
              placeholder="例: 170"
              value={patient.height ?? ''}
              onChange={(e) => updatePatientField('height', e.target.value ? Number(e.target.value) : null)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="weight" className="text-right">體重 (kg)</Label>
            <Input
              id="weight"
              type="number"
              step="0.1"
              placeholder="例: 65"
              value={patient.weight ?? ''}
              onChange={(e) => updatePatientField('weight', e.target.value ? Number(e.target.value) : null)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="attendingPhysician" className="text-right">主治醫師</Label>
            <Input
              id="attendingPhysician"
              value={patient.attendingPhysician}
              onChange={(e) => updatePatientField('attendingPhysician', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="department" className="text-right">科別</Label>
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
            <Label htmlFor="diagnosis" className="text-right">入院診斷</Label>
            <Input
              id="diagnosis"
              value={patient.diagnosis}
              onChange={(e) => updatePatientField('diagnosis', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="admissionDate" className="text-right">入院日期</Label>
            <Input
              id="admissionDate"
              type="date"
              value={patient.admissionDate}
              onChange={(e) => updatePatientField('admissionDate', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="icuAdmissionDate" className="text-right">ICU入院日期</Label>
            <Input
              id="icuAdmissionDate"
              type="date"
              value={patient.icuAdmissionDate}
              onChange={(e) => updatePatientField('icuAdmissionDate', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="intubated" className="text-right">插管狀態</Label>
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
            <Label htmlFor="intubationDate" className="text-right">插管日期</Label>
            <Input
              id="intubationDate"
              type="date"
              value={patient.intubationDate ?? ''}
              onChange={(e) => updatePatientField('intubationDate', e.target.value || null)}
              className="col-span-3"
              disabled={!patient.intubated}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="ventilatorDays" className="text-right">呼吸器天數</Label>
            <div className="col-span-3 flex items-center gap-2">
              <span className="text-sm font-medium">
                {patient.intubationDate
                  ? Math.max(Math.floor((Date.now() - new Date(patient.intubationDate).getTime()) / 86400000), 0)
                  : 0} 天
              </span>
              <span className="text-xs text-muted-foreground">
                {patient.intubationDate ? '（依插管日期自動計算）' : '（請先設定插管日期）'}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="sedation" className="text-right">鎮靜劑 (S)</Label>
            <Input
              id="sedation"
              value={(patient.sedation ?? []).join(', ')}
              onChange={(e) => updatePatientField('sedation', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
              className="col-span-3"
              placeholder="多個藥品用逗號分隔"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="analgesia" className="text-right">止痛劑 (A)</Label>
            <Input
              id="analgesia"
              value={(patient.analgesia ?? []).join(', ')}
              onChange={(e) => updatePatientField('analgesia', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
              className="col-span-3"
              placeholder="多個藥品用逗號分隔"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nmb" className="text-right">肌肉鬆弛劑 (N)</Label>
            <Input
              id="nmb"
              value={(patient.nmb ?? []).join(', ')}
              onChange={(e) => updatePatientField('nmb', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
              className="col-span-3"
              placeholder="多個藥品用逗號分隔"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="consentStatus" className="text-right">同意書狀態</Label>
            <Select
              value={patient.consentStatus ?? 'none'}
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            <X className="mr-2 h-4 w-4" />
            取消
          </Button>
          <Button onClick={onSave} className="bg-brand hover:bg-brand-hover" disabled={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            <span>{isSaving ? '處理中' : '儲存變更'}</span>
            {isSaving ? <ButtonLoadingIndicator /> : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
