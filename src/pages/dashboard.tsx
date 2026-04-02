import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Search, AlertCircle, Pencil, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getPatients, Patient, updatePatient } from '../lib/api/patients';
import { getDashboardStats, DashboardStats } from '../lib/api/dashboard';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';

// 編輯表單的數據類型
interface EditFormData {
  name: string;
  bedNumber: string;
  diagnosis: string;
  intubated: boolean;
  age: number;
  attendingPhysician: string;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('bed');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編輯對話框狀態
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [editFormData, setEditFormData] = useState<EditFormData>({
    name: '',
    bedNumber: '',
    diagnosis: '',
    intubated: false,
    age: 0,
    attendingPhysician: '',
  });
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // 卡片欄數: 2=大卡(2欄), 3=標準(3欄), 4=小卡(4欄), 6=迷你(6欄)
  const GRID_OPTIONS = [2, 3, 4, 6] as const;
  const [gridCols, setGridCols] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('dashboard-grid-cols');
      return saved ? Number(saved) : 3;
    } catch { return 3; }
  });

  const changeGridCols = useCallback((cols: number) => {
    setGridCols(cols);
    localStorage.setItem('dashboard-grid-cols', String(cols));
  }, []);

  // 從 API 獲取病患列表
  const fetchPatients = async () => {
    setError(null);
    try {
      const res = await getPatients();
      setPatients(res.patients);
    } catch (err) {
      console.error('載入病患列表失敗:', err);
      setError('無法連線至伺服器，請確認後端服務是否正常運行');
      setPatients([]);
    } finally {
      setLoading(false);
    }
  };

  // 從 API 獲取儀表板統計
  const fetchStats = async () => {
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch (err) {
      console.error('載入統計數據失敗:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
    fetchStats();
  }, []);

  // 開啟編輯對話框
  const handleEditClick = (e: React.MouseEvent, patient: Patient) => {
    e.stopPropagation(); // 阻止點擊傳播到卡片
    setEditingPatient(patient);
    setEditFormData({
      name: patient.name,
      bedNumber: patient.bedNumber,
      diagnosis: patient.diagnosis,
      intubated: patient.intubated,
      age: patient.age,
      attendingPhysician: patient.attendingPhysician,
    });
    setEditDialogOpen(true);
  };

  // 儲存編輯
  const handleSaveEdit = async () => {
    if (!editingPatient) return;

    setSaving(true);
    try {
      const updated = await updatePatient(editingPatient.id, editFormData);
      // 更新本地狀態
      setPatients(prev => prev.map(p =>
        p.id === editingPatient.id ? { ...p, ...updated } : p
      ));
      setEditDialogOpen(false);
      toast.success('病患資料已更新');
    } catch (err) {
      console.error('更新失敗:', err);
      toast.error('更新失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  // 篩選與排序
  let filteredPatients = patients.filter(patient => {
    const matchSearch = patient.name.includes(searchTerm) || patient.bedNumber.includes(searchTerm);

    if (filterStatus === 'intubated') return matchSearch && patient.intubated;
    if (filterStatus === 'san') {
      const sedation = patient.sedation || patient.sanSummary?.sedation || [];
      const analgesia = patient.analgesia || patient.sanSummary?.analgesia || [];
      const nmb = patient.nmb || patient.sanSummary?.nmb || [];
      return matchSearch && (sedation.length > 0 || analgesia.length > 0 || nmb.length > 0);
    }
    if (filterStatus === 'alerts') return matchSearch && patient.alerts.length > 0;

    return matchSearch;
  });

  if (sortBy === 'bed') {
    filteredPatients = [...filteredPatients].sort((a, b) => a.bedNumber.localeCompare(b.bedNumber));
  } else if (sortBy === 'admission') {
    filteredPatients = [...filteredPatients].sort((a, b) => new Date(b.admissionDate).getTime() - new Date(a.admissionDate).getTime());
  }

  const getSANBadges = (patient: Patient) => {
    const badges = [];
    const sedation = patient.sedation || patient.sanSummary?.sedation || [];
    const analgesia = patient.analgesia || patient.sanSummary?.analgesia || [];
    const nmb = patient.nmb || patient.sanSummary?.nmb || [];

    if (sedation.length > 0) {
      badges.push({ label: 'S', items: sedation, color: 'bg-blue-100 text-blue-800' });
    }
    if (analgesia.length > 0) {
      badges.push({ label: 'A', items: analgesia, color: 'bg-green-100 text-green-800' });
    }
    if (nmb.length > 0) {
      badges.push({ label: 'N', items: nmb, color: 'bg-purple-100 text-purple-800' });
    }
    return badges;
  };

  return (
    <div className="p-6 space-y-6 pl-16">
      <div>
        <h1>加護病房總覽</h1>
        <p className="text-muted-foreground mt-1">即時病床與病患狀態監控</p>
      </div>

      {/* ICU 指標（水平高密度） */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {statsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid"
                style={{ minWidth: '760px', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
              >
                <div className="bg-[#7f265b]/[0.04] px-4 py-4">
                  <p className="text-xs font-medium text-[#6b7280]">病患總數</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-[#1a1a1a]">{stats?.patients?.total ?? 0}</p>
                </div>
                <div className="border-l border-[#e5e7eb] px-4 py-4">
                  <p className="text-xs font-medium text-[#6b7280]">插管人數</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-[#1a1a1a]">{stats?.patients?.intubated ?? 0}</p>
                </div>
                <div className="border-l border-[#e5e7eb] px-4 py-4">
                  <p className="text-xs font-semibold text-[#1a1a1a]">S 鎮靜</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-[#1a1a1a]">
                    {stats?.patients?.sanByCategory?.sedation ?? 0}
                  </p>
                </div>
                <div className="border-l border-[#e5e7eb] px-4 py-4">
                  <p className="text-xs font-semibold text-emerald-700">A 止痛</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-emerald-900">
                    {stats?.patients?.sanByCategory?.analgesia ?? 0}
                  </p>
                </div>
                <div className="border-l border-[#e5e7eb] px-4 py-4">
                  <p className="text-xs font-semibold text-violet-700">N 阻斷</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-violet-900">
                    {stats?.patients?.sanByCategory?.nmb ?? 0}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 搜尋與篩選 */}
      <Card>
        <CardHeader>
          <CardTitle>病患卡片清單</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="篩選條件" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部病患</SelectItem>
                <SelectItem value="intubated">插管中</SelectItem>
                <SelectItem value="san">使用 S/A/N</SelectItem>
                <SelectItem value="alerts">有警示</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="排序方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bed">依床號</SelectItem>
                <SelectItem value="admission">依入住時間</SelectItem>
              </SelectContent>
            </Select>
            {/* 卡片縮放 */}
            <div className="flex items-center gap-1.5 border rounded-md px-2 h-9 shrink-0">
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 p-0"
                disabled={gridCols >= GRID_OPTIONS[GRID_OPTIONS.length - 1]}
                onClick={() => {
                  const idx = GRID_OPTIONS.indexOf(gridCols as typeof GRID_OPTIONS[number]);
                  if (idx < GRID_OPTIONS.length - 1) changeGridCols(GRID_OPTIONS[idx + 1]);
                }}
                title="縮小卡片"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground w-8 text-center">{gridCols}欄</span>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 p-0"
                disabled={gridCols <= GRID_OPTIONS[0]}
                onClick={() => {
                  const idx = GRID_OPTIONS.indexOf(gridCols as typeof GRID_OPTIONS[number]);
                  if (idx > 0) changeGridCols(GRID_OPTIONS[idx - 1]);
                }}
                title="放大卡片"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* 病患卡片 */}
          <div
            className="grid gap-4 transition-all duration-200"
            style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
          >
            {filteredPatients.map((patient) => (
              <Card
                key={patient.id}
                className="group cursor-pointer hover:shadow-xl transition-all duration-200 hover:border-primary/30 bg-white relative"
                onClick={() => navigate(`/patient/${patient.id}`)}
              >
                {/* 編輯按鈕 */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-[#6b7280] hover:text-[#7f265b] hover:bg-[#7f265b]/10 z-10"
                  onClick={(e) => handleEditClick(e, patient)}
                  title="編輯病患資料"
                >
                  <Pencil className="h-4 w-4" />
                </Button>

                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 pr-8">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-xl text-[#1a1a1a]">{patient.name}</CardTitle>
                        {patient.intubated && (
                          <Badge variant="secondary" className="bg-[#f8f9fa] text-[#7f265b] border border-[#e5e7eb]">
                            插管中
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {patient.age} 歲 · 住院 {Math.floor((new Date().getTime() - new Date(patient.admissionDate).getTime()) / (1000 * 60 * 60 * 24))} 天
                      </p>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-[#7f265b] text-white flex items-center justify-center font-bold text-lg shadow-lg">
                      {patient.bedNumber}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="bg-[#f8f9fa] p-3 rounded-lg border border-[#e5e7eb]">
                    <p className="text-xs font-medium text-muted-foreground mb-1">入院診斷</p>
                    <p className="text-sm font-medium text-[#1a1a1a]">{patient.diagnosis}</p>
                  </div>

                  {/* S/A/N 標記 - 緊湊顯示 */}
                  {getSANBadges(patient).length > 0 && (
                    <div className="space-y-2">
                      {getSANBadges(patient).map((badge, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className={`h-6 w-6 rounded flex items-center justify-center text-xs font-bold ${badge.color}`}>
                            {badge.label}
                          </div>
                          <div className="flex flex-wrap gap-1 flex-1">
                            {badge.items.map((item, i) => (
                              <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 警示 */}
                  {patient.alerts.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-2 border-t">
                      {patient.alerts.map((alert, idx) => (
                        <Badge key={idx} className="text-xs bg-rose-100 text-rose-700 border border-rose-200 hover:bg-rose-200/80">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {alert}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    <span>最後更新：{new Date(patient.lastUpdate).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <p>載入中...</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
              <p className="text-red-600 font-medium">{error}</p>
              <Button variant="outline" className="mt-4" onClick={fetchPatients}>
                重新載入
              </Button>
            </div>
          )}

          {!loading && !error && filteredPatients.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>沒有符合條件的病患</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 編輯病患對話框 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>編輯病患資料</DialogTitle>
            <DialogDescription>
              修改病患的基本資料，完成後點擊儲存。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-name" className="text-right">
                姓名
              </Label>
              <Input
                id="edit-name"
                value={editFormData.name}
                onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-bed" className="text-right">
                床號
              </Label>
              <Input
                id="edit-bed"
                value={editFormData.bedNumber}
                onChange={(e) => setEditFormData(prev => ({ ...prev, bedNumber: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-diagnosis" className="text-right">
                診斷
              </Label>
              <Input
                id="edit-diagnosis"
                value={editFormData.diagnosis}
                onChange={(e) => setEditFormData(prev => ({ ...prev, diagnosis: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-age" className="text-right">
                年齡
              </Label>
              <Input
                id="edit-age"
                type="number"
                value={editFormData.age}
                onChange={(e) => setEditFormData(prev => ({ ...prev, age: parseInt(e.target.value) || 0 }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-physician" className="text-right">
                主治醫師
              </Label>
              <Input
                id="edit-physician"
                value={editFormData.attendingPhysician}
                onChange={(e) => setEditFormData(prev => ({ ...prev, attendingPhysician: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-intubated" className="text-right">
                插管狀態
              </Label>
              <div className="col-span-3 flex items-center gap-2">
                <Switch
                  id="edit-intubated"
                  checked={editFormData.intubated}
                  onCheckedChange={(checked) => setEditFormData(prev => ({ ...prev, intubated: checked }))}
                />
                <span className="text-sm text-muted-foreground">
                  {editFormData.intubated ? '插管中' : '未插管'}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving}
              className="bg-[#7f265b] hover:bg-[#7f265b]/90"
            >
              {saving ? '儲存中...' : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
