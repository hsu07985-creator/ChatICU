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

  const hasTracheostomy = patient.tracheostomy === true || Boolean(patient.tracheostomyDate);
  const airwayReferenceDate = patient.intubationDate ?? patient.tracheostomyDate ?? null;
  const airwaySupportDays = airwayReferenceDate
    ? Math.max(Math.floor((Date.now() - new Date(airwayReferenceDate).getTime()) / 86400000), 0)
    : 0;

  const handleIntubatedChange = (checked: boolean) => {
    if (!checked) {
      onPatientChange({
        ...patient,
        intubated: false,
        intubationDate: null,
        tracheostomy: false,
        tracheostomyDate: null,
      });
      return;
    }

    updatePatientField('intubated', true);
  };

  const handleTracheostomyChange = (checked: boolean) => {
    if (!checked) {
      onPatientChange({
        ...patient,
        tracheostomy: false,
        tracheostomyDate: null,
      });
      return;
    }

    onPatientChange({
      ...patient,
      intubated: true,
      tracheostomy: true,
    });
  };

  const handleTracheostomyDateChange = (value: string) => {
    onPatientChange({
      ...patient,
      intubated: value ? true : patient.intubated,
      tracheostomy: value ? true : patient.tracheostomy,
      tracheostomyDate: value || null,
    });
  };

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-5 w-5 text-brand" />
            編輯病人資料
          </DialogTitle>
          <DialogDescription>請修改病人資料並儲存。</DialogDescription>
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
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">呼吸道支持</Label>
            <div className="col-span-3 space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2">
                  <Checkbox
                    id="intubated"
                    checked={patient.intubated}
                    onCheckedChange={(checked) => handleIntubatedChange(checked === true)}
                  />
                  <span className="text-sm font-medium">目前使用侵入性呼吸道支持</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    id="tracheostomy"
                    checked={hasTracheostomy}
                    onCheckedChange={(checked) => handleTracheostomyChange(checked === true)}
                  />
                  <span className="text-sm font-medium">已執行氣管切開術</span>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="intubationDate">插管日期</Label>
                  <Input
                    id="intubationDate"
                    type="date"
                    value={patient.intubationDate ?? ''}
                    onChange={(e) => updatePatientField('intubationDate', e.target.value || null)}
                    disabled={!patient.intubated}
                  />
                  <p className="text-xs text-muted-foreground">
                    病人入 ICU 前已插管時可直接填寫；日期未知可先留空。
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tracheostomyDate">氣切日期</Label>
                  <Input
                    id="tracheostomyDate"
                    type="date"
                    value={patient.tracheostomyDate ?? ''}
                    onChange={(e) => handleTracheostomyDateChange(e.target.value)}
                    disabled={!hasTracheostomy}
                  />
                  <p className="text-xs text-muted-foreground">
                    可只勾選「已執行氣管切開術」；若填日期會自動視為已氣切。
                  </p>
                </div>
              </div>

              <div className="rounded-md bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                若病人由氣切處接呼吸器，仍視為侵入性呼吸道支持中；此區塊先提供狀態與日期兩種記錄方式。
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="ventilatorDays" className="text-right">呼吸器天數</Label>
            <div className="col-span-3 flex items-center gap-2">
              <span className="text-sm font-medium">
                {airwaySupportDays} 天
              </span>
              <span className="text-xs text-muted-foreground">
                {patient.intubationDate
                  ? '（依插管日期自動計算）'
                  : patient.tracheostomyDate
                    ? '（示意：暫以氣切日期估算）'
                    : '（請先設定插管或氣切日期）'}
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
