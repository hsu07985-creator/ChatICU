import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { patientsApi, type Patient } from '../lib/api';
import { getCachedPatients, getCachedPatientsSync, invalidatePatients, isPatientsCacheFresh } from '../lib/patients-cache';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Search, Plus, Archive, Edit2, Save, X, Users, LogOut } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { PatientEditDialog } from '../components/patient/dialogs/patient-edit-dialog';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { ErrorDisplay, EmptyState } from '../components/ui/state-display';
import { TableSkeleton } from '../components/ui/skeletons';
import { toast } from 'sonner';

interface PatientWithFrontendFields extends Patient {
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  hasUnreadMessages?: boolean;
}

// ICU 科別選項（UI 靜態設定）
const ICU_DEPARTMENTS = ['內科-李穎灝', '內科-黃英哲', '外科'] as const;

export function PatientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const cached = getCachedPatientsSync();
  const [patients, setPatients] = useState<PatientWithFrontendFields[]>((cached ?? []) as PatientWithFrontendFields[]);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  const fetchPatients = useCallback(async () => {
    try {
      if (patients.length === 0) setLoading(true);
      setError(null);
      const data = await invalidatePatients();
      setPatients(data as PatientWithFrontendFields[]);
    } catch (err) {
      console.error('載入病人列表失敗:', err);
      setError('無法載入病人列表，請稍後再試');
    } finally {
      setLoading(false);
    }
  }, [patients.length]);

  useEffect(() => {
    // Skip fetch if sync cache already populated initial state
    if (!cached) {
      fetchPatients();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getSedation = (patient: PatientWithFrontendFields) => patient.sedation || patient.sanSummary?.sedation || [];
  const getAnalgesia = (patient: PatientWithFrontendFields) => patient.analgesia || patient.sanSummary?.analgesia || [];
  const getNmb = (patient: PatientWithFrontendFields) => patient.nmb || patient.sanSummary?.nmb || [];

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

  const getDepartmentBgColor = (department: string | null | undefined) => {
    if (department?.includes('內科')) return 'bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:hover:bg-blue-900/40';
    if (department?.includes('外科')) return 'bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-900/40';
    return 'hover:bg-muted/50';
  };

  const getDepartmentBadgeColor = (department: string | null | undefined) => {
    if (department?.includes('內科')) return 'bg-blue-600 text-white dark:bg-blue-700';
    if (department?.includes('外科')) return 'bg-amber-600 text-white dark:bg-amber-700';
    return 'bg-gray-600 text-white dark:bg-gray-700';
  };

  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<PatientWithFrontendFields | null>(null);

  // 新增病患 / 封存病患
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [archivingPatient, setArchivingPatient] = useState(false);
  const [archiveTargetId, setArchiveTargetId] = useState<string>('');

  const [newPatient, setNewPatient] = useState({
    bedNumber: '',
    medicalRecordNumber: '',
    name: '',
    gender: '男' as '男' | '女',
    age: '',
    attendingPhysician: '',
    department: '',
    diagnosis: '',
    admissionDate: '',
    icuAdmissionDate: '',
    ventilatorDays: '',
    intubated: false,
    hasDNR: false,
    isIsolated: false,
    sedation: '',
    analgesia: '',
    nmb: '',
  });

  const handleEdit = (patient: PatientWithFrontendFields) => {
    setEditingPatientId(patient.id);
    setEditFormData({ ...patient });
  };

  const handleSave = async () => {
    if (editFormData && editingPatientId) {
      try {
        await patientsApi.updatePatient(editingPatientId, editFormData);
        // 重新載入列表以獲取最新資料
        await fetchPatients();
        setEditingPatientId(null);
        setEditFormData(null);
        toast.success('病人資料已更新');
      } catch (err) {
        console.error('更新病人資料失敗:', err);
        toast.error('更新失敗，請稍後再試');
      }
    }
  };

  const handleCancel = () => {
    setEditingPatientId(null);
    setEditFormData(null);
  };

  const resetNewPatientForm = () => {
    setNewPatient({
      bedNumber: '',
      medicalRecordNumber: '',
      name: '',
      gender: '男',
      age: '',
      attendingPhysician: '',
      department: '',
      diagnosis: '',
      admissionDate: '',
      icuAdmissionDate: '',
      ventilatorDays: '',
      intubated: false,
      hasDNR: false,
      isIsolated: false,
      sedation: '',
      analgesia: '',
      nmb: '',
    });
  };

  const handleCreatePatient = async () => {
    if (!newPatient.bedNumber.trim() || !newPatient.medicalRecordNumber.trim() || !newPatient.name.trim()) {
      toast.error('請填寫床號、病歷號、姓名');
      return;
    }
    if (!newPatient.age || !Number.isFinite(Number(newPatient.age))) {
      toast.error('請填寫正確年齡');
      return;
    }
    if (!newPatient.diagnosis.trim()) {
      toast.error('請填寫入院診斷');
      return;
    }

    setCreatingPatient(true);
    try {
      const sedation = newPatient.sedation
        ? newPatient.sedation.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const analgesia = newPatient.analgesia
        ? newPatient.analgesia.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      const nmb = newPatient.nmb
        ? newPatient.nmb.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      const created = await patientsApi.createPatient({
        bedNumber: newPatient.bedNumber.trim(),
        medicalRecordNumber: newPatient.medicalRecordNumber.trim(),
        name: newPatient.name.trim(),
        gender: newPatient.gender,
        age: Number(newPatient.age),
        diagnosis: newPatient.diagnosis.trim(),
        intubated: newPatient.intubated,
        admissionDate: newPatient.admissionDate || undefined,
        icuAdmissionDate: newPatient.icuAdmissionDate || undefined,
        ventilatorDays: newPatient.ventilatorDays ? Number(newPatient.ventilatorDays) : 0,
        attendingPhysician: newPatient.attendingPhysician.trim() || undefined,
        department: newPatient.department.trim() || undefined,
        sedation,
        analgesia,
        nmb,
        hasDNR: newPatient.hasDNR,
        isIsolated: newPatient.isIsolated,
        criticalStatus: undefined,
      });

      toast.success(`已新增病患：${created.bedNumber} ${created.name}`);
      setAddDialogOpen(false);
      resetNewPatientForm();
      await fetchPatients();
    } catch (err: unknown) {
      console.error('新增病患失敗:', err);
      const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(errMsg || '新增病患失敗，請稍後再試');
    } finally {
      setCreatingPatient(false);
    }
  };

  const handleArchivePatient = async (patientId: string) => {
    if (!patientId) return;
    const target = patients.find((p) => p.id === patientId);
    const label = target ? `${target.bedNumber} ${target.name}` : patientId;
    if (!confirm(`確定要封存病患：${label}？`)) return;

    setArchivingPatient(true);
    try {
      await patientsApi.archivePatient(patientId, { archived: true });
      toast.success(`已封存病患：${label}`);
      setArchiveDialogOpen(false);
      setArchiveTargetId('');
      await fetchPatients();
    } catch (err: unknown) {
      console.error('封存病患失敗:', err);
      const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(errMsg || '封存失敗，請稍後再試');
    } finally {
      setArchivingPatient(false);
    }
  };

  const handleDischargePatient = async (patientId: string) => {
    if (!patientId) return;
    const target = patients.find((p) => p.id === patientId);
    const label = target ? `${target.bedNumber} ${target.name}` : patientId;
    if (!confirm(`⚠️ 確定要出院刪除病患：${label}？\n\n此操作會永久刪除該病人及所有用藥、檢驗、培養、報告等資料，無法復原！`)) return;

    try {
      await patientsApi.dischargePatient(patientId);
      toast.success(`病患 ${label} 已出院刪除`);
      await fetchPatients();
    } catch (err: unknown) {
      console.error('出院刪除失敗:', err);
      const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(errMsg || '出院刪除失敗，請稍後再試');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">病人清單</h1>
          <p className="text-muted-foreground text-sm mt-1">檢視所有病患資料</p>
        </div>
        {(user?.role === 'admin' || user?.role === 'pharmacist') && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setArchiveDialogOpen(true)}>
              <Archive className="mr-2 h-4 w-4" />
              封存病人
            </Button>
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新增病人
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋姓名或床號..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="篩選條件" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部病患</SelectItem>
                <SelectItem value="intubated">插管中</SelectItem>
                <SelectItem value="san">使用 S/A/N</SelectItem>
                <SelectItem value="dnr">DNR</SelectItem>
                {doctorOptions.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-1">主治醫師</div>
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
            <TableSkeleton rows={8} columns={12} />
          )}

          {/* 錯誤狀態 */}
          {error && !loading && (
            <ErrorDisplay
              type="server"
              title="載入失敗"
              message={error}
              onRetry={fetchPatients}
            />
          )}

          {/* 空狀態 */}
          {!loading && !error && filteredPatients.length === 0 && (
            <EmptyState
              icon={Users}
              title={searchTerm || filterStatus !== 'all' ? '找不到符合條件的病人' : '目前沒有病人'}
              description={searchTerm || filterStatus !== 'all' ? '請嘗試調整搜尋條件' : '開始新增第一位病人'}
            />
          )}

          {/* 病人列表 */}
          {!loading && !error && filteredPatients.length > 0 && (
          <div className="overflow-x-auto">
          <Table className="compact-table" style={{ tableLayout: 'fixed', minWidth: '1100px' }}>
            <colgroup>
              <col style={{ width: '60px' }} />    {/* 床號 */}
              <col style={{ width: '90px' }} />    {/* 病例號碼 */}
              <col style={{ width: '70px' }} />    {/* 姓名 */}
              <col style={{ width: '45px' }} />    {/* 性別 */}
              <col style={{ width: '55px' }} />    {/* 年齡 */}
              <col style={{ width: '85px' }} />    {/* 主治醫師 */}
              <col style={{ width: 'auto' }} />    {/* 入院診斷 — flex fill */}
              <col style={{ width: '130px' }} />   {/* 入ICU日期 */}
              <col style={{ width: '75px' }} />    {/* 呼吸器天數 */}
              <col style={{ width: '50px' }} />    {/* DNR */}
              <col style={{ width: '50px' }} />    {/* 隔離 */}
              <col style={{ width: '72px' }} />    {/* 插管 */}
              <col style={{ width: '80px' }} />    {/* 操作 */}
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>床號</TableHead>
                <TableHead>病例號碼</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>性別</TableHead>
                <TableHead>年齡</TableHead>
                <TableHead>主治醫師</TableHead>
                <TableHead>入院診斷</TableHead>
                <TableHead>入ICU日期</TableHead>
                <TableHead>呼吸器天數</TableHead>
                <TableHead>DNR</TableHead>
                <TableHead>隔離</TableHead>
                <TableHead>插管</TableHead>
                <TableHead className="text-center">出院</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPatients.map((patient) => (
                <TableRow 
                  key={patient.id}
                  className={`cursor-pointer transition-colors ${getDepartmentBgColor(patient.department)}`}
                  onClick={() => navigate(`/patient/${patient.id}`)}
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
                  <TableCell className="whitespace-normal text-xs leading-snug">
                    {patient.diagnosis?.split(/[;；]/).map((d, i) => {
                      const trimmed = d.trim();
                      return trimmed ? <div key={i}>{trimmed}</div> : null;
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm">{patient.icuAdmissionDate}</span>
                      <span className="text-xs text-muted-foreground">({getICUDays(patient.icuAdmissionDate)} 天)</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-300">
                      {patient.ventilatorDays} 天
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {patient.hasDNR ? (
                      <Badge className="bg-brand hover:bg-brand/90">有</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">無</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {patient.isIsolated ? (
                      <Badge className="bg-[#f59e0b] hover:bg-[#f59e0b]/90">隔離</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">無</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {patient.intubated ? (
                      <Badge variant="secondary">插管中</Badge>
                    ) : (
                      <Badge variant="outline">未插管</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex gap-1 justify-center">
                      {(user?.role === 'admin' || user?.role === 'pharmacist') && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(patient);
                            }}
                            className="text-brand hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-800"
                            title="編輯"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDischargePatient(patient.id);
                            }}
                            className="text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                            title="出院"
                          >
                            <LogOut className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          )}

          {!loading && !error && filteredPatients.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>沒有符合條件的病患</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 編輯病患資料對話框 */}
      <PatientEditDialog
        patient={editFormData}
        onPatientChange={setEditFormData}
        onCancel={handleCancel}
        onSave={handleSave}
      />

      {/* 新增病患對話框 */}
      {addDialogOpen && (
        <Dialog open={true} onOpenChange={(open) => { if (!open && !creatingPatient) { setAddDialogOpen(false); resetNewPatientForm(); } }}>
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
                  onChange={(e) => setNewPatient({ ...newPatient, bedNumber: e.target.value })}
                  className="col-span-3"
                  placeholder="例：I-1"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">病歷號 *</Label>
                <Input
                  value={newPatient.medicalRecordNumber}
                  onChange={(e) => setNewPatient({ ...newPatient, medicalRecordNumber: e.target.value })}
                  className="col-span-3"
                  placeholder="例：123456"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">姓名 *</Label>
                <Input
                  value={newPatient.name}
                  onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">性別 *</Label>
                <Select value={newPatient.gender} onValueChange={(value) => setNewPatient({ ...newPatient, gender: value as '男' | '女' })}>
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
                  onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">主治醫師</Label>
                <Input
                  value={newPatient.attendingPhysician}
                  onChange={(e) => setNewPatient({ ...newPatient, attendingPhysician: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">科別</Label>
                <Input
                  value={newPatient.department}
                  onChange={(e) => setNewPatient({ ...newPatient, department: e.target.value })}
                  className="col-span-3"
                  placeholder="例：內科 / 外科"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">入院診斷 *</Label>
                <Input
                  value={newPatient.diagnosis}
                  onChange={(e) => setNewPatient({ ...newPatient, diagnosis: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">入院日期</Label>
                <Input
                  type="date"
                  value={newPatient.admissionDate}
                  onChange={(e) => setNewPatient({ ...newPatient, admissionDate: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">ICU 入院日期</Label>
                <Input
                  type="date"
                  value={newPatient.icuAdmissionDate}
                  onChange={(e) => setNewPatient({ ...newPatient, icuAdmissionDate: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">呼吸器天數</Label>
                <Input
                  type="number"
                  value={newPatient.ventilatorDays}
                  onChange={(e) => setNewPatient({ ...newPatient, ventilatorDays: e.target.value })}
                  className="col-span-3"
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">插管狀態</Label>
                <div className="col-span-3 flex items-center gap-2">
                  <Checkbox
                    checked={newPatient.intubated}
                    onCheckedChange={(checked) => setNewPatient({ ...newPatient, intubated: Boolean(checked) })}
                  />
                  <span className="text-sm text-muted-foreground">勾選表示插管中</span>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">DNR</Label>
                <div className="col-span-3 flex items-center gap-2">
                  <Checkbox
                    checked={newPatient.hasDNR}
                    onCheckedChange={(checked) => setNewPatient({ ...newPatient, hasDNR: Boolean(checked) })}
                  />
                  <span className="text-sm text-muted-foreground">有 DNR</span>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">隔離</Label>
                <div className="col-span-3 flex items-center gap-2">
                  <Checkbox
                    checked={newPatient.isIsolated}
                    onCheckedChange={(checked) => setNewPatient({ ...newPatient, isIsolated: Boolean(checked) })}
                  />
                  <span className="text-sm text-muted-foreground">隔離中</span>
                </div>
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">鎮靜劑 (S)</Label>
                <Input
                  value={newPatient.sedation}
                  onChange={(e) => setNewPatient({ ...newPatient, sedation: e.target.value })}
                  className="col-span-3"
                  placeholder="多個藥品用逗號分隔，例：Dormicum, Propofol"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">止痛劑 (A)</Label>
                <Input
                  value={newPatient.analgesia}
                  onChange={(e) => setNewPatient({ ...newPatient, analgesia: e.target.value })}
                  className="col-span-3"
                  placeholder="多個藥品用逗號分隔，例：Morphine, Fentanyl"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">神經肌肉阻斷 (N)</Label>
                <Input
                  value={newPatient.nmb}
                  onChange={(e) => setNewPatient({ ...newPatient, nmb: e.target.value })}
                  className="col-span-3"
                  placeholder="多個藥品用逗號分隔，例：Cisatracurium"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { if (!creatingPatient) { setAddDialogOpen(false); resetNewPatientForm(); } }}
                disabled={creatingPatient}
              >
                取消
              </Button>
              <Button
                onClick={handleCreatePatient}
                disabled={creatingPatient}
                className="bg-brand hover:bg-brand-hover"
              >
                {creatingPatient ? '建立中...' : '建立病患'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 封存病患對話框 */}
      {archiveDialogOpen && (
        <Dialog open={true} onOpenChange={(open) => { if (!open && !archivingPatient) { setArchiveDialogOpen(false); setArchiveTargetId(''); } }}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-brand" />
                封存病患
              </DialogTitle>
              <DialogDescription>
                封存後該病患將不會出現在一般清單中（可用於出院/轉出/結案）。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Label>選擇病患</Label>
              <Select value={archiveTargetId} onValueChange={setArchiveTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="請選擇病患..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.bedNumber} - {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { if (!archivingPatient) { setArchiveDialogOpen(false); setArchiveTargetId(''); } }}
                disabled={archivingPatient}
              >
                取消
              </Button>
              <Button
                onClick={() => handleArchivePatient(archiveTargetId)}
                disabled={archivingPatient || !archiveTargetId}
                className="bg-brand hover:bg-brand-hover"
              >
                {archivingPatient ? '封存中...' : '確認封存'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
