import { Edit2, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['patients', 'common']);
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
            {t('patients:edit.title')}
          </DialogTitle>
          <DialogDescription>{t('patients:edit.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="bedNumber" className="text-right">{t('patients:edit.labels.bed')}</Label>
            <Input
              id="bedNumber"
              value={patient.bedNumber}
              onChange={(e) => updatePatientField('bedNumber', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">{t('patients:edit.labels.name')}</Label>
            <Input
              id="name"
              value={patient.name}
              onChange={(e) => updatePatientField('name', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="gender" className="text-right">{t('patients:edit.labels.gender')}</Label>
            <Select
              value={patient.gender}
              onValueChange={(value) => updatePatientField('gender', value)}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="男">{t('patients:create.gender.male')}</SelectItem>
                <SelectItem value="女">{t('patients:create.gender.female')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="age" className="text-right">{t('patients:edit.labels.age')}</Label>
            <Input
              id="age"
              type="number"
              value={patient.age}
              onChange={(e) => updatePatientField('age', parseInt(e.target.value) || 0)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="height" className="text-right">{t('patients:edit.labels.heightCm')}</Label>
            <Input
              id="height"
              type="number"
              step="0.1"
              placeholder={t('patients:edit.placeholders.height')}
              value={patient.height ?? ''}
              onChange={(e) => updatePatientField('height', e.target.value ? Number(e.target.value) : null)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="weight" className="text-right">{t('patients:edit.labels.weightKg')}</Label>
            <Input
              id="weight"
              type="number"
              step="0.1"
              placeholder={t('patients:edit.placeholders.weight')}
              value={patient.weight ?? ''}
              onChange={(e) => updatePatientField('weight', e.target.value ? Number(e.target.value) : null)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="attendingPhysician" className="text-right">{t('patients:edit.labels.physician')}</Label>
            <Input
              id="attendingPhysician"
              value={patient.attendingPhysician}
              onChange={(e) => updatePatientField('attendingPhysician', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="department" className="text-right">{t('patients:edit.labels.department')}</Label>
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
            <Label htmlFor="diagnosis" className="text-right">{t('patients:edit.labels.diagnosis')}</Label>
            <Input
              id="diagnosis"
              value={patient.diagnosis}
              onChange={(e) => updatePatientField('diagnosis', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="admissionDate" className="text-right">{t('patients:edit.labels.admissionDate')}</Label>
            <Input
              id="admissionDate"
              type="date"
              value={patient.admissionDate}
              onChange={(e) => updatePatientField('admissionDate', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="icuAdmissionDate" className="text-right">{t('patients:edit.labels.icuAdmissionDate')}</Label>
            <Input
              id="icuAdmissionDate"
              type="date"
              value={patient.icuAdmissionDate}
              onChange={(e) => updatePatientField('icuAdmissionDate', e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right">{t('patients:edit.labels.airway')}</Label>
            <div className="col-span-3 space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2">
                  <Checkbox
                    id="intubated"
                    checked={patient.intubated}
                    onCheckedChange={(checked) => handleIntubatedChange(checked === true)}
                  />
                  <span className="text-sm font-medium">{t('patients:edit.airway.invasiveCheckbox')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    id="tracheostomy"
                    checked={hasTracheostomy}
                    onCheckedChange={(checked) => handleTracheostomyChange(checked === true)}
                  />
                  <span className="text-sm font-medium">{t('patients:edit.airway.tracheostomyCheckbox')}</span>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="intubationDate">{t('patients:edit.airway.intubationDate')}</Label>
                  <Input
                    id="intubationDate"
                    type="date"
                    value={patient.intubationDate ?? ''}
                    onChange={(e) => updatePatientField('intubationDate', e.target.value || null)}
                    disabled={!patient.intubated}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('patients:edit.airway.intubationHint')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tracheostomyDate">{t('patients:edit.airway.tracheostomyDate')}</Label>
                  <Input
                    id="tracheostomyDate"
                    type="date"
                    value={patient.tracheostomyDate ?? ''}
                    onChange={(e) => handleTracheostomyDateChange(e.target.value)}
                    disabled={!hasTracheostomy}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('patients:edit.airway.tracheostomyHint')}
                  </p>
                </div>
              </div>

              <div className="rounded-md bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                {t('patients:edit.airway.footerNote')}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="ventilatorDays" className="text-right">{t('patients:edit.labels.ventilatorDays')}</Label>
            <div className="col-span-3 flex items-center gap-2">
              <span className="text-sm font-medium">
                {t('patients:edit.ventilatorDaysValue', { days: airwaySupportDays })}
              </span>
              <span className="text-xs text-muted-foreground">
                {patient.intubationDate
                  ? t('patients:edit.ventilatorDaysSource.intubation')
                  : patient.tracheostomyDate
                    ? t('patients:edit.ventilatorDaysSource.tracheostomy')
                    : t('patients:edit.ventilatorDaysSource.none')}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="sedation" className="text-right">{t('patients:edit.labels.sedation')}</Label>
            <Input
              id="sedation"
              value={(patient.sedation ?? []).join(', ')}
              onChange={(e) => updatePatientField('sedation', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
              className="col-span-3"
              placeholder={t('patients:edit.placeholders.drugListsCsv')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="analgesia" className="text-right">{t('patients:edit.labels.analgesia')}</Label>
            <Input
              id="analgesia"
              value={(patient.analgesia ?? []).join(', ')}
              onChange={(e) => updatePatientField('analgesia', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
              className="col-span-3"
              placeholder={t('patients:edit.placeholders.drugListsCsv')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nmb" className="text-right">{t('patients:edit.labels.nmb')}</Label>
            <Input
              id="nmb"
              value={(patient.nmb ?? []).join(', ')}
              onChange={(e) => updatePatientField('nmb', e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])}
              className="col-span-3"
              placeholder={t('patients:edit.placeholders.drugListsCsv')}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="consentStatus" className="text-right">{t('patients:edit.labels.consent')}</Label>
            <Select
              value={patient.consentStatus ?? 'none'}
              onValueChange={(value) => updatePatientField('consentStatus', value)}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="valid">{t('patients:edit.consentOptions.valid')}</SelectItem>
                <SelectItem value="expired">{t('patients:edit.consentOptions.expired')}</SelectItem>
                <SelectItem value="none">{t('patients:edit.consentOptions.none')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            <X className="mr-2 h-4 w-4" />
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={onSave} className="bg-brand hover:bg-brand-hover" disabled={isSaving}>
            <Save className="mr-2 h-4 w-4" />
            <span>{isSaving ? t('patients:edit.submitting') : t('patients:edit.submit')}</span>
            {isSaving ? <ButtonLoadingIndicator /> : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
