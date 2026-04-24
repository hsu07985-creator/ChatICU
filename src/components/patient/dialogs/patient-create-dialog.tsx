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

  const hasTracheostomy = newPatient.tracheostomy || Boolean(newPatient.tracheostomyDate);

  const handleIntubatedChange = (checked: boolean) => {
    if (!checked) {
      onNewPatientChange({
        ...newPatient,
        intubated: false,
        intubationDate: '',
        tracheostomy: false,
        tracheostomyDate: '',
      });
      return;
    }

    updateNewPatientField('intubated', true);
  };

  const handleTracheostomyChange = (checked: boolean) => {
    if (!checked) {
      onNewPatientChange({
        ...newPatient,
        tracheostomy: false,
        tracheostomyDate: '',
      });
      return;
    }

    onNewPatientChange({
      ...newPatient,
      intubated: true,
      tracheostomy: true,
    });
  };

  const handleTracheostomyDateChange = (value: string) => {
    onNewPatientChange({
      ...newPatient,
      intubated: value ? true : newPatient.intubated,
      tracheostomy: value ? true : newPatient.tracheostomy,
      tracheostomyDate: value,
    });
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

          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">呼吸道支持</Label>
            <div className="col-span-3 space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={newPatient.intubated}
                    onCheckedChange={(checked) => handleIntubatedChange(Boolean(checked))}
                  />
                  <span className="text-sm font-medium">目前使用侵入性呼吸道支持</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={hasTracheostomy}
                    onCheckedChange={(checked) => handleTracheostomyChange(Boolean(checked))}
                  />
                  <span className="text-sm font-medium">已執行氣管切開術</span>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="create-intubation-date">插管日期</Label>
                  <Input
                    id="create-intubation-date"
                    type="date"
                    value={newPatient.intubationDate}
                    onChange={(event) => updateNewPatientField('intubationDate', event.target.value)}
                    disabled={!newPatient.intubated}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-tracheostomy-date">氣切日期</Label>
                  <Input
                    id="create-tracheostomy-date"
                    type="date"
                    value={newPatient.tracheostomyDate}
                    onChange={(event) => handleTracheostomyDateChange(event.target.value)}
                    disabled={!hasTracheostomy}
                  />
                </div>
              </div>

              <div className="rounded-md bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                可只勾選「已執行氣管切開術」不填日期；若病人由氣切處接呼吸器，也算在侵入性呼吸道支持。
              </div>
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
