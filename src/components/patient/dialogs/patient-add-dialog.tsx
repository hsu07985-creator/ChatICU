import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

export interface NewPatientForm {
  bedNumber: string;
  medicalRecordNumber: string;
  name: string;
  gender: '男' | '女';
  age: string;
  attendingPhysician: string;
  department: string;
  diagnosis: string;
  admissionDate: string;
  icuAdmissionDate: string;
  ventilatorDays: string;
  intubated: boolean;
  intubationDate: string;
  tracheostomy: boolean;
  tracheostomyDate: string;
  hasDNR: boolean;
  isIsolated: boolean;
  sedation: string;
  analgesia: string;
  nmb: string;
}

export interface PatientAddDialogProps {
  open: boolean;
  newPatient: NewPatientForm;
  setNewPatient: (v: NewPatientForm) => void;
  creating: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * 新增病患表單對話框(D1 page-split,2026-07-20:自 patients.tsx 抽出,
 * 與 PatientEditDialog / PatientArchiveDialog 同組)。
 */
export function PatientAddDialog({
  open,
  newPatient,
  setNewPatient,
  creating,
  onClose,
  onSubmit,
}: PatientAddDialogProps) {
  const { t } = useTranslation(['patients', 'common']);
  if (!open) return null;
  const hasTracheostomy = newPatient.tracheostomy || Boolean(newPatient.tracheostomyDate);

  return (
      <Dialog open={true} onOpenChange={(open) => { if (!open && !creating) { onClose(); } }}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-brand" />
              {t('patients:create.title')}
            </DialogTitle>
            <DialogDescription>
              {t('patients:create.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.bedRequired')}</Label>
              <Input
                value={newPatient.bedNumber}
                onChange={(e) => setNewPatient({ ...newPatient, bedNumber: e.target.value })}
                className="col-span-3"
                placeholder={t('patients:create.placeholders.bed')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.mrnRequired')}</Label>
              <Input
                value={newPatient.medicalRecordNumber}
                onChange={(e) => setNewPatient({ ...newPatient, medicalRecordNumber: e.target.value })}
                className="col-span-3"
                placeholder={t('patients:create.placeholders.mrn')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.nameRequired')}</Label>
              <Input
                value={newPatient.name}
                onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.genderRequired')}</Label>
              <Select value={newPatient.gender} onValueChange={(value) => setNewPatient({ ...newPatient, gender: value as '男' | '女' })}>
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
              <Label className="text-right">{t('patients:create.labels.ageRequired')}</Label>
              <Input
                type="number"
                value={newPatient.age}
                onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.physician')}</Label>
              <Input
                value={newPatient.attendingPhysician}
                onChange={(e) => setNewPatient({ ...newPatient, attendingPhysician: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.department')}</Label>
              <Input
                value={newPatient.department}
                onChange={(e) => setNewPatient({ ...newPatient, department: e.target.value })}
                className="col-span-3"
                placeholder={t('patients:create.placeholders.department')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.diagnosisRequired')}</Label>
              <Input
                value={newPatient.diagnosis}
                onChange={(e) => setNewPatient({ ...newPatient, diagnosis: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.admissionDate')}</Label>
              <Input
                type="date"
                value={newPatient.admissionDate}
                onChange={(e) => setNewPatient({ ...newPatient, admissionDate: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.icuAdmissionDate')}</Label>
              <Input
                type="date"
                value={newPatient.icuAdmissionDate}
                onChange={(e) => setNewPatient({ ...newPatient, icuAdmissionDate: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.ventilatorDays')}</Label>
              <Input
                type="number"
                value={newPatient.ventilatorDays}
                onChange={(e) => setNewPatient({ ...newPatient, ventilatorDays: e.target.value })}
                className="col-span-3"
              />
            </div>

            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="pt-2 text-right">{t('patients:create.labels.airway')}</Label>
              <div className="col-span-3 space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={newPatient.intubated}
                      onCheckedChange={(checked) => {
                        if (!checked) {
                          setNewPatient({
                            ...newPatient,
                            intubated: false,
                            intubationDate: '',
                            tracheostomy: false,
                            tracheostomyDate: '',
                          });
                          return;
                        }
                        setNewPatient({ ...newPatient, intubated: true });
                      }}
                    />
                    <span className="text-sm font-medium">{t('patients:create.airway.invasiveCheckbox')}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={hasTracheostomy}
                      onCheckedChange={(checked) => {
                        if (!checked) {
                          setNewPatient({
                            ...newPatient,
                            tracheostomy: false,
                            tracheostomyDate: '',
                          });
                          return;
                        }
                        setNewPatient({
                          ...newPatient,
                          intubated: true,
                          tracheostomy: true,
                        });
                      }}
                    />
                    <span className="text-sm font-medium">{t('patients:create.airway.tracheostomyCheckbox')}</span>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="create-intubation-date-inline">{t('patients:create.airway.intubationDate')}</Label>
                    <Input
                      id="create-intubation-date-inline"
                      type="date"
                      value={newPatient.intubationDate}
                      onChange={(e) => setNewPatient({ ...newPatient, intubationDate: e.target.value })}
                      disabled={!newPatient.intubated}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-tracheostomy-date-inline">{t('patients:create.airway.tracheostomyDate')}</Label>
                    <Input
                      id="create-tracheostomy-date-inline"
                      type="date"
                      value={newPatient.tracheostomyDate}
                      onChange={(e) => setNewPatient({
                        ...newPatient,
                        intubated: e.target.value ? true : newPatient.intubated,
                        tracheostomy: e.target.value ? true : newPatient.tracheostomy,
                        tracheostomyDate: e.target.value,
                      })}
                      disabled={!hasTracheostomy}
                    />
                  </div>
                </div>

                <div className="rounded-md bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                  {t('patients:create.airway.hint')}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.dnr')}</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Checkbox
                  checked={newPatient.hasDNR}
                  onCheckedChange={(checked) => setNewPatient({ ...newPatient, hasDNR: Boolean(checked) })}
                />
                <span className="text-sm text-muted-foreground">{t('patients:create.dnrCheckbox')}</span>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.isolation')}</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Checkbox
                  checked={newPatient.isIsolated}
                  onCheckedChange={(checked) => setNewPatient({ ...newPatient, isIsolated: Boolean(checked) })}
                />
                <span className="text-sm text-muted-foreground">{t('patients:create.isolationCheckbox')}</span>
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.sedation')}</Label>
              <Input
                value={newPatient.sedation}
                onChange={(e) => setNewPatient({ ...newPatient, sedation: e.target.value })}
                className="col-span-3"
                placeholder={t('patients:create.placeholders.sedation')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.analgesia')}</Label>
              <Input
                value={newPatient.analgesia}
                onChange={(e) => setNewPatient({ ...newPatient, analgesia: e.target.value })}
                className="col-span-3"
                placeholder={t('patients:create.placeholders.analgesia')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t('patients:create.labels.nmb')}</Label>
              <Input
                value={newPatient.nmb}
                onChange={(e) => setNewPatient({ ...newPatient, nmb: e.target.value })}
                className="col-span-3"
                placeholder={t('patients:create.placeholders.nmb')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { if (!creating) { onClose(); } }}
              disabled={creating}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={onSubmit}
              disabled={creating}
              className="bg-brand hover:bg-brand-hover"
            >
              {creating ? t('patients:create.submitting') : t('patients:create.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
