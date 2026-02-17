import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { patientsApi, type Patient } from '../lib/api';
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
import { Search, Plus, Archive, MessageCircle, Edit2, Save, X, Users } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { LoadingSpinner, ErrorDisplay, EmptyState } from '../components/ui/state-display';
import { TableSkeleton } from '../components/ui/skeletons';
import { toast } from 'sonner';

// ICU 科別選項（UI 靜態設定）
const ICU_DEPARTMENTS = ['內科-李穎灝', '內科-黃英哲', '外科'] as const;

// 擴展 Patient 類型以包含前端需要的額外欄位
interface PatientWithFrontendFields extends Patient {
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  hasUnreadMessages?: boolean;
}

export function PatientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [patients, setPatients] = useState<PatientWithFrontendFields[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // 載入病人列表
  const fetchPatients = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await patientsApi.getPatients({ limit: 100 });
      setPatients(response.patients as PatientWithFrontendFields[]);
    } catch (err) {
      console.error('載入病人列表失敗:', err);
      setError('無法載入病人列表，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  // 取得病人的 S/A/N 資料（支援兩種格式）
  const getSedation = (patient: PatientWithFrontendFields) => patient.sedation || patient.sanSummary?.sedation || [];
  const getAnalgesia = (patient: PatientWithFrontendFields) => patient.analgesia || patient.sanSummary?.analgesia || [];
  const getNmb = (patient: PatientWithFrontendFields) => patient.nmb || patient.sanSummary?.nmb || [];

  const filteredPatients = patients.filter(patient => {
    const matchSearch = patient.name.includes(searchTerm) || patient.bedNumber.includes(searchTerm);

    if (filterStatus === 'intubated') return matchSearch && patient.intubated;
    if (filterStatus === 'san') {
      return matchSearch && (
        getSedation(patient).length > 0 ||
        getAnalgesia(patient).length > 0 ||
        getNmb(patient).length > 0
      );
    }

    return matchSearch;
  });

  const getSANMarkers = (patient: PatientWithFrontendFields) => {
    const markers = [];
    if (getSedation(patient).length > 0) markers.push('S');
    if (getAnalgesia(patient).length > 0) markers.push('A');
    if (getNmb(patient).length > 0) markers.push('N');
    return markers.join('/') || '-';
  };

  // 計算 ICU 住院天數
  const getICUDays = (icuAdmissionDate: string) => {
    const today = new Date();
    const admission = new Date(icuAdmissionDate);
    const diffTime = Math.abs(today.getTime() - admission.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // 根據科別與醫師獲取背景顏色
  const getDepartmentBgColor = (department: string) => {
    // 內科統一用藍色
    if (department.includes('內科')) {
      return 'bg-blue-50 hover:bg-blue-100/70';
    }
    // 外科用橙色
    if (department.includes('外科')) {
      return 'bg-amber-50 hover:bg-amber-100/70';
    }
    return 'hover:bg-muted/50';
  };

  // 根據科別與醫師獲取標籤顏色
  const getDepartmentBadgeColor = (department: string) => {
    // 內科統一用藍色
    if (department.includes('內科')) {
      return 'bg-blue-600 text-white';
    }
    // 外科用橙色
    if (department.includes('外科')) {
      return 'bg-amber-600 text-white';
    }
    return 'bg-gray-600 text-white';
  };

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

  return (
    <div className="p-6 space-y-6 pl-16">
      <div className="flex items-center justify-between">
        <div>
          <h1>病人清單</h1>
          <p className="text-muted-foreground mt-1">檢視所有病患資料</p>
        </div>
        {user?.role === 'admin' && (
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
          <Table>
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
                <TableHead>插管狀態</TableHead>
                <TableHead>留言</TableHead>
                <TableHead className="text-right">操作</TableHead>
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
                  <TableCell className="max-w-xs truncate">{patient.diagnosis}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm">{patient.icuAdmissionDate}</span>
                      <span className="text-xs text-muted-foreground">({getICUDays(patient.icuAdmissionDate)} 天)</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-purple-50 border-purple-200 text-purple-700">
                      {patient.ventilatorDays} 天
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {patient.hasDNR ? (
                      <Badge className="bg-[#7f265b] hover:bg-[#7f265b]/90">有</Badge>
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
                  <TableCell>
                    {patient.intubated ? (
                      <Badge variant="secondary">插管中</Badge>
                    ) : (
                      <Badge variant="outline">未插管</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {patient.hasUnreadMessages ? (
                      <div className="flex items-center gap-1 text-[#ff3975]">
                        <MessageCircle className="h-4 w-4 fill-current" />
                        <span className="text-xs">未讀</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/patient/${patient.id}`);
                        }}
                      >
                        檢視
                      </Button>
                      {user?.role === 'admin' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(patient);
                            }}
                            className="text-[#7f265b] hover:text-[#7f265b] hover:bg-[#f8f9fa]"
                            title="編輯"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchivePatient(patient.id);
                            }}
                            className="text-[#6b7280] hover:text-[#7f265b] hover:bg-[#f8f9fa]"
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

      {/* 編輯病患資料對話框 */}
      {editingPatientId && editFormData && (
        <Dialog open={true} onOpenChange={handleCancel}>
          <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit2 className="h-5 w-5 text-[#7f265b]" />
                編輯病人資料
              </DialogTitle>
              <DialogDescription>
                請修改病人資料並儲存。只有管理員可以編輯。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="bedNumber" className="text-right">床號</Label>
                <Input
                  id="bedNumber"
                  value={editFormData.bedNumber}
                  onChange={(e) => setEditFormData({ ...editFormData, bedNumber: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">姓名</Label>
                <Input
                  id="name"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="gender" className="text-right">性別</Label>
                <Select 
                  value={editFormData.gender} 
                  onValueChange={(value) => setEditFormData({ ...editFormData, gender: value })}
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
                  value={editFormData.age}
                  onChange={(e) => setEditFormData({ ...editFormData, age: parseInt(e.target.value) })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="attendingPhysician" className="text-right">主治醫師</Label>
                <Input
                  id="attendingPhysician"
                  value={editFormData.attendingPhysician}
                  onChange={(e) => setEditFormData({ ...editFormData, attendingPhysician: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="department" className="text-right">科別</Label>
                <Select 
                  value={editFormData.department} 
                  onValueChange={(value) => setEditFormData({ ...editFormData, department: value })}
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICU_DEPARTMENTS.map((dept) => (
                      <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="diagnosis" className="text-right">入院診斷</Label>
                <Input
                  id="diagnosis"
                  value={editFormData.diagnosis}
                  onChange={(e) => setEditFormData({ ...editFormData, diagnosis: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="admissionDate" className="text-right">入院日期</Label>
                <Input
                  id="admissionDate"
                  type="date"
                  value={editFormData.admissionDate}
                  onChange={(e) => setEditFormData({ ...editFormData, admissionDate: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="icuAdmissionDate" className="text-right">ICU入院日期</Label>
                <Input
                  id="icuAdmissionDate"
                  type="date"
                  value={editFormData.icuAdmissionDate}
                  onChange={(e) => setEditFormData({ ...editFormData, icuAdmissionDate: e.target.value })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="ventilatorDays" className="text-right">呼吸器天數</Label>
                <Input
                  id="ventilatorDays"
                  type="number"
                  value={editFormData.ventilatorDays}
                  onChange={(e) => setEditFormData({ ...editFormData, ventilatorDays: parseInt(e.target.value) })}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="intubated" className="text-right">插管狀態</Label>
                <div className="col-span-3 flex items-center gap-2">
	                  <Checkbox
	                    id="intubated"
	                    checked={editFormData.intubated}
	                    onCheckedChange={(checked) =>
	                      setEditFormData({ ...editFormData, intubated: checked === true })
	                    }
	                  />
                  <span className="text-sm text-muted-foreground">勾選表示插管中</span>
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="sedation" className="text-right">鎮靜劑 (S)</Label>
	                <Input
	                  id="sedation"
	                  value={(editFormData.sedation ?? []).join(', ')}
	                  onChange={(e) => setEditFormData({ 
	                    ...editFormData, 
	                    sedation: e.target.value ? e.target.value.split(',').map(s => s.trim()) : [] 
	                  })}
                  className="col-span-3"
                  placeholder="多個藥品用逗號分隔，例：Dormicum, Propofol"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="analgesia" className="text-right">止痛劑 (A)</Label>
	                <Input
	                  id="analgesia"
	                  value={(editFormData.analgesia ?? []).join(', ')}
	                  onChange={(e) => setEditFormData({ 
	                    ...editFormData, 
	                    analgesia: e.target.value ? e.target.value.split(',').map(s => s.trim()) : [] 
	                  })}
                  className="col-span-3"
                  placeholder="多個藥品用逗號分隔，例：Morphine, Fentanyl"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="nmb" className="text-right">神經肌肉阻斷劑 (N)</Label>
	                <Input
	                  id="nmb"
	                  value={(editFormData.nmb ?? []).join(', ')}
	                  onChange={(e) => setEditFormData({ 
	                    ...editFormData, 
	                    nmb: e.target.value ? e.target.value.split(',').map(s => s.trim()) : [] 
	                  })}
                  className="col-span-3"
                  placeholder="多個藥品用逗號分隔，例：Cisatracurium"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="consentStatus" className="text-right">同意書狀態</Label>
                <Select 
                  value={editFormData.consentStatus} 
                  onValueChange={(value) => setEditFormData({ ...editFormData, consentStatus: value })}
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
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="hasUnreadMessages" className="text-right">未讀留言</Label>
                <div className="col-span-3 flex items-center gap-2">
	                  <Checkbox
	                    id="hasUnreadMessages"
	                    checked={editFormData.hasUnreadMessages}
	                    onCheckedChange={(checked) =>
	                      setEditFormData({ ...editFormData, hasUnreadMessages: checked === true })
	                    }
	                  />
                  <span className="text-sm text-muted-foreground">勾選表示有未讀留言</span>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleCancel}
              >
                <X className="mr-2 h-4 w-4" />
                取消
              </Button>
              <Button
                onClick={handleSave}
                className="bg-[#7f265b] hover:bg-[#631e4d]"
              >
                <Save className="mr-2 h-4 w-4" />
                儲存變更
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 新增病患對話框 */}
      {addDialogOpen && (
        <Dialog open={true} onOpenChange={(open) => { if (!open && !creatingPatient) { setAddDialogOpen(false); resetNewPatientForm(); } }}>
          <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-[#7f265b]" />
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
                className="bg-[#7f265b] hover:bg-[#631e4d]"
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
                <Archive className="h-5 w-5 text-[#7f265b]" />
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
                className="bg-[#7f265b] hover:bg-[#631e4d]"
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
