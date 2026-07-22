import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth-context';
import { patientsApi, type Patient } from '../lib/api';
import { usePatientList } from '../hooks/use-patient-list';
import { refreshSharedPatientDataAfterMutation } from '../lib/patient-data-sync';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { ButtonLoadingIndicator } from '../components/ui/button-loading-indicator';
import { Badge } from '../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { AlertTriangle, Search, Users, LogOut, FlaskConical } from 'lucide-react';
import { maskPatientName } from '../lib/utils/patient-name';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { PatientArchiveDialog, type ArchivePayload } from '../components/patient/dialogs/patient-archive-dialog';
import { ErrorDisplay, EmptyState } from '../components/ui/state-display';
import { TableSkeleton } from '../components/ui/skeletons';
import { toast } from 'sonner';
import { getAirwayStatusLabel } from '../lib/patient-airway';
import { DataOwnershipBadge, DataOwnershipLegend } from '../components/patient/data-ownership-badge';

interface PatientWithFrontendFields extends Patient {
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  hasUnreadMessages?: boolean;
}

export function PatientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation(['patients', 'common', 'dashboard']);
  const canEditPatients = ['admin', 'doctor', 'np'].includes(user?.role ?? '');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const {
    patients: sharedPatients,
    patientsLoading: loading,
    patientsLoadFailed,
    refetchPatients,
  } = usePatientList();
  const patients = sharedPatients as PatientWithFrontendFields[];
  const error = patientsLoadFailed ? t('patients:list.loadErrorMessage') : null;

  const getSedation = (patient: PatientWithFrontendFields) => patient.sedation || patient.sanSummary?.sedation || [];
  const getAnalgesia = (patient: PatientWithFrontendFields) => patient.analgesia || patient.sanSummary?.analgesia || [];
  const getNmb = (patient: PatientWithFrontendFields) => patient.nmb || patient.sanSummary?.nmb || [];
  const getPatientAllergies = (patient: PatientWithFrontendFields) =>
    (patient.allergies ?? []).map((allergy) => allergy.trim()).filter(Boolean);

  // Dynamic doctor list from patient data
  const doctorOptions = useMemo(() => {
    const docs = new Set<string>();
    patients.forEach(p => { if (p.attendingPhysician) docs.add(p.attendingPhysician); });
    return Array.from(docs).sort();
  }, [patients]);

  const filteredPatients = useMemo(
    () => patients.filter(patient => {
      const matchSearch = (patient.name || '').includes(searchTerm) || (patient.bedNumber || '').includes(searchTerm);
      if (filterStatus === 'intubated') return matchSearch && patient.intubated;
      if (filterStatus === 'san') {
        return matchSearch && (getSedation(patient).length > 0 || getAnalgesia(patient).length > 0 || getNmb(patient).length > 0);
      }
      if (filterStatus === 'dnr') return matchSearch && patient.hasDNR;
      if (filterStatus.startsWith('doc:')) {
        const docName = filterStatus.slice(4);
        return matchSearch && patient.attendingPhysician === docName;
      }
      return matchSearch;
    }),
    [patients, searchTerm, filterStatus],
  );

  const getICUDays = (icuAdmissionDate: string) => {
    const today = new Date();
    const admission = new Date(icuAdmissionDate);
    return Math.ceil(Math.abs(today.getTime() - admission.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getDepartmentBadgeColor = (department: string | null | undefined) => {
    if (department?.includes('內科')) return 'bg-blue-600 text-white dark:bg-blue-700';
    if (department?.includes('外科')) return 'bg-amber-600 text-white dark:bg-amber-700';
    return 'bg-gray-600 text-white dark:bg-gray-700';
  };

  const renderAllergyCell = (patient: PatientWithFrontendFields) => {
    const allergies = getPatientAllergies(patient);

    if (allergies.length === 0) {
      return (
        <Badge
          variant="outline"
          className="text-muted-foreground"
          title={t('patients:list.noAllergiesRegistered')}
        >
          {t('patients:list.no')}
        </Badge>
      );
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex"
            title={t('patients:list.allergyDetailsTooltip')}
            onClick={(event) => event.stopPropagation()}
          >
            <Badge className="cursor-pointer border border-red-200 bg-red-100 text-red-700 hover:bg-red-100/90 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
              {t('patients:list.yes')}
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="center">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" />
              {t('patients:list.allergyDetailsTitle')}
            </div>
            <div className="flex flex-wrap gap-2">
              {allergies.map((allergy, index) => (
                <Badge
                  key={`${allergy}-${index}`}
                  variant="outline"
                  className="border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200"
                >
                  {allergy}
                </Badge>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const [dischargeDialogOpen, setDischargeDialogOpen] = useState(false);
  const [dischargeTargetId, setDischargeTargetId] = useState<string>('');
  const [dischargingArchiveId, setDischargingArchiveId] = useState<string | null>(null);

  const handleOpenDischargeDialog = (patient: PatientWithFrontendFields) => {
    setDischargeTargetId(patient.id);
    setDischargeDialogOpen(true);
  };

  const handleConfirmDischarge = async (payload: ArchivePayload) => {
    if (!payload.patientId) return;
    const target = patients.find((p) => p.id === payload.patientId);
    const label = target ? `${target.bedNumber} ${maskPatientName(target.name)}` : payload.patientId;
    setDischargingArchiveId(payload.patientId);
    try {
      await patientsApi.archivePatient(payload.patientId, {
        archived: true,
        dischargeType: payload.dischargeType,
        dischargeDate: payload.dischargeDate,
        reason: payload.reason,
      });
      toast.success(t('patients:archive.successToast', { label }));
      setDischargeDialogOpen(false);
      setDischargeTargetId('');
      await refreshSharedPatientDataAfterMutation();
    } catch (err: unknown) {
      console.error(`${t('patients:archive.errorLog')}:`, err);
      const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(errMsg || t('patients:archive.errorToast'));
    } finally {
      setDischargingArchiveId(null);
    }
  };


  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{t('patients:list.title')}</h1>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              <FlaskConical className="h-3.5 w-3.5" />
              {t('dashboard:header.demoDataBadge')}
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-1">{t('patients:list.subtitle')}</p>
          <DataOwnershipLegend />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('patients:list.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder={t('patients:list.filterPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('patients:list.filters.all')}</SelectItem>
                <SelectItem value="intubated">{t('patients:list.filters.intubated')}</SelectItem>
                <SelectItem value="san">{t('patients:list.filters.san')}</SelectItem>
                <SelectItem value="dnr">{t('patients:list.filters.dnr')}</SelectItem>
                {doctorOptions.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-1">{t('patients:list.filters.physicianGroup')}</div>
                    {doctorOptions.map(doc => (
                      <SelectItem key={doc} value={`doc:${doc}`}>{doc}</SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {/* Loading 狀態 */}
          {loading && (
            <TableSkeleton rows={8} columns={14} />
          )}

          {/* 錯誤狀態 */}
          {error && !loading && (
            <ErrorDisplay
              type="server"
              title={t('patients:list.loadErrorTitle')}
              message={error}
              onRetry={() => refetchPatients()}
            />
          )}

          {/* 空狀態 */}
          {!loading && !error && filteredPatients.length === 0 && (
            <EmptyState
              icon={Users}
              title={searchTerm || filterStatus !== 'all' ? t('patients:list.emptyNoMatch') : t('patients:list.emptyNone')}
              description={searchTerm || filterStatus !== 'all' ? t('patients:list.emptyHintFiltered') : t('patients:list.emptyHintNew')}
            />
          )}

          {/* 病人列表 */}
          {!loading && !error && filteredPatients.length > 0 && (
          <div className="overflow-x-auto">
          <Table className="compact-table" style={{ tableLayout: 'fixed', minWidth: '1135px' }}>
            <colgroup>
              <col style={{ width: '60px' }} />{/* 床號 */}
              <col style={{ width: '90px' }} />{/* 病例號碼 */}
              <col style={{ width: '70px' }} />{/* 姓名 */}
              <col style={{ width: '45px' }} />{/* 性別 */}
              <col style={{ width: '55px' }} />{/* 年齡 */}
              <col style={{ width: '85px' }} />{/* 主治醫師 */}
              <col style={{ width: '180px' }} />{/* 入院診斷 */}
              <col style={{ width: '130px' }} />{/* 入ICU日期 */}
              <col style={{ width: '100px' }} />{/* 呼吸器天數 */}
              <col style={{ width: '50px' }} />{/* DNR */}
              <col style={{ width: '60px' }} />{/* 過敏 */}
              <col style={{ width: '50px' }} />{/* 隔離 */}
              <col style={{ width: '72px' }} />{/* 插管 */}
              <col style={{ width: '50px' }} />{/* 轉出 */}
            </colgroup>
            <TableHeader className="[&_th]:bg-sky-50/70 dark:[&_th]:bg-sky-950/20">
              <TableRow>
                <TableHead className="text-center">{t('patients:list.table.bed')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.mrn')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.name')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.gender')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.age')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.physician')}</TableHead>
                <TableHead>{t('patients:list.table.diagnosis')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.icuAdmission')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.ventilatorDays')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.dnr')}</TableHead>
                <TableHead className="text-center">{t('patients:list.table.allergy')}</TableHead>
                <TableHead className="!bg-rose-50/80 text-center dark:!bg-rose-950/30">
                  <span className="inline-flex flex-col items-center gap-1">
                    {t('patients:list.table.isolation')}
                    <DataOwnershipBadge kind="orphan" compact />
                  </span>
                </TableHead>
                <TableHead className="text-center">{t('patients:list.table.intubation')}</TableHead>
                <TableHead className="!bg-amber-50/80 text-center dark:!bg-amber-950/30">
                  <span className="inline-flex flex-col items-center gap-1">
                    {t('patients:list.table.transferOut')}
                    <DataOwnershipBadge kind="manual" compact />
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPatients.map((patient) => (
                <TableRow
                  key={patient.id}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => navigate(`/patient/${patient.id}`)}
                >
                  <TableCell className="text-center">
                    <Badge variant="outline" className="font-semibold">
                      {patient.bedNumber}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-muted-foreground text-center">
                    {patient.medicalRecordNumber}
                  </TableCell>
                  <TableCell className="font-medium text-center">{maskPatientName(patient.name)}</TableCell>
                  <TableCell className="text-center">{patient.gender}</TableCell>
                  <TableCell className="text-center">{t('patients:list.ageSuffix', { age: patient.age })}</TableCell>
                  <TableCell className="text-center">
                    <Badge className={getDepartmentBadgeColor(patient.department)}>
                      {patient.attendingPhysician}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs leading-snug">
                    {patient.diagnosis?.split(/[;；]/).map((d, i) => {
                      const trimmed = d.trim();
                      return trimmed ? <div key={i}>{trimmed}</div> : null;
                    })}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-sm">{patient.icuAdmissionDate}</span>
                      <span className="text-xs text-muted-foreground">{t('patients:list.icuDaysSuffix', { days: getICUDays(patient.icuAdmissionDate) })}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300">
                      {t('patients:list.ventilatorDaysSuffix', { days: patient.ventilatorDays })}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {patient.hasDNR ? (
                      <Badge className="bg-brand hover:bg-brand/90">{t('patients:list.yes')}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">{t('patients:list.no')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {renderAllergyCell(patient)}
                  </TableCell>
                  <TableCell className="text-center">
                    {patient.isIsolated ? (
                      <Badge className="bg-[#f59e0b] hover:bg-[#f59e0b]/90">{t('patients:list.isolating')}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">{t('patients:list.no')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-center">
                    {patient.intubated ? (
                      <Badge variant="secondary">{getAirwayStatusLabel(patient)}</Badge>
                    ) : (
                      <Badge variant="outline">{t('patients:list.notIntubated')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {canEditPatients && (
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleOpenDischargeDialog(patient); }}
                          disabled={dischargingArchiveId === patient.id}
                          className="text-muted-foreground hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                          title={t('patients:list.transferOutTooltip')}
                        >
                          <LogOut className="h-4 w-4" />
                        </Button>
                        {dischargingArchiveId === patient.id ? <ButtonLoadingIndicator compact /> : null}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          )}

          {!loading && !error && filteredPatients.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>{t('patients:list.emptyShort')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 辦理轉出對話框（per-row, soft discharge） */}
      <PatientArchiveDialog
        open={dischargeDialogOpen}
        archivingPatient={!!dischargingArchiveId}
        archiveTargetId={dischargeTargetId}
        patients={patients}
        onOpenChange={(open) => {
          if (!open && !dischargingArchiveId) {
            setDischargeDialogOpen(false);
            setDischargeTargetId('');
          }
        }}
        onArchiveTargetChange={setDischargeTargetId}
        onConfirmArchive={handleConfirmDischarge}
        lockTarget
      />

    </div>
  );
}
