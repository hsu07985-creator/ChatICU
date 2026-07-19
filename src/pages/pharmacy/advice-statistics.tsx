import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { LoadingSpinner, EmptyState } from '../../components/ui/state-display';
import { FileText, User, Tag, Pill, CheckCircle2, XCircle, ChevronLeft, ChevronRight, Search, X, Edit2, Trash2 } from 'lucide-react';
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
import {
  PHARMACY_ADVICE_CATEGORIES,
  PHARMACY_ADVICE_CATEGORY_COLORS,
  getAdviceCategoryColor,
  getAdviceCategoryKeyByLabel as masterGetCategoryKeyByLabel,
} from '../../lib/pharmacy-master-data';
import { computeAdviceStats } from '../../lib/pharmacy/advice-stats';
import { AdviceRecordForm } from '../../components/pharmacy/advice-record-form';
import { AdviceCharts } from '../../components/pharmacy/advice-charts';
import { AdviceSoapTab } from '../../components/pharmacy/advice-soap-tab';
import { AdviceEditDialog, type EditAcceptedValue } from '../../components/pharmacy/advice-edit-dialog';
import { AdviceDeleteDialog } from '../../components/pharmacy/advice-delete-dialog';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { usePatientList } from '../../hooks/use-patient-list';

function getCategoryKeyByLabel(label: string): string {
  return masterGetCategoryKeyByLabel(label) || '';
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

  // ── 病患清單（共用 TanStack Query） ──
  const { patients, patientsLoading } = usePatientList();

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
  // Derived once per records change. computeAdviceStats does the per-category /
  // per-code tallies in a single pass (no O(n²) find-in-map). Memoized so the
  // charts only re-render when the underlying records actually change.
  const stats = useMemo(() => computeAdviceStats(records), [records]);
  const { categoryStats, totalAdvices } = stats;

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
      <AdviceRecordForm
        patients={patients}
        patientsLoading={patientsLoading}
        selectedPatientId={selectedPatientId}
        onSelectedPatientIdChange={setSelectedPatientId}
        selectedCategoryKey={selectedCategoryKey}
        onSelectedCategoryKeyChange={setSelectedCategoryKey}
        selectedCode={selectedCode}
        onSelectedCodeChange={setSelectedCode}
        accepted={accepted}
        onAcceptedChange={setAccepted}
        content={content}
        onContentChange={setContent}
        selectedCategory={selectedCategory}
        submitting={submitting}
        onSubmit={handleSubmit}
      />

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
          const color = PHARMACY_ADVICE_CATEGORY_COLORS[cat.key] || '#999';
          return (
            <Card key={key} className="border-l-4" style={{ borderLeftColor: color }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t(cat.labelKey ?? cat.label)}</CardTitle>
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
      {totalAdvices > 0 && <AdviceCharts stats={stats} />}

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
                      style={{ borderLeftColor: getAdviceCategoryColor(record.category) }}
                    >
                      <div className="flex items-start justify-between mb-1.5 gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            className="text-white"
                            style={{ backgroundColor: getAdviceCategoryColor(record.category) }}
                          >
                            {record.adviceCode}
                          </Badge>
                          <span className="font-medium text-sm">{t(`adviceCodes.${record.adviceCode}`, { defaultValue: record.adviceLabel })}</span>
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
                            {new Date(record.timestamp).toLocaleString(i18n.language, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })}
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
                        <Badge variant="outline" className="text-xs">{t(`adviceCategories.${getCategoryKeyByLabel(record.category)}`, { defaultValue: record.category })}</Badge>
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
          <AdviceSoapTab
            soapRecords={soapRecords}
            soapLoading={soapLoading}
            soapSearch={soapSearch}
            onSoapSearchChange={setSoapSearch}
            monthLabel={monthLabel}
          />
        </TabsContent>
      </Tabs>

      <AdviceEditDialog
        open={editingRecord !== null}
        onOpenChange={(open) => { if (!open) closeEditDialog(); }}
        categoryKey={editCategoryKey}
        onCategoryKeyChange={setEditCategoryKey}
        code={editCode}
        onCodeChange={setEditCode}
        accepted={editAccepted}
        onAcceptedChange={setEditAccepted}
        content={editContent}
        onContentChange={setEditContent}
        linkedMedications={editLinkedMedications}
        onLinkedMedicationsChange={setEditLinkedMedications}
        selectedCategory={editSelectedCategory}
        hasSelectedCode={!!editSelectedCodeItem}
        saving={savingEdit}
        onSave={handleSaveEdit}
        onCancel={closeEditDialog}
      />

      <AdviceDeleteDialog
        record={deletingRecord}
        onOpenChange={(open) => { if (!open) setDeletingRecord(null); }}
        deleting={deleting}
        onConfirm={() => { void handleConfirmDelete(); }}
      />
    </div>
  );
}
