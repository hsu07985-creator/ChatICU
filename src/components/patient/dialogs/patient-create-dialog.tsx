import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('patients');
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
            {t('create.title')}
          </DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.bedRequired')}</Label>
            <Input
              value={newPatient.bedNumber}
              onChange={(event) => updateNewPatientField('bedNumber', event.target.value)}
              className="col-span-3"
              placeholder={t('create.placeholders.bed')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.mrnRequired')}</Label>
            <Input
              value={newPatient.medicalRecordNumber}
              onChange={(event) => updateNewPatientField('medicalRecordNumber', event.target.value)}
              className="col-span-3"
              placeholder={t('create.placeholders.mrn')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.nameRequired')}</Label>
            <Input
              value={newPatient.name}
              onChange={(event) => updateNewPatientField('name', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.genderRequired')}</Label>
            <Select
              value={newPatient.gender}
              onValueChange={(value) => updateNewPatientField('gender', value as '男' | '女')}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* eslint-disable-next-line i18next/no-literal-string -- '男'/'女' are stored data values, not UI strings */}
                <SelectItem value="男">{t('create.gender.male')}</SelectItem>
                {/* eslint-disable-next-line i18next/no-literal-string -- '男'/'女' are stored data values, not UI strings */}
                <SelectItem value="女">{t('create.gender.female')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.ageRequired')}</Label>
            <Input
              type="number"
              value={newPatient.age}
              onChange={(event) => updateNewPatientField('age', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.physician')}</Label>
            <Input
              value={newPatient.attendingPhysician}
              onChange={(event) => updateNewPatientField('attendingPhysician', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.department')}</Label>
            <Input
              value={newPatient.department}
              onChange={(event) => updateNewPatientField('department', event.target.value)}
              className="col-span-3"
              placeholder={t('create.placeholders.department')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.diagnosisRequired')}</Label>
            <Input
              value={newPatient.diagnosis}
              onChange={(event) => updateNewPatientField('diagnosis', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.admissionDate')}</Label>
            <Input
              type="date"
              value={newPatient.admissionDate}
              onChange={(event) => updateNewPatientField('admissionDate', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.icuAdmissionDate')}</Label>
            <Input
              type="date"
              value={newPatient.icuAdmissionDate}
              onChange={(event) => updateNewPatientField('icuAdmissionDate', event.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.ventilatorDays')}</Label>
            <Input
              type="number"
              value={newPatient.ventilatorDays}
              onChange={(event) => updateNewPatientField('ventilatorDays', event.target.value)}
              className="col-span-3"
            />
          </div>

          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">{t('create.labels.airway')}</Label>
            <div className="col-span-3 space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={newPatient.intubated}
                    onCheckedChange={(checked) => handleIntubatedChange(Boolean(checked))}
                  />
                  <span className="text-sm font-medium">{t('create.airway.invasiveCheckbox')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={hasTracheostomy}
                    onCheckedChange={(checked) => handleTracheostomyChange(Boolean(checked))}
                  />
                  <span className="text-sm font-medium">{t('create.airway.tracheostomyCheckbox')}</span>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="create-intubation-date">{t('create.airway.intubationDate')}</Label>
                  <Input
                    id="create-intubation-date"
                    type="date"
                    value={newPatient.intubationDate}
                    onChange={(event) => updateNewPatientField('intubationDate', event.target.value)}
                    disabled={!newPatient.intubated}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-tracheostomy-date">{t('create.airway.tracheostomyDate')}</Label>
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
                {t('create.airway.hint')}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.dnr')}</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={newPatient.hasDNR}
                onCheckedChange={(checked) => updateNewPatientField('hasDNR', Boolean(checked))}
              />
              <span className="text-sm text-muted-foreground">{t('create.dnrCheckbox')}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.isolation')}</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={newPatient.isIsolated}
                onCheckedChange={(checked) => updateNewPatientField('isIsolated', Boolean(checked))}
              />
              <span className="text-sm text-muted-foreground">{t('create.isolationCheckbox')}</span>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.sedation')}</Label>
            <Input
              value={newPatient.sedation}
              onChange={(event) => updateNewPatientField('sedation', event.target.value)}
              className="col-span-3"
              placeholder={t('create.placeholders.sedation')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.analgesia')}</Label>
            <Input
              value={newPatient.analgesia}
              onChange={(event) => updateNewPatientField('analgesia', event.target.value)}
              className="col-span-3"
              placeholder={t('create.placeholders.analgesia')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{t('create.labels.nmb')}</Label>
            <Input
              value={newPatient.nmb}
              onChange={(event) => updateNewPatientField('nmb', event.target.value)}
              className="col-span-3"
              placeholder={t('create.placeholders.nmb')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creatingPatient}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={onCreate} disabled={creatingPatient} className="bg-brand hover:bg-brand-hover">
            {creatingPatient ? t('create.submitting') : t('create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
