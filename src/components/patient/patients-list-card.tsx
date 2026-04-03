import { Archive, Edit2, Search, Users } from 'lucide-react';
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
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋姓名或床號..."
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={onFilterStatusChange}>
            <SelectTrigger className="w-full md:w-[200px]">
              <SelectValue placeholder="篩選條件" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部病患</SelectItem>
              <SelectItem value="intubated">插管中</SelectItem>
              <SelectItem value="san">使用 S/A/N</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <TableSkeleton rows={8} columns={12} />}

        {error && !loading && (
          <ErrorDisplay type="server" title="載入失敗" message={error} onRetry={onRetry} />
        )}

        {!loading && !error && filteredPatients.length === 0 && (
          <EmptyState
            icon={Users}
            title={searchTerm || filterStatus !== 'all' ? '找不到符合條件的病人' : '目前沒有病人'}
            description={searchTerm || filterStatus !== 'all' ? '請嘗試調整搜尋條件' : '開始新增第一位病人'}
          />
        )}

        {!loading && !error && filteredPatients.length > 0 && (
          <Table className="compact-table">
            <TableHeader>
              <TableRow>
                <TableHead>床號</TableHead>
                <TableHead>病例號碼</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>性別</TableHead>
                <TableHead>年齡</TableHead>
                <TableHead>主治醫師</TableHead>
                <TableHead>入院診斷</TableHead>
                <TableHead>入ICU日期（住院天數）</TableHead>
                <TableHead>呼吸器天數</TableHead>
                <TableHead>DNR</TableHead>
                <TableHead>隔離</TableHead>
                <TableHead>插管</TableHead>
                <TableHead className="text-center w-8">留言</TableHead>
                <TableHead className="text-right">操作</TableHead>
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
                  <TableCell className="font-medium">{patient.name}</TableCell>
                  <TableCell>{patient.gender}</TableCell>
                  <TableCell>{patient.age} 歲</TableCell>
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
                        ({getICUDays(patient.icuAdmissionDate)} 天)
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700">
                      {patient.ventilatorDays} 天
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {patient.hasDNR ? (
                      <Badge className="bg-brand hover:bg-brand/90">有</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        無
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {patient.isIsolated ? (
                      <Badge className="bg-[#f59e0b] hover:bg-[#f59e0b]/90">隔離</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        無
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {patient.intubated ? (
                      <Badge variant="secondary">插管中</Badge>
                    ) : (
                      <Badge variant="outline">未插管</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {patient.hasUnreadMessages ? (
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff3975]" title="有未讀留言" />
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
                        檢視
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
                            className="text-brand hover:text-brand hover:bg-slate-50"
                            title="編輯"
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
                            className="text-muted-foreground hover:text-brand hover:bg-slate-50"
                            title="封存"
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
            <p>沒有符合條件的病患</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
