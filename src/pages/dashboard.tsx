import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Search, AlertCircle, AlertTriangle, Pencil, ZoomIn, ZoomOut, RefreshCw, DownloadCloud, Loader2, FlaskConical } from 'lucide-react';
import { maskPatientName } from '../lib/utils/patient-name';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Patient, updatePatient } from '../lib/api/patients';
import { getCachedPatientsSync, invalidatePatients, subscribePatientsCache } from '../lib/patients-cache';
import type { DashboardStats } from '../lib/api/dashboard';
import { useDashboardStats } from '../hooks/use-dashboard';
import { refreshSharedPatientDataAfterMutation } from '../lib/patient-data-sync';
import {
  triggerHisSync,
  isHisSyncAvailable,
  type HisSyncMode,
  type HisSyncResult,
} from '../lib/api/admin-his-sync';
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
import { getAirwayStatusLabel } from '../lib/patient-airway';
import { useAuth } from '../lib/auth-context';
import { canEditPatientProfile } from '../lib/permissions';

// 編輯表單的數據類型
interface EditFormData {
  name: string;
  bedNumber: string;
  diagnosis: string;
  intubated: boolean;
  tracheostomy: boolean;
  intubationDate?: string | null;
  tracheostomyDate?: string | null;
  age: number;
  attendingPhysician: string;
  allergies: string;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, i18n } = useTranslation('dashboard');
  const canEditPatients = canEditPatientProfile(user?.role);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('bed');
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [loading, setLoading] = useState(!getCachedPatientsSync());
  const [error, setError] = useState<string | null>(null);

  // 編輯對話框狀態
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [editFormData, setEditFormData] = useState<EditFormData>({
    name: '',
    bedNumber: '',
    diagnosis: '',
    intubated: false,
    tracheostomy: false,
    intubationDate: null,
    tracheostomyDate: null,
    age: 0,
    attendingPhysician: '',
    allergies: '',
  });
  const [saving, setSaving] = useState(false);
  const { data: stats } = useDashboardStats();

  // Manual HIS sync state — see docs/his-sync-end-to-end-tutorial.md §11
  const hisSyncEnabled = isHisSyncAvailable();
  const [hisSyncRunning, setHisSyncRunning] = useState<HisSyncMode | null>(null);
  const [lastHisSync, setLastHisSync] = useState<HisSyncResult | null>(null);

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

  // 從共用快取獲取病患列表
  const fetchPatients = useCallback(async () => {
    setError(null);
    try {
      const data = await invalidatePatients();
      setPatients(data);
    } catch (err) {
      console.error(`${t('list.loadErrorLog')}:`, err);
      setError(t('list.loadFailed'));
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Patients: skip fetch entirely if sync cache already populated state.
    // Dashboard stats are now fetched by useDashboardStats() (TanStack Query).
    if (!getCachedPatientsSync()) {
      fetchPatients();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return subscribePatientsCache((nextPatients) => {
      setPatients(nextPatients);
      setLoading(false);
    });
  }, []);

  // Fallback: compute stats from patient list when API stats unavailable
  // Patient API returns sedation/analgesia/nmb arrays (not sanSummary)
  const effectiveStats: DashboardStats | null = stats ?? (patients.length > 0 ? {
    patients: {
      total: patients.length,
      intubated: patients.filter(p => p.intubated).length,
      intubatedBeds: patients.filter(p => p.intubated).map(p => p.bedNumber),
      withSAN: patients.filter(p => (p.sedation?.length ?? 0) + (p.analgesia?.length ?? 0) + (p.nmb?.length ?? 0) > 0).length,
      sanByCategory: {
        sedation: patients.filter(p => (p.sedation?.length ?? 0) > 0).length,
        analgesia: patients.filter(p => (p.analgesia?.length ?? 0) > 0).length,
        nmb: patients.filter(p => (p.nmb?.length ?? 0) > 0).length,
      },
    },
    alerts: { total: patients.reduce((sum, p) => sum + p.alerts.length, 0) },
    medications: { active: 0, sedation: 0, analgesia: 0, nmb: 0 },
    messages: { today: 0, unread: 0 },
    timestamp: new Date().toISOString(),
  } : null);

  // 開啟編輯對話框
  const handleEditClick = (e: React.MouseEvent, patient: Patient) => {
    e.stopPropagation(); // 阻止點擊傳播到卡片
    setEditingPatient(patient);
    setEditFormData({
      name: patient.name,
      bedNumber: patient.bedNumber,
      diagnosis: patient.diagnosis,
      intubated: patient.intubated,
      tracheostomy: patient.tracheostomy ?? false,
      intubationDate: patient.intubationDate ?? null,
      tracheostomyDate: patient.tracheostomyDate ?? null,
      age: patient.age,
      attendingPhysician: patient.attendingPhysician,
      allergies: (patient.allergies ?? []).join(', '),
    });
    setEditDialogOpen(true);
  };

  // 儲存編輯
  const handleSaveEdit = async () => {
    if (!editingPatient) return;

    setSaving(true);
    try {
      const updated = await updatePatient(editingPatient.id, {
        ...editFormData,
        allergies: parseCsvList(editFormData.allergies),
      });
      // refreshSharedPatientDataAfterMutation invalidates both the patients
      // cache and the TanStack dashboard.all key — useDashboardStats() will
      // refetch automatically.
      const { patients: freshPatients } = await refreshSharedPatientDataAfterMutation();
      if (freshPatients) {
        setPatients(freshPatients);
      } else {
        setPatients((current) =>
          current.map((item) => (item.id === editingPatient.id ? updated : item)),
        );
      }
      setEditDialogOpen(false);
      toast.success(t('edit.saveSuccess'));
    } catch (err) {
      console.error(`${t('edit.saveErrorLog')}:`, err);
      toast.error(t('edit.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 手動觸發 HIS 同步（兩種模式：detect=只抓新/變動的、force=全部重抓）
  const handleHisSync = useCallback(
    async (mode: HisSyncMode) => {
      if (hisSyncRunning) return;
      setHisSyncRunning(mode);
      const loadingToastId = toast.loading(
        mode === 'detect' ? t('hisSync.detect.loading') : t('hisSync.force.loading'),
      );
      try {
        const result = await triggerHisSync(mode);
        setLastHisSync(result);

        // 觸發快取失效，讓總覽立刻拿到新資料
        await refreshSharedPatientDataAfterMutation();

        const { counts } = result;
        if (result.success) {
          const skipped = counts.unchanged + counts.timestamp_only;
          toast.success(
            mode === 'detect'
              ? t('hisSync.detect.success', { synced: counts.synced, skipped })
              : t('hisSync.force.success', { synced: counts.synced }),
            { id: loadingToastId, duration: 5000 },
          );
        } else {
          toast.error(
            t('hisSync.errors', { errors: counts.errors, returnCode: result.return_code }),
            { id: loadingToastId, duration: 8000 },
          );
        }
      } catch (err: unknown) {
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : t('hisSync.unknownError');
        toast.error(t('hisSync.syncFailed', { message: msg }), { id: loadingToastId, duration: 8000 });
      } finally {
        setHisSyncRunning(null);
      }
    },
    [hisSyncRunning, t],
  );

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

  const SAN_MAX_CHIPS = 2;
  const ALLERGY_MAX_CHIPS = 2;
  const parseCsvList = (value: string) =>
    value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
  const getPatientAllergies = (patient: Patient) =>
    (patient.allergies ?? []).map((allergy) => allergy.trim()).filter(Boolean);
  const getSANRows = (patient: Patient) => {
    const sedation = patient.sedation || patient.sanSummary?.sedation || [];
    const analgesia = patient.analgesia || patient.sanSummary?.analgesia || [];
    const nmb = patient.nmb || patient.sanSummary?.nmb || [];
    return [
      { label: 'S', items: sedation, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
      { label: 'A', items: analgesia, color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
      { label: 'N', items: nmb, color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
    ];
  };

  const renderAllergyBadge = (patient: Patient) => {
    const allergies = getPatientAllergies(patient);

    if (allergies.length === 0) {
      return null;
    }

    const shown = allergies.slice(0, ALLERGY_MAX_CHIPS);
    const extraCount = allergies.length - shown.length;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex max-w-full"
            title={t('card.allergyTooltip', { items: allergies.join(', ') })}
            onClick={(event) => event.stopPropagation()}
          >
            <Badge className="max-w-full cursor-pointer border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
              <AlertTriangle className="mr-1 h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">{t('card.allergyLabel')}</span>
              <span className="ml-1 truncate">{shown.join('、')}</span>
              {extraCount > 0 && (
                <span className="ml-1 shrink-0">{t('card.moreItems', { count: extraCount })}</span>
              )}
            </Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" />
              {t('card.allergyDetailsTitle')}
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{t('header.title')}</h1>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              <FlaskConical className="h-3.5 w-3.5" />
              {t('header.demoDataBadge')}
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-1">{t('header.subtitle')}</p>
        </div>

        {hisSyncEnabled && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={hisSyncRunning !== null}
                onClick={() => handleHisSync('detect')}
                title={t('hisSync.detect.tooltip')}
              >
                {hisSyncRunning === 'detect' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t('hisSync.detect.label')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={hisSyncRunning !== null}
                onClick={() => handleHisSync('force')}
                title={t('hisSync.force.tooltip')}
              >
                {hisSyncRunning === 'force' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <DownloadCloud className="mr-2 h-4 w-4" />
                )}
                {t('hisSync.force.label')}
              </Button>
            </div>
            {lastHisSync && (
              <p className="text-xs text-muted-foreground">
                {(() => {
                  const mode = lastHisSync.mode === 'force'
                    ? t('hisSync.modeForce')
                    : t('hisSync.modeDetect');
                  const synced = lastHisSync.counts.synced;
                  const skipped = lastHisSync.counts.unchanged + lastHisSync.counts.timestamp_only;
                  const errors = lastHisSync.counts.errors;
                  return errors > 0
                    ? t('hisSync.lastSyncWithErrors', { mode, synced, skipped, errors })
                    : t('hisSync.lastSync', { mode, synced, skipped });
                })()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ICU 指標（水平高密度） */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div
              className="grid"
              style={{ minWidth: '760px', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
            >
              <div className="px-4 py-4">
                <p className="text-xs font-medium text-muted-foreground">{t('metrics.totalPatients')}</p>
                <p className="mt-1 text-3xl font-bold leading-none text-foreground">{effectiveStats?.patients?.total ?? 0}</p>
              </div>
              <div className="border-l border-border px-4 py-4">
                <p className="text-xs font-medium text-muted-foreground">{t('metrics.intubated')}</p>
                <p className="mt-1 text-3xl font-bold leading-none text-foreground">{effectiveStats?.patients?.intubated ?? 0}</p>
              </div>
              <div className="border-l border-border px-4 py-4">
                <p className="text-xs font-medium text-muted-foreground">{t('metrics.sedation')}</p>
                <p className="mt-1 text-3xl font-bold leading-none text-foreground">
                  {effectiveStats?.patients?.sanByCategory?.sedation ?? 0}
                </p>
              </div>
              <div className="border-l border-border px-4 py-4">
                <p className="text-xs font-medium text-muted-foreground">{t('metrics.analgesia')}</p>
                <p className="mt-1 text-3xl font-bold leading-none text-foreground">
                  {effectiveStats?.patients?.sanByCategory?.analgesia ?? 0}
                </p>
              </div>
              <div className="border-l border-border px-4 py-4">
                <p className="text-xs font-medium text-muted-foreground">{t('metrics.nmb')}</p>
                <p className="mt-1 text-3xl font-bold leading-none text-foreground">
                  {effectiveStats?.patients?.sanByCategory?.nmb ?? 0}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 搜尋與篩選 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('list.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder={t('list.filterPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('list.filters.all')}</SelectItem>
                <SelectItem value="intubated">{t('list.filters.intubated')}</SelectItem>
                <SelectItem value="san">{t('list.filters.san')}</SelectItem>
                <SelectItem value="alerts">{t('list.filters.alerts')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder={t('list.sortPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bed">{t('list.sorts.bed')}</SelectItem>
                <SelectItem value="admission">{t('list.sorts.admission')}</SelectItem>
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
                title={t('list.zoomOut')}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground w-8 text-center">{t('list.columns', { count: gridCols })}</span>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 p-0"
                disabled={gridCols <= GRID_OPTIONS[0]}
                onClick={() => {
                  const idx = GRID_OPTIONS.indexOf(gridCols as typeof GRID_OPTIONS[number]);
                  if (idx > 0) changeGridCols(GRID_OPTIONS[idx - 1]);
                }}
                title={t('list.zoomIn')}
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
            {filteredPatients.map((patient) => {
              const stayDays = patient.admissionDate
                ? Math.floor((new Date().getTime() - new Date(patient.admissionDate).getTime()) / (1000 * 60 * 60 * 24))
                : null;
              const sanRows = getSANRows(patient);
              return (
                <Card
                  key={patient.id}
                  className="group cursor-pointer hover:shadow-xl transition-all duration-200 hover:border-primary/30 bg-white dark:bg-slate-900 relative"
                  onClick={() => navigate(`/patient/${patient.id}`)}
                >
                  {/* 編輯按鈕 */}
                  {canEditPatients && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-muted-foreground hover:text-brand hover:bg-brand/10 z-10"
                      onClick={(e) => handleEditClick(e, patient)}
                      title={t('card.editButtonTitle')}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}

                  {/* 1. 標題區：姓名 + 氣切/插管中（固定保留一行） + 床號 */}
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 pr-8">
                        <div className="flex items-center gap-2 mb-1.5 min-h-[28px]">
                          <CardTitle className="text-xl text-foreground truncate">{maskPatientName(patient.name)}</CardTitle>
                          <div className="h-6 flex items-center shrink-0">
                            {patient.intubated && (
                              <Badge className="bg-[#d1cbf7] text-brand hover:bg-[#d1cbf7]/90 dark:bg-[#4a2f5c] dark:text-[#efe3ff] dark:hover:bg-[#4a2f5c]/90">
                                {getAirwayStatusLabel(patient)}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* 2. 基本資料行（強制單行） */}
                        <p className="text-sm text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                          {t('card.ageYears', { age: patient.age })}&nbsp;·&nbsp;{stayDays !== null ? t('card.stayDays', { days: stayDays, count: stayDays }) : t('card.stayShort')}
                        </p>
                      </div>
                      <div className="h-12 w-12 rounded-full bg-brand text-white flex items-center justify-center font-bold text-lg shadow-lg shrink-0">
                        {patient.bedNumber || '-'}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col flex-1 space-y-3">
                    {/* 3. 入院診斷（固定 3 行） */}
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-border">
                      <p className="text-xs font-medium text-muted-foreground mb-1">{t('card.diagnosisLabel')}</p>
                      <p
                        className="text-sm font-medium text-foreground line-clamp-3 min-h-[3.75rem] leading-5"
                        title={patient.diagnosis || ''}
                      >
                        {patient.diagnosis || '-'}
                      </p>
                    </div>

                    {/* 4. S/A/N 三行（固定保留位置；缺項留空；每行單行 + +X 更多） */}
                    <div className="space-y-1.5">
                      {sanRows.map((row) => (
                        <div key={row.label} className="flex items-center gap-2 h-6">
                          {row.items.length > 0 && (
                            <>
                              <div className={`h-6 w-6 rounded flex items-center justify-center text-xs font-bold shrink-0 ${row.color}`}>
                                {row.label}
                              </div>
                              <div className="flex gap-1 overflow-hidden flex-1 min-w-0">
                                {row.items.slice(0, SAN_MAX_CHIPS).map((item, i) => (
                                  <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded whitespace-nowrap truncate max-w-[10rem]">
                                    {item}
                                  </span>
                                ))}
                                {row.items.length > SAN_MAX_CHIPS && (
                                  <span className="text-xs bg-muted px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                                    {t('card.moreItems', { count: row.items.length - SAN_MAX_CHIPS })}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 5. 臨床旗標列（DNR 與過敏同列） */}
                    <div className="h-6 flex items-center gap-2 overflow-hidden">
                      {patient.hasDNR && (
                        <Badge className="text-xs bg-rose-100 text-rose-700 border border-rose-200 hover:bg-rose-200/80 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700">
                          <AlertCircle className="h-3.5 w-3.5 mr-1 shrink-0" />
                          DNR
                        </Badge>
                      )}
                      {renderAllergyBadge(patient)}
                    </div>

                    {/* 6. 最後更新（釘底） */}
                    <div className="mt-auto text-xs text-muted-foreground pt-2 border-t">
                      <span>{t('card.lastUpdatePrefix')}{patient.lastUpdate ? new Date(patient.lastUpdate).toLocaleString(i18n.language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {loading && (
            <div className="text-center py-12 text-muted-foreground">
              <p>{t('common:status.loading')}</p>
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400 dark:text-red-500" />
              <p className="text-red-600 dark:text-red-400 font-medium">{error}</p>
              <Button variant="outline" className="mt-4" onClick={fetchPatients}>
                {t('common:actions.refresh')}
              </Button>
            </div>
          )}

          {!loading && !error && filteredPatients.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>{t('list.empty')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 編輯病患對話框 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-brand" />
              {t('edit.title')}
            </DialogTitle>
            <DialogDescription>
              {t('edit.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-name" className="text-right">
                {t('edit.labels.name')}
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
                {t('edit.labels.bed')}
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
                {t('edit.labels.diagnosis')}
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
                {t('edit.labels.age')}
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
                {t('edit.labels.physician')}
              </Label>
              <Input
                id="edit-physician"
                value={editFormData.attendingPhysician}
                onChange={(e) => setEditFormData(prev => ({ ...prev, attendingPhysician: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-allergies" className="text-right">
                {t('edit.labels.allergies')}
              </Label>
              <Input
                id="edit-allergies"
                value={editFormData.allergies}
                onChange={(e) => setEditFormData(prev => ({ ...prev, allergies: e.target.value }))}
                className="col-span-3"
                placeholder={t('edit.placeholders.allergies')}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-intubated" className="text-right">
                {t('edit.labels.airway')}
              </Label>
              <div className="col-span-3 space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="edit-intubated"
                      checked={editFormData.intubated}
                      onCheckedChange={(checked) =>
                        setEditFormData((prev) =>
                          checked
                            ? { ...prev, intubated: true }
                            : { ...prev, intubated: false, tracheostomy: false, intubationDate: null, tracheostomyDate: null }
                        )
                      }
                    />
                    <span className="text-sm text-muted-foreground">
                      {t('edit.airway.invasive')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editFormData.tracheostomy}
                      onCheckedChange={(checked) =>
                        setEditFormData((prev) =>
                          checked
                            ? { ...prev, intubated: true, tracheostomy: true }
                            : { ...prev, tracheostomy: false, tracheostomyDate: null }
                        )
                      }
                    />
                    <span className="text-sm text-muted-foreground">{t('edit.airway.tracheostomy')}</span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    type="date"
                    value={editFormData.intubationDate ?? ''}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, intubationDate: e.target.value || null }))}
                    disabled={!editFormData.intubated}
                  />
                  <Input
                    type="date"
                    value={editFormData.tracheostomyDate ?? ''}
                    onChange={(e) => setEditFormData(prev => ({
                      ...prev,
                      intubated: e.target.value ? true : prev.intubated,
                      tracheostomy: e.target.value ? true : prev.tracheostomy,
                      tracheostomyDate: e.target.value || null,
                    }))}
                    disabled={!editFormData.tracheostomy}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving}
              className="bg-brand hover:bg-brand/90"
            >
              {saving ? t('common:status.saving') : t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
