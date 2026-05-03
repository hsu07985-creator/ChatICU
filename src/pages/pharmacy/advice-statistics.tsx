import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { LoadingSpinner, EmptyState } from '../../components/ui/state-display';
import { FileText, Loader2, User, Tag, Pill, Send, CheckCircle2, XCircle, CircleDot, ChevronLeft, ChevronRight, NotebookPen, Search, X, Edit2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { maskPatientName } from '../../lib/utils/patient-name';
import { useAuth } from '../../lib/auth-context';
import {
  getAdviceRecords,
  createAdviceRecord,
  updateAdviceRecord,
  deleteAdviceRecord,
  getAdviceTagStats,
  getPharmacySoapRecords,
  type PharmacyAdviceRecord,
  type PharmacySoapRecord,
  type TagStatItem,
} from '../../lib/api/pharmacy';
import { type Patient } from '../../lib/api/patients';
import { getCachedPatients, getCachedPatientsSync, subscribePatientsCache } from '../../lib/patients-cache';
import {
  PHARMACY_ADVICE_CATEGORIES,
  PHARMACY_ADVICE_CATEGORY_COLORS,
} from '../../lib/pharmacy-master-data';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Label } from 'recharts';

type EditAcceptedValue = 'yes' | 'no' | 'pending';

function getCategoryKeyByLabel(label: string): string {
  return Object.entries(PHARMACY_ADVICE_CATEGORIES).find(([, cat]) => cat.label === label)?.[0] || '';
}

function splitLinkedMedications(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PharmacyAdviceStatisticsPage() {
  const { user } = useAuth();
  const canManageAdviceRecords = user?.role === 'pharmacist' || user?.role === 'admin';
  const { t } = useTranslation('pharmacy');

  // ── 病患清單（共用快取） ──
  const [patients, setPatients] = useState<Patient[]>(getCachedPatientsSync() ?? []);
  const [patientsLoading, setPatientsLoading] = useState(!getCachedPatientsSync());

  // ── 表單 ──
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [accepted, setAccepted] = useState<string>('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── 歷史紀錄編輯 / 刪除 ──
  const [editingRecord, setEditingRecord] = useState<PharmacyAdviceRecord | null>(null);
  const [editCategoryKey, setEditCategoryKey] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editAccepted, setEditAccepted] = useState<EditAcceptedValue>('pending');
  const [editContent, setEditContent] = useState('');
  const [editLinkedMedications, setEditLinkedMedications] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingRecord, setDeletingRecord] = useState<PharmacyAdviceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tagStatsRefreshToken, setTagStatsRefreshToken] = useState(0);

  // ── 月份選擇 ──
  const todayMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);

  // 24 個月選項（從本月往前 24 個月）— 抄 admin/statistics.tsx 的實作模式
  const monthOptions = useMemo(() => {
    const now = new Date();
    const options: Array<{ value: string; label: string }> = [];
    for (let i = 0; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = i18n.t('pharmacy:adviceStats.monthLabel', { year: date.getFullYear(), month: date.getMonth() + 1 });
      options.push({ value, label });
    }
    return options;
  }, []);

  const shiftMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return t('adviceStats.monthLabel', { year: y, month: m });
  })();

  // ── 紀錄 ──
  const [records, setRecords] = useState<PharmacyAdviceRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(true);

  // ── 搜尋 ──
  const [searchTerm, setSearchTerm] = useState('');

  // F3: deep-link target from /ai-chat advice chips. When the URL carries
  // ?advice_id=adv_xxx we highlight + scroll to that record card the first
  // time it shows up in the rendered list. Cleared after first scroll so
  // the highlight doesn't keep re-firing on every records refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  const targetAdviceId = searchParams.get('advice_id');
  const [highlightedAdviceId, setHighlightedAdviceId] = useState<string | null>(targetAdviceId);
  const highlightHandledRef = useRef(false);
  const adviceCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 第一次載入用：當月若無資料則 fallback 到「最新一筆所在月份」
  const initialFallbackTriedRef = useRef(false);

  // ── 留言板標籤統計 ──
  const [tagStats, setTagStats] = useState<TagStatItem[]>([]);
  const [tagStatsLoading, setTagStatsLoading] = useState(true);

  // ── SOAP 紀錄（TC-FU-T2） ──
  const [activeTab, setActiveTab] = useState<'advice' | 'soap'>('advice');
  const [soapRecords, setSoapRecords] = useState<PharmacySoapRecord[]>([]);
  const [soapLoading, setSoapLoading] = useState(false);
  const [soapSearch, setSoapSearch] = useState('');

  // 載入病患清單（共用快取，sync cache 命中則跳過）
  useEffect(() => {
    if (getCachedPatientsSync()) return;
    let cancelled = false;
    getCachedPatients()
      .then(data => { if (!cancelled) { setPatients(data); setPatientsLoading(false); } })
      .catch(() => { if (!cancelled) { toast.error(t('adviceStats.loadPatientsFail')); setPatientsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return subscribePatientsCache((nextPatients) => {
      setPatients(nextPatients);
      setPatientsLoading(false);
    });
  }, []);

  // 載入紀錄
  const fetchRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await getAdviceRecords({ month: selectedMonth, limit: 500 });
      setRecords(res.records);
      setRecordsTotal(res.total ?? res.records.length);
    } catch {
      setRecords([]);
      setRecordsTotal(0);
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 預設月份 fallback：first load 若當月無資料，撈一次「不帶 month」的最新紀錄，
  // 將 selectedMonth 改為「最新一筆 timestamp 所在月份」。
  // 只在 first load 嘗試一次（避免使用者手動切到沒資料的月份時被覆蓋）。
  useEffect(() => {
    if (initialFallbackTriedRef.current) return;
    if (recordsLoading) return; // 等第一次 fetch 完成
    initialFallbackTriedRef.current = true;
    if (records.length > 0) return;
    if (selectedMonth !== todayMonth) return; // 已偏離預設則不再 fallback

    let cancelled = false;
    (async () => {
      try {
        const res = await getAdviceRecords({ limit: 1 });
        if (cancelled) return;
        const latest = res.records?.[0];
        if (!latest?.timestamp) return;
        const d = new Date(latest.timestamp);
        if (Number.isNaN(d.getTime())) return;
        const fallbackMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (fallbackMonth !== selectedMonth) {
          setSelectedMonth(fallbackMonth);
        }
      } catch {
        // 安靜失敗：保留 todayMonth
      }
    })();
    return () => { cancelled = true; };
  }, [recordsLoading, records.length, selectedMonth, todayMonth]);

  // 載入留言板標籤統計
  useEffect(() => {
    let cancelled = false;
    setTagStatsLoading(true);
    getAdviceTagStats({ month: selectedMonth })
      .then(res => { if (!cancelled) setTagStats(res.tagStats || []); })
      .catch(() => { if (!cancelled) setTagStats([]); })
      .finally(() => { if (!cancelled) setTagStatsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedMonth, tagStatsRefreshToken]);

  // 載入 SOAP 紀錄 (TC-FU-T2) — 切到 SOAP tab 或月份/搜尋變更時 fetch
  useEffect(() => {
    if (activeTab !== 'soap') return;
    let cancelled = false;
    setSoapLoading(true);
    getPharmacySoapRecords({
      month: selectedMonth,
      search: soapSearch.trim() || undefined,
      limit: 200,
    })
      .then(res => { if (!cancelled) setSoapRecords(res.records || []); })
      .catch(() => { if (!cancelled) setSoapRecords([]); })
      .finally(() => { if (!cancelled) setSoapLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, selectedMonth, soapSearch]);

  // 取得選中的類別物件
  const selectedCategory = selectedCategoryKey
    ? PHARMACY_ADVICE_CATEGORIES[selectedCategoryKey]
    : null;

  // 取得選中的細項
  const selectedCodeItem = selectedCategory?.codes.find((c) => c.code === selectedCode);
  const editSelectedCategory = editCategoryKey ? PHARMACY_ADVICE_CATEGORIES[editCategoryKey] : null;
  const editSelectedCodeItem = editSelectedCategory?.codes.find((c) => c.code === editCode);

  const openEditRecord = (record: PharmacyAdviceRecord) => {
    const categoryKey = getCategoryKeyByLabel(record.category);
    setEditingRecord(record);
    setEditCategoryKey(categoryKey);
    setEditCode(record.adviceCode);
    setEditAccepted(record.accepted === true ? 'yes' : record.accepted === false ? 'no' : 'pending');
    setEditContent(record.content || '');
    setEditLinkedMedications((record.linkedMedications || []).join(', '));
  };

  const closeEditDialog = () => {
    setEditingRecord(null);
    setEditCategoryKey('');
    setEditCode('');
    setEditAccepted('pending');
    setEditContent('');
    setEditLinkedMedications('');
  };

  const handleSaveEdit = async () => {
    if (!editingRecord || !editSelectedCategory || !editSelectedCodeItem) {
      toast.error(t('adviceStats.selectFullCategory'));
      return;
    }
    if (!editContent.trim()) {
      toast.error(t('adviceStats.enterContent'));
      return;
    }

    setSavingEdit(true);
    try {
      await updateAdviceRecord(editingRecord.id, {
        adviceCode: editSelectedCodeItem.code,
        adviceLabel: editSelectedCodeItem.label,
        category: editSelectedCategory.label,
        content: editContent.trim(),
        linkedMedications: splitLinkedMedications(editLinkedMedications),
        accepted: editAccepted === 'yes' ? true : editAccepted === 'no' ? false : null,
      });
      toast.success(t('adviceStats.recordUpdated'));
      closeEditDialog();
      await fetchRecords();
      setTagStatsRefreshToken((v) => v + 1);
    } catch {
      toast.error(t('adviceStats.updateFail'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingRecord) return;
    setDeleting(true);
    try {
      await deleteAdviceRecord(deletingRecord.id);
      toast.success(t('adviceStats.recordDeleted'));
      setDeletingRecord(null);
      await fetchRecords();
      setTagStatsRefreshToken((v) => v + 1);
    } catch {
      toast.error(t('adviceStats.deleteFail'));
    } finally {
      setDeleting(false);
    }
  };

  // 送出
  const handleSubmit = async () => {
    if (!selectedPatientId || !selectedCategory || !selectedCodeItem) {
      toast.error(t('adviceStats.selectPatientCategory'));
      return;
    }
    setSubmitting(true);
    try {
      await createAdviceRecord({
        patientId: selectedPatientId,
        adviceCode: selectedCodeItem.code,
        adviceLabel: selectedCodeItem.label,
        category: selectedCategory.label,
        content: content.trim() || selectedCodeItem.label,
        accepted: accepted === 'yes' ? true : accepted === 'no' ? false : undefined,
      });
      toast.success(t('adviceStats.recordCreated'));
      setSelectedPatientId('');
      setSelectedCategoryKey('');
      setSelectedCode('');
      setAccepted('');
      setContent('');
      await fetchRecords();
    } catch {
      toast.error(t('adviceStats.createFail'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── 列表搜尋（client-side，僅影響清單；統計卡 / 圖表保持以 records 計算）──
  const filteredRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => {
      const haystack = [
        r.bedNumber,
        r.patientName,
        r.content,
        r.category,
        r.adviceCode,
        r.adviceLabel,
        r.pharmacistName,
        ...(r.linkedMedications || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [records, searchTerm]);

  const isTruncated = records.length === 500 && recordsTotal > 500;

  // F3 step 1/3: when arriving from an /ai-chat advice chip with ?month=YYYY-MM,
  // swap the month selector once so the records query loads the right window.
  // Guarded by initialFallbackTriedRef-style sentinel so user month picks
  // afterwards aren't fought.
  const monthFromUrlAppliedRef = useRef(false);
  useEffect(() => {
    if (monthFromUrlAppliedRef.current) return;
    const monthParam = searchParams.get('month');
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam) && monthParam !== selectedMonth) {
      setSelectedMonth(monthParam);
    }
    monthFromUrlAppliedRef.current = true;
  }, [searchParams, selectedMonth]);

  // F3 step 2/3: once records arrive that contain the target advice, scroll to
  // it and flash a highlight ring. Clear searchTerm in case the user typed
  // something that filters the target out.
  useEffect(() => {
    if (!targetAdviceId || highlightHandledRef.current || recordsLoading) return;
    const found = records.some((r) => r.id === targetAdviceId);
    if (!found) {
      // Records loaded but target not present in this month's window. Tell
      // the user instead of silently doing nothing — the chip is supposed
      // to be a deep link, not a no-op.
      if (records.length > 0 || recordsTotal === 0) {
        toast.error(t('adviceStats.deepLinkNotFound'));
        highlightHandledRef.current = true;
        // Drop the params so a future refresh doesn't keep re-toasting.
        const next = new URLSearchParams(searchParams);
        next.delete('advice_id');
        next.delete('month');
        setSearchParams(next, { replace: true });
      }
      return;
    }
    if (searchTerm) setSearchTerm('');
    // Defer to next frame so the card has its ref attached after re-render.
    const raf = requestAnimationFrame(() => {
      const node = adviceCardRefs.current.get(targetAdviceId);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Drop the URL params so back/forward doesn't keep re-scrolling.
      const next = new URLSearchParams(searchParams);
      next.delete('advice_id');
      next.delete('month');
      setSearchParams(next, { replace: true });
      // Fade highlight after 4s so the card returns to normal styling.
      window.setTimeout(() => setHighlightedAdviceId(null), 4000);
      highlightHandledRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [targetAdviceId, records, recordsLoading, recordsTotal, searchTerm, searchParams, setSearchParams]);

  // ── 統計 ──
  const categoryStats: Record<string, number> = {};
  Object.values(PHARMACY_ADVICE_CATEGORIES).forEach((cat) => {
    categoryStats[cat.label] = 0;
  });
  records.forEach((r) => {
    if (categoryStats[r.category] !== undefined) categoryStats[r.category]++;
  });
  const totalAdvices = Object.values(categoryStats).reduce((s, v) => s + v, 0);

  const pieData = Object.entries(categoryStats)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({
      name,
      value,
      color: PHARMACY_ADVICE_CATEGORY_COLORS[name] || '#999',
    }));

  // 接受率統計
  const acceptedCount = records.filter((r) => r.accepted === true).length;
  const rejectedCount = records.filter((r) => r.accepted === false).length;
  const acceptRate = totalAdvices > 0 ? Math.round((acceptedCount / totalAdvices) * 100) : 0;

  const codeStats: Record<string, number> = {};
  records.forEach((r) => {
    codeStats[r.adviceCode] = (codeStats[r.adviceCode] || 0) + 1;
  });
  const barData = Object.entries(codeStats)
    .map(([code, count]) => {
      const rec = records.find((r) => r.adviceCode === code);
      return {
        code,
        fullLabel: `${code} ${rec?.adviceLabel || code}`,
        label: rec?.adviceLabel || code,
        category: rec?.category || '',
        count,
        color: PHARMACY_ADVICE_CATEGORY_COLORS[rec?.category || ''] || 'var(--color-brand)',
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const renderBarTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload?: typeof barData[number] }> }) => {
    if (!active || !payload?.[0]?.payload) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg shadow-lg p-3 text-sm">
        <p className="font-semibold">{d.code} {d.label}</p>
        <p className="text-muted-foreground text-xs">{d.category}</p>
        <p className="font-bold mt-1 text-base">{t('adviceStats.tooltipCount', { count: d.count })}</p>
      </div>
    );
  };

  const renderPieCenterLabel = (props: { viewBox?: unknown }) => {
    const vb = props.viewBox as { cx?: number; cy?: number } | undefined;
    if (!vb || typeof vb.cx !== 'number' || typeof vb.cy !== 'number') return null;
    const { cx, cy } = vb;
    return (
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
        <tspan x={cx} dy="-0.4em" fontSize={28} fontWeight={700} fill="#1a1a1a">{totalAdvices}</tspan>
        <tspan x={cx} dy="1.6em" fontSize={12} fill="#6b7280">{t('adviceStats.centerSubtitle')}</tspan>
      </text>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('adviceStats.title')}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t('adviceStats.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg px-2 py-1.5 shadow-sm">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="h-7 w-[140px] text-sm">
              <SelectValue placeholder={monthLabel}>{monthLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
              {/* 若目前 selectedMonth 不在 24 個月清單中（例如手動 fallback 到更早），補一個選項 */}
              {!monthOptions.some((o) => o.value === selectedMonth) && (
                <SelectItem value={selectedMonth}>{monthLabel}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => shiftMonth(1)}
            disabled={selectedMonth >= todayMonth}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {selectedMonth !== todayMonth && (
            <Button variant="outline" size="sm" className="h-7 text-xs ml-1" onClick={() => setSelectedMonth(todayMonth)}>
              {t('adviceStats.thisMonth')}
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as 'advice' | 'soap')} className="space-y-4">
        <TabsList>
          <TabsTrigger value="advice">{t('adviceStats.tabAdvice')}</TabsTrigger>
          <TabsTrigger value="soap">{t('adviceStats.tabSoap')}</TabsTrigger>
        </TabsList>

        <TabsContent value="advice" className="space-y-4">
      {/* ── 新增紀錄 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('adviceStats.newRecord')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            {/* 病患 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.patient')} *</label>
              {patientsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground h-9">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('adviceStats.loading')}
                </div>
              ) : (
                <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={t('adviceStats.selectPatient')} />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.bedNumber} {maskPatientName(p.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 類別 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.category')} *</label>
              <Select
                value={selectedCategoryKey}
                onValueChange={(v) => {
                  setSelectedCategoryKey(v);
                  setSelectedCode('');
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('adviceStats.selectCategory')} />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PHARMACY_ADVICE_CATEGORIES).map(([key, cat]) => (
                    <SelectItem key={key} value={key}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 細項 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.subitem')} *</label>
              <Select
                value={selectedCode}
                onValueChange={setSelectedCode}
                disabled={!selectedCategory}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={selectedCategory ? t('adviceStats.selectSubitem') : t('adviceStats.pickCategoryFirst')} />
                </SelectTrigger>
                <SelectContent>
                  {selectedCategory?.codes.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 醫師是否接受 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.doctorAccept')}</label>
              <Select value={accepted} onValueChange={setAccepted}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('adviceStats.selectAcceptance')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">{t('adviceStats.accepted')}</SelectItem>
                  <SelectItem value="no">{t('adviceStats.rejected')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 備註 + 送出 */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Textarea
                placeholder={t('adviceStats.notePlaceholder')}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[60px] resize-none"
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !selectedPatientId || !selectedCode}
              className="h-[60px] px-6"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t('adviceStats.submit')}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 統計卡片 ── */}
      <div className="grid gap-3 md:grid-cols-5">
        <Card className="border-brand">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('adviceStats.monthTotal', { label: monthLabel })}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{totalAdvices}</div>
          </CardContent>
        </Card>

        {Object.entries(PHARMACY_ADVICE_CATEGORIES).map(([key, cat]) => {
          const color = PHARMACY_ADVICE_CATEGORY_COLORS[cat.label] || '#999';
          return (
            <Card key={key} className="border-l-4" style={{ borderLeftColor: color }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{cat.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" style={{ color }}>
                  {categoryStats[cat.label] ?? 0}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t('adviceStats.subitemCount', { count: cat.codes.length })}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── 圖表 ── */}
      {totalAdvices > 0 && (
        <div className="space-y-4">
          {/* Row 1: 甜甜圈 + 接受率 */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* 甜甜圈圖 — 類別分佈 */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('adviceStats.categoryDistribution')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      labelLine={false}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                      <Label content={renderPieCenterLabel} position="center" />
                    </Pie>
                    <Tooltip formatter={(value: number, name: string) => [t('adviceStats.tooltipCount', { count: value }), name]} />
                  </PieChart>
                </ResponsiveContainer>
                {/* 圖例 */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2 px-2">
                  {pieData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="text-muted-foreground truncate">{entry.name}</span>
                      <span className="font-semibold ml-auto shrink-0">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 接受率視覺化 */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CircleDot className="h-4 w-4" /> {t('adviceStats.doctorResponseStats')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center">
                  {/* 接受率大數字 */}
                  <div className="relative w-36 h-36 mb-3">
                    <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#16a34a" strokeWidth="10"
                        strokeDasharray={`${acceptRate * 3.14} ${314 - acceptRate * 3.14}`}
                        strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold text-[#16a34a]">{acceptRate}%</span>
                      <span className="text-xs text-muted-foreground">{t('adviceStats.acceptRate')}</span>
                    </div>
                  </div>
                  {/* 統計 */}
                  <div className="grid grid-cols-2 gap-3 w-full text-center">
                    <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 py-2">
                      <div className="text-lg font-bold text-green-700 dark:text-green-300">{acceptedCount}</div>
                      <div className="text-xs text-green-600 dark:text-green-400">{t('adviceStats.acceptedCount')}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 py-2">
                      <div className="text-lg font-bold text-red-700 dark:text-red-300">{rejectedCount}</div>
                      <div className="text-xs text-red-600 dark:text-red-400">{t('adviceStats.rejectedCount')}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 各類別接受率 */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('adviceStats.categoryAcceptRate')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 pt-1">
                  {Object.values(PHARMACY_ADVICE_CATEGORIES).map((cat) => {
                    const catRecords = records.filter((r) => r.category === cat.label);
                    const catTotal = catRecords.length;
                    const catAccepted = catRecords.filter((r) => r.accepted === true).length;
                    const catRate = catTotal > 0 ? Math.round((catAccepted / catTotal) * 100) : 0;
                    const color = PHARMACY_ADVICE_CATEGORY_COLORS[cat.label] || '#999';
                    return (
                      <div key={cat.key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium truncate pr-2">{cat.label}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {catTotal > 0 ? `${catAccepted}/${catTotal}` : '—'}
                          </span>
                        </div>
                        <div className="h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${catRate}%`, backgroundColor: color }}
                          />
                        </div>
                        {catTotal > 0 && (
                          <div className="text-right text-xs font-medium mt-0.5" style={{ color }}>
                            {catRate}%
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Row 2: 直方圖 — 細項分析 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('adviceStats.subitemAnalysis', { count: barData.length })}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={barData} margin={{ top: 20, right: 20, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="code"
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="#6b7280"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={renderBarTooltip} />
                  <Bar
                    dataKey="count"
                    radius={[6, 6, 0, 0]}
                    barSize={32}
                    label={{ position: 'top', fontSize: 13, fontWeight: 700 }}
                  >
                    {barData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── 留言板標籤統計 ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" /> {t('adviceStats.tagStats')}
            {tagStats.length > 0 && <Badge variant="secondary">{t('adviceStats.tagBadge', { count: tagStats.length })}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tagStatsLoading ? (
            <LoadingSpinner text={t('adviceStats.loadingTagStats')} />
          ) : tagStats.length > 0 ? (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={Math.max(200, tagStats.length * 36)}>
                <BarChart data={tagStats} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} stroke="#6b7280" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="tag" width={160} stroke="#6b7280" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => [t('adviceStats.tooltipCount', { count: value }), t('adviceStats.tagUsage')]} />
                  <Bar dataKey="count" fill="var(--color-brand)" radius={[0, 6, 6, 0]} barSize={24} label={{ position: 'right', fontSize: 12, fontWeight: 600 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Tag} title={t('adviceStats.noTags')} description={t('adviceStats.noTagsDesc', { label: monthLabel })} />
          )}
        </CardContent>
      </Card>

      {/* ── 歷史紀錄 ── */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {t('adviceStats.history')}
              <Badge variant="secondary">{t('adviceStats.totalCount', { count: recordsTotal })}</Badge>
              {searchTerm.trim() && (
                <Badge variant="outline" className="font-normal">
                  {t('adviceStats.matchCount', { count: filteredRecords.length })}
                </Badge>
              )}
            </CardTitle>
            {isTruncated && (
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                {t('adviceStats.truncatedHint')}
              </span>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('adviceStats.searchPlaceholder')}
              className="pl-8 pr-9 h-9"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label={t('adviceStats.clearSearch')}
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <LoadingSpinner text={t('adviceStats.loadingRecords')} />
          ) : filteredRecords.length > 0 ? (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {filteredRecords.map((record) => {
                  const isAccepted = record.accepted === true;
                  const isRejected = record.accepted === false;
                  const cardBg = isAccepted
                    ? 'bg-green-50/60 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : isRejected
                      ? 'bg-red-50/60 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      : 'bg-white dark:bg-slate-900';
                  const isHighlighted = highlightedAdviceId === record.id;
                  return (
                    <div
                      key={record.id}
                      ref={(el) => {
                        // F3: track DOM nodes so the deep-link effect can
                        // scroll to the target without an O(N) querySelector.
                        if (el) adviceCardRefs.current.set(record.id, el);
                        else adviceCardRefs.current.delete(record.id);
                      }}
                      className={`border-l-4 rounded-lg p-3 hover:shadow-md transition-shadow ${cardBg}${
                        isHighlighted ? ' ring-2 ring-amber-400 ring-offset-2 dark:ring-offset-slate-900' : ''
                      }`}
                      style={{ borderLeftColor: PHARMACY_ADVICE_CATEGORY_COLORS[record.category] || '#999' }}
                    >
                      <div className="flex items-start justify-between mb-1.5 gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            className="text-white"
                            style={{ backgroundColor: PHARMACY_ADVICE_CATEGORY_COLORS[record.category] || '#999' }}
                          >
                            {record.adviceCode}
                          </Badge>
                          <span className="font-medium text-sm">{record.adviceLabel}</span>
                        </div>
                        <div className="flex items-center gap-2 ml-2 flex-wrap justify-end">
                          {isAccepted && (
                            <Badge className="bg-green-600 hover:bg-green-700 text-white text-xs gap-1 px-2.5 py-0.5">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {t('adviceStats.acceptedBadge')}
                            </Badge>
                          )}
                          {isRejected && (
                            <Badge variant="destructive" className="text-xs gap-1 px-2.5 py-0.5">
                              <XCircle className="h-3.5 w-3.5" /> {t('adviceStats.rejectedBadge')}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(record.timestamp).toLocaleString(i18n.language, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {canManageAdviceRecords && (
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => openEditRecord(record)}
                                title={t('adviceStats.editRecord')}
                              >
                                <Edit2 className="h-3.5 w-3.5 mr-1" />
                                {t('adviceStats.edit')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                                onClick={() => setDeletingRecord(record)}
                                title={t('adviceStats.deleteRecord')}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                {t('adviceStats.delete')}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mb-1.5 text-xs">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{record.bedNumber} {maskPatientName(record.patientName)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{record.pharmacistName}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">{record.category}</Badge>
                      </div>

                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                        {record.content}
                      </p>

                      {record.linkedMedications && record.linkedMedications.length > 0 && (
                        <div className="pt-2 mt-2 border-t border-gray-100 dark:border-slate-700 flex items-center gap-2 flex-wrap">
                          <Pill className="h-3.5 w-3.5 text-muted-foreground" />
                          {record.linkedMedications.map((med, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">{med}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : searchTerm.trim() ? (
            <EmptyState
              icon={Search}
              title={t('adviceStats.noSearchResult')}
              description={t('adviceStats.noSearchResultDesc', { term: searchTerm })}
            />
	          ) : (
	            <EmptyState
	              icon={FileText}
	              title={t('adviceStats.noHistoryTitle', { label: monthLabel })}
	              description={t('adviceStats.noHistoryDesc')}
	            />
	          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="soap" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <NotebookPen className="h-4 w-4" />
                {t('adviceStats.soapTitle')}
                <Badge variant="secondary">{t('adviceStats.soapCount', { count: soapRecords.length })}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {t('adviceStats.soapSubtitle')}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={soapSearch}
                  onChange={(e) => setSoapSearch(e.target.value)}
                  placeholder={t('adviceStats.soapSearchPlaceholder')}
                  className="flex-1 h-9 rounded-md border border-slate-300 bg-white dark:bg-slate-900 dark:border-slate-700 px-3 text-sm"
                />
                {soapSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9"
                    onClick={() => setSoapSearch('')}
                  >
                    {t('adviceStats.clear')}
                  </Button>
                )}
              </div>

              {soapLoading ? (
                <LoadingSpinner text={t('adviceStats.loadingSoap')} />
              ) : soapRecords.length > 0 ? (
                <ScrollArea className="h-[520px] pr-4">
                  <div className="space-y-3">
                    {soapRecords.map((record) => (
                      <div
                        key={record.id}
                        className="border rounded-lg p-3 hover:shadow-md transition-shadow bg-white dark:bg-slate-900 dark:border-slate-700"
                      >
                        <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">
                              {record.bedNumber || '—'} {maskPatientName(record.patientName || '')}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {record.pharmacistName}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(record.createdAt).toLocaleString(i18n.language, {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Taipei',
                            })}
                          </span>
                        </div>

                        <div className="grid gap-2 md:grid-cols-2">
                          {record.subjective && (
                            <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                              <div className="text-xs font-semibold text-slate-500 mb-1">S — Subjective</div>
                              <p className="text-sm whitespace-pre-line line-clamp-4">{record.subjective}</p>
                            </div>
                          )}
                          {record.objective && (
                            <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                              <div className="text-xs font-semibold text-slate-500 mb-1">O — Objective</div>
                              <p className="text-sm whitespace-pre-line line-clamp-4 font-mono">{record.objective}</p>
                            </div>
                          )}
                          {record.assessment && (
                            <div className="rounded border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 p-2">
                              <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 mb-1">A — Assessment</div>
                              <p className="text-sm whitespace-pre-line line-clamp-4">{record.assessment}</p>
                            </div>
                          )}
                          {record.plan && (
                            <div className="rounded border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 p-2">
                              <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 mb-1">P — Plan</div>
                              <p className="text-sm whitespace-pre-line line-clamp-4 font-mono">{record.plan}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <EmptyState
                  icon={NotebookPen}
                  title={t('adviceStats.noSoapTitle', { label: monthLabel })}
                  description={t('adviceStats.noSoapDesc')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editingRecord !== null} onOpenChange={(open) => { if (!open) closeEditDialog(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-brand" />
              {t('adviceStats.editDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('adviceStats.editDialogDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{t('adviceStats.category')} *</label>
                <Select
                  value={editCategoryKey}
                  onValueChange={(value) => {
                    setEditCategoryKey(value);
                    setEditCode('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('adviceStats.selectCategory')} />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PHARMACY_ADVICE_CATEGORIES).map(([key, cat]) => (
                      <SelectItem key={key} value={key}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">{t('adviceStats.subitem')} *</label>
                <Select value={editCode} onValueChange={setEditCode} disabled={!editSelectedCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder={editSelectedCategory ? t('adviceStats.selectSubitem') : t('adviceStats.pickCategoryFirst')} />
                  </SelectTrigger>
                  <SelectContent>
                    {editSelectedCategory?.codes.map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.code} {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">{t('adviceStats.doctorAccept')}</label>
                <Select value={editAccepted} onValueChange={(value) => setEditAccepted(value as EditAcceptedValue)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('adviceStats.selectStatus')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{t('adviceStats.statusPending')}</SelectItem>
                    <SelectItem value="yes">{t('adviceStats.accepted')}</SelectItem>
                    <SelectItem value="no">{t('adviceStats.rejected')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.recordContent')} *</label>
              <Textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                className="min-h-[140px]"
                placeholder={t('adviceStats.recordContentPlaceholder')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.linkedDrugs')}</label>
              <Input
                value={editLinkedMedications}
                onChange={(event) => setEditLinkedMedications(event.target.value)}
                placeholder={t('adviceStats.linkedDrugsPlaceholder')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog} disabled={savingEdit}>
              {t('adviceStats.cancel')}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={savingEdit || !editSelectedCategory || !editSelectedCodeItem || !editContent.trim()}
            >
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit2 className="mr-2 h-4 w-4" />}
              {t('adviceStats.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingRecord !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingRecord(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('adviceStats.deleteRecord')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('adviceStats.deleteDialogDesc', { code: deletingRecord?.adviceCode ?? '', label: deletingRecord?.adviceLabel ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('adviceStats.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {t('adviceStats.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
