import { Archive, Edit2, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { maskPatientName } from '../../lib/utils/patient-name';
import { Card, CardContent, CardHeader } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Button } from '../ui/button';
import { EmptyState, ErrorDisplay } from '../ui/state-display';
import { TableSkeleton } from '../ui/skeletons';
import type { PatientWithFrontendFields } from '../../features/patients/types';
import { getAirwayStatusLabel } from '../../lib/patient-airway';

interface PatientsListCardProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  filterStatus: string;
  onFilterStatusChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  filteredPatients: PatientWithFrontendFields[];
  isAdmin: boolean;
  onRetry: () => void;
  onOpenPatient: (patientId: string) => void;
  onEditPatient: (patient: PatientWithFrontendFields) => void;
  onArchivePatient: (patientId: string) => void;
  getICUDays: (icuAdmissionDate: string) => number;
  getDepartmentBgColor: (department: string) => string;
  getDepartmentBadgeColor: (department: string) => string;
}

export function PatientsListCard({
  searchTerm,
  onSearchTermChange,
  filterStatus,
  onFilterStatusChange,
  loading,
  error,
  filteredPatients,
  isAdmin,
  onRetry,
  onOpenPatient,
  onEditPatient,
  onArchivePatient,
  getICUDays,
  getDepartmentBgColor,
  getDepartmentBadgeColor,
}: PatientsListCardProps) {
  const { t } = useTranslation('patients');
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('list.searchPlaceholder')}
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={onFilterStatusChange}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder={t('list.filterPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('list.filters.all')}</SelectItem>
              <SelectItem value="intubated">{t('list.filters.intubated')}</SelectItem>
              <SelectItem value="san">{t('list.filters.san')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <TableSkeleton rows={8} columns={12} />}

        {error && !loading && (
          <ErrorDisplay type="server" title={t('list.loadErrorTitle')} message={error} onRetry={onRetry} />
        )}

        {!loading && !error && filteredPatients.length === 0 && (
          <EmptyState
            icon={Users}
            title={searchTerm || filterStatus !== 'all' ? t('list.emptyNoMatch') : t('list.emptyNone')}
            description={searchTerm || filterStatus !== 'all' ? t('list.emptyHintFiltered') : t('list.emptyHintNew')}
          />
        )}

        {!loading && !error && filteredPatients.length > 0 && (
          <Table className="compact-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('list.table.bed')}</TableHead>
                <TableHead>{t('list.table.mrn')}</TableHead>
                <TableHead>{t('list.table.name')}</TableHead>
                <TableHead>{t('list.table.gender')}</TableHead>
                <TableHead>{t('list.table.age')}</TableHead>
                <TableHead>{t('list.table.physician')}</TableHead>
                <TableHead>{t('list.table.diagnosis')}</TableHead>
                <TableHead>{t('list.table.icuAdmissionWithStay')}</TableHead>
                <TableHead>{t('list.table.ventilatorDays')}</TableHead>
                <TableHead>{t('list.table.dnr')}</TableHead>
                <TableHead>{t('list.table.isolation')}</TableHead>
                <TableHead>{t('list.table.intubation')}</TableHead>
                <TableHead className="text-center w-8">{t('list.table.messages')}</TableHead>
                <TableHead className="text-right">{t('list.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPatients.map((patient) => (
                <TableRow
                  key={patient.id}
                  className={`cursor-pointer transition-colors ${getDepartmentBgColor(patient.department)}`}
                  onClick={() => onOpenPatient(patient.id)}
                >
                  <TableCell>
                    <Badge variant="outline" className="font-semibold">
                      {patient.bedNumber}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-muted-foreground">
                    {patient.medicalRecordNumber}
                  </TableCell>
                  <TableCell className="font-medium">{maskPatientName(patient.name)}</TableCell>
                  <TableCell>{patient.gender}</TableCell>
                  <TableCell>{t('list.ageSuffix', { age: patient.age })}</TableCell>
                  <TableCell>
                    <Badge className={getDepartmentBadgeColor(patient.department)}>
                      {patient.attendingPhysician}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{patient.diagnosis}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm">{patient.icuAdmissionDate}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('list.icuDaysSuffix', { days: getICUDays(patient.icuAdmissionDate) })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300">
                      {t('list.ventilatorDaysSuffix', { days: patient.ventilatorDays })}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {patient.hasDNR ? (
                      <Badge className="bg-brand hover:bg-brand/90">{t('list.yes')}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        {t('list.no')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {patient.isIsolated ? (
                      <Badge className="bg-[#f59e0b] hover:bg-[#f59e0b]/90">{t('list.isolating')}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        {t('list.no')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {patient.intubated ? (
                      <Badge variant="secondary">{getAirwayStatusLabel(patient)}</Badge>
                    ) : (
                      <Badge variant="outline">{t('list.notIntubated')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {patient.hasUnreadMessages ? (
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff3975]" title={t('list.unreadMessagesTooltip')} />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenPatient(patient.id);
                        }}
                      >
                        {t('list.viewAction')}
                      </Button>
                      {isAdmin && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              onEditPatient(patient);
                            }}
                            className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            title={t('list.editTooltip')}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              onArchivePatient(patient.id);
                            }}
                            className="text-muted-foreground hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            title={t('list.archiveTooltip')}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!loading && !error && filteredPatients.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>{t('list.emptyShort')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
