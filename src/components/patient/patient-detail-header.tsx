import { ArrowLeft, Droplet, Clock, Shield, AlertTriangle, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { maskPatientName } from '../../lib/utils/patient-name';
import { getAirwayStatusLabel } from '../../lib/patient-airway';
import type { PatientWithFrontendFields } from '../../pages/patient-detail-types';

export interface PatientDetailHeaderProps {
  patient: PatientWithFrontendFields;
  daysAdmitted: number;
  isAdmin: boolean;
  onBack: () => void;
  onEdit: () => void;
}

/**
 * 病人詳情頁首資訊條(D1 page-split,2026-07-20:自 patient-detail.tsx 抽出):
 * 身分、血型、住院天數、臨床旗標(插管/DNR/隔離)、過敏/診斷/alerts。
 */
export function PatientDetailHeader({
  patient,
  daysAdmitted,
  isAdmin,
  onBack,
  onEdit,
}: PatientDetailHeaderProps) {
  const { t } = useTranslation(['patient-detail', 'patients']);
  return (
    <Card className="border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack} className="hover:bg-slate-50 dark:hover:bg-slate-800" title={t('header.backToList')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-brand text-white flex items-center justify-center font-bold text-2xl shadow-lg">
                {patient.bedNumber || '-'}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold text-[#3c7acb]">{maskPatientName(patient.name)}</h1>
                  <span className="text-base text-slate-500 dark:text-slate-400">
                    {t('header.ageGender', { age: patient.age, gender: patient.gender === 'M' || patient.gender === '男' ? t('patients:create.gender.male', { defaultValue: '男' }) : t('patients:create.gender.female', { defaultValue: '女' }) })}
                  </span>
                  {patient.bloodType && (
                    <Badge variant="outline" className="border-red-200 text-red-700 font-semibold dark:border-red-700 dark:text-red-300">
                      <Droplet className="mr-1 h-3 w-3" />{patient.bloodType}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
                  {patient.medicalRecordNumber && (
                    <span className="text-slate-500 dark:text-slate-400">{t('header.mrnPrefix', { mrn: patient.medicalRecordNumber })}</span>
                  )}
                  {patient.department && (
                    <span className="text-slate-500 dark:text-slate-400">{patient.department}</span>
                  )}
                  {patient.attendingPhysician && (
                    <span className="text-slate-500 dark:text-slate-400">{t('header.physicianPrefix', { physician: patient.attendingPhysician })}</span>
                  )}
                  <span className="flex items-center gap-1 bg-white dark:bg-slate-800 px-3 py-1 rounded-full">
                    <Clock className="h-3.5 w-3.5" />
                    {t('header.stayDays', { days: daysAdmitted })}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 臨床旗標 badges */}
            {patient.intubated && (
              <Badge className="bg-[#d1cbf7] text-brand hover:bg-[#d1cbf7]/90 dark:bg-[#4a2f5c] dark:text-[#efe3ff] dark:hover:bg-[#4a2f5c]/90">
                {getAirwayStatusLabel(patient)}
              </Badge>
            )}
            {patient.hasDNR && (
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100/90 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700">
                <Shield className="mr-1 h-3 w-3" />DNR
              </Badge>
            )}
            {patient.isIsolated && (
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100/90 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                {t('header.isolating')}
              </Badge>
            )}
            {isAdmin && (
              <Button className="bg-brand hover:bg-brand-hover" onClick={onEdit}>{t('header.editButton')}</Button>
            )}
          </div>
        </div>
        {/* 過敏 + 診斷 + alerts */}
        {((patient.allergies && patient.allergies.length > 0) || patient.diagnosis || (patient.alerts && patient.alerts.length > 0)) && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
            {patient.allergies && patient.allergies.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap px-2 py-1.5 rounded-md bg-red-50 border border-red-200 dark:bg-red-900/30 dark:border-red-800">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                <span className="text-xs font-semibold text-red-700 dark:text-red-300">{t('header.allergiesLabel')}</span>
                {patient.allergies.map((allergy: string, idx: number) => (
                  <Badge key={idx} variant="outline" className="border-red-300 bg-red-100 text-red-800 text-xs font-semibold dark:bg-red-900/50 dark:text-red-200 dark:border-red-700">
                    {allergy}
                  </Badge>
                ))}
              </div>
            )}
            {patient.diagnosis && patient.diagnosis !== t('header.diagnosisPending', { defaultValue: '待確認' }) && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{t('header.diagnosisLabel')}</span>{patient.diagnosis}
              </p>
            )}
            {patient.alerts && patient.alerts.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                {patient.alerts.map((alert: string, idx: number) => (
                  <Badge key={idx} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                    {alert}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
