import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ScrollArea } from '../../components/ui/scroll-area';
import { LoadingSpinner, EmptyState } from '../../components/ui/state-display';
import { FileText, Loader2, User, Tag, Pill, Send, CheckCircle2, XCircle, CircleDot, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAdviceRecords,
  createAdviceRecord,
  getAdviceTagStats,
  type PharmacyAdviceRecord,
  type TagStatItem,
} from '../../lib/api/pharmacy';
import { type Patient } from '../../lib/api/patients';
import { getCachedPatients, getCachedPatientsSync } from '../../lib/patients-cache';
import {
  PHARMACY_ADVICE_CATEGORIES,
  PHARMACY_ADVICE_CATEGORY_COLORS,
} from '../../lib/pharmacy-master-data';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Label } from 'recharts';

export function PharmacyAdviceStatisticsPage() {
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

  // ── 月份選擇 ──
  const todayMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(todayMonth);

  const shiftMonth = (delta: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y} 年 ${m} 月`;
  })();

  // ── 紀錄 ──
  const [records, setRecords] = useState<PharmacyAdviceRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);

  // ── 留言板標籤統計 ──
  const [tagStats, setTagStats] = useState<TagStatItem[]>([]);
  const [tagStatsLoading, setTagStatsLoading] = useState(true);

  // 載入病患清單（共用快取，sync cache 命中則跳過）
  useEffect(() => {
    if (getCachedPatientsSync()) return;
    let cancelled = false;
    getCachedPatients()
      .then(data => { if (!cancelled) { setPatients(data); setPatientsLoading(false); } })
      .catch(() => { if (!cancelled) { toast.error('載入病患清單失敗'); setPatientsLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // 載入紀錄
  const fetchRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await getAdviceRecords({ month: selectedMonth, limit: 500 });
      setRecords(res.records);
    } catch {
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 載入留言板標籤統計
  useEffect(() => {
    let cancelled = false;
    setTagStatsLoading(true);
    getAdviceTagStats({ month: selectedMonth })
      .then(res => { if (!cancelled) setTagStats(res.tagStats || []); })
      .catch(() => { if (!cancelled) setTagStats([]); })
      .finally(() => { if (!cancelled) setTagStatsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedMonth]);

  // 取得選中的類別物件
  const selectedCategory = selectedCategoryKey
    ? PHARMACY_ADVICE_CATEGORIES[selectedCategoryKey]
    : null;

  // 取得選中的細項
  const selectedCodeItem = selectedCategory?.codes.find((c) => c.code === selectedCode);

  // 送出
  const handleSubmit = async () => {
    if (!selectedPatientId || !selectedCategory || !selectedCodeItem) {
      toast.error('請選擇病患與建議類別');
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
      toast.success('藥事紀錄已建立');
      setSelectedPatientId('');
      setSelectedCategoryKey('');
      setSelectedCode('');
      setAccepted('');
      setContent('');
      await fetchRecords();
    } catch {
      toast.error('建立紀錄失敗');
    } finally {
      setSubmitting(false);
    }
  };

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
        <p className="font-bold mt-1 text-base">{d.count} 筆</p>
      </div>
    );
  };

  const renderPieCenterLabel = ({ viewBox }: { viewBox?: { cx: number; cy: number } }) => {
    if (!viewBox) return null;
    const { cx, cy } = viewBox;
    return (
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
        <tspan x={cx} dy="-0.4em" fontSize={28} fontWeight={700} fill="#1a1a1a">{totalAdvices}</tspan>
        <tspan x={cx} dy="1.6em" fontSize={12} fill="#6b7280">筆建議</tspan>
      </text>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">用藥建議與統計</h1>
          <p className="text-muted-foreground text-sm mt-0.5">藥師照護介入紀錄與分類統計（四大類 23 細項）</p>
        </div>
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg px-2 py-1.5 shadow-sm">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[100px] text-center">{monthLabel}</span>
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
              本月
            </Button>
          )}
        </div>
      </div>

      {/* ── 新增紀錄 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">新增藥事紀錄</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            {/* 病患 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">病患 *</label>
              {patientsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground h-9">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 載入中...
                </div>
              ) : (
                <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="選擇病患" />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.bedNumber} {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* 類別 */}
            <div className="space-y-1">
              <label className="text-xs font-medium">建議類別 *</label>
              <Select
                value={selectedCategoryKey}
                onValueChange={(v) => {
                  setSelectedCategoryKey(v);
                  setSelectedCode('');
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="選擇類別" />
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
              <label className="text-xs font-medium">細項 *</label>
              <Select
                value={selectedCode}
                onValueChange={setSelectedCode}
                disabled={!selectedCategory}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={selectedCategory ? '選擇細項' : '先選類別'} />
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
              <label className="text-xs font-medium">醫師是否接受</label>
              <Select value={accepted} onValueChange={setAccepted}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="選擇" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">接受</SelectItem>
                  <SelectItem value="no">不接受</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 備註 + 送出 */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Textarea
                placeholder="備註說明（選填）"
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
                  送出
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
            <CardTitle className="text-sm font-medium">{monthLabel}總計</CardTitle>
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
                <p className="text-xs text-muted-foreground mt-1">{cat.codes.length} 細項</p>
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
                <CardTitle className="text-base">類別分佈</CardTitle>
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
                    <Tooltip formatter={(value: number, name: string) => [`${value} 筆`, name]} />
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
                  <CircleDot className="h-4 w-4" /> 醫師回應統計
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
                      <span className="text-xs text-muted-foreground">接受率</span>
                    </div>
                  </div>
                  {/* 統計 */}
                  <div className="grid grid-cols-2 gap-3 w-full text-center">
                    <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 py-2">
                      <div className="text-lg font-bold text-green-700 dark:text-green-300">{acceptedCount}</div>
                      <div className="text-xs text-green-600 dark:text-green-400">已接受</div>
                    </div>
                    <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 py-2">
                      <div className="text-lg font-bold text-red-700 dark:text-red-300">{rejectedCount}</div>
                      <div className="text-xs text-red-600 dark:text-red-400">未接受</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 各類別接受率 */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">各類別接受率</CardTitle>
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
              <CardTitle className="text-base">細項分析（{barData.length} 項）</CardTitle>
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
            <Tag className="h-4 w-4" /> 留言板標籤統計
            {tagStats.length > 0 && <Badge variant="secondary">{tagStats.length} 個標籤</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tagStatsLoading ? (
            <LoadingSpinner text="載入標籤統計..." />
          ) : tagStats.length > 0 ? (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={Math.max(200, tagStats.length * 36)}>
                <BarChart data={tagStats} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} stroke="#6b7280" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="tag" width={160} stroke="#6b7280" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => [`${value} 筆`, '使用次數']} />
                  <Bar dataKey="count" fill="var(--color-brand)" radius={[0, 6, 6, 0]} barSize={24} label={{ position: 'right', fontSize: 12, fontWeight: 600 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Tag} title="尚無標籤資料" description={`${monthLabel}的留言板沒有使用標籤`} />
          )}
        </CardContent>
      </Card>

      {/* ── 紀錄清單 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            紀錄清單
            <Badge variant="secondary">{records.length} 筆</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recordsLoading ? (
            <LoadingSpinner text="載入中..." />
          ) : records.length > 0 ? (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {records.map((record) => {
                  const isAccepted = record.accepted === true;
                  const isRejected = record.accepted === false;
                  const cardBg = isAccepted
                    ? 'bg-green-50/60 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : isRejected
                      ? 'bg-red-50/60 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      : 'bg-white dark:bg-slate-900';
                  return (
                    <div
                      key={record.id}
                      className={`border-l-4 rounded-lg p-3 hover:shadow-md transition-shadow ${cardBg}`}
                      style={{ borderLeftColor: PHARMACY_ADVICE_CATEGORY_COLORS[record.category] || '#999' }}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            className="text-white"
                            style={{ backgroundColor: PHARMACY_ADVICE_CATEGORY_COLORS[record.category] || '#999' }}
                          >
                            {record.adviceCode}
                          </Badge>
                          <span className="font-medium text-sm">{record.adviceLabel}</span>
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          {isAccepted && (
                            <Badge className="bg-green-600 hover:bg-green-700 text-white text-xs gap-1 px-2.5 py-0.5">
                              <CheckCircle2 className="h-3.5 w-3.5" /> 已接受
                            </Badge>
                          )}
                          {isRejected && (
                            <Badge variant="destructive" className="text-xs gap-1 px-2.5 py-0.5">
                              <XCircle className="h-3.5 w-3.5" /> 未接受
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(record.timestamp).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mb-1.5 text-xs">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{record.bedNumber} {record.patientName}</span>
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
          ) : (
            <EmptyState
              icon={FileText}
              title={`${monthLabel}尚無紀錄`}
              description="使用上方表單新增藥師照護介入紀錄"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
