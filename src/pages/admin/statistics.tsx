import { useCallback, useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { LoadingSpinner, ErrorDisplay, EmptyState } from '../../components/ui/state-display';
import { BarChart3, TrendingUp, Tag, User as UserIcon, CircleDot, CheckCircle2, XCircle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { getAdviceRecordStats, type AdviceRecordStats } from '../../lib/api/pharmacy';
import { PHARMACY_ADVICE_CATEGORIES, PHARMACY_ADVICE_CATEGORY_COLORS } from '../../lib/pharmacy-master-data';

export function AdminStatisticsPage() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState<string>(
    `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdviceRecordStats | null>(null);

  const monthOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    for (let i = 0; i < 12; i++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
      options.push({ value, label });
    }
    return options;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await getAdviceRecordStats({ month: selectedMonth });
      setStats(resp);
    } catch (err) {
      console.error('載入統計資料失敗:', err);
      setError('無法載入統計資料，請確認後端服務是否正常運行');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const categoryCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    (stats?.byCategory || []).forEach((it) => {
      map[it.category] = it.count;
    });
    return map;
  }, [stats?.byCategory]);

  const categoryChartData = useMemo(() => {
    return Object.values(PHARMACY_ADVICE_CATEGORIES).map((cat) => ({
      category: cat.label,
      count: categoryCountMap[cat.label] || 0,
      color: PHARMACY_ADVICE_CATEGORY_COLORS[cat.label] || '#999',
    }));
  }, [categoryCountMap]);

  const topCodes = useMemo(() => {
    const rows = [...(stats?.byCode || [])];
    rows.sort((a, b) => b.count - a.count);
    return rows.slice(0, 10).map((r) => ({
      code: r.code,
      name: `${r.code} ${r.label}`,
      count: r.count,
      color: PHARMACY_ADVICE_CATEGORY_COLORS[r.category] || '#999',
    }));
  }, [stats?.byCode]);

  const topPharmacists = useMemo(() => {
    return (stats?.byPharmacist || []).slice(0, 10);
  }, [stats?.byPharmacist]);

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">藥事統計（管理者）</h1>
        <LoadingSpinner text="載入統計資料中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">藥事統計（管理者）</h1>
        <ErrorDisplay
          type="server"
          title="載入失敗"
          message={error}
          onRetry={loadStats}
        />
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">藥事統計（管理者）</h1>
          <p className="text-muted-foreground text-sm mt-1">用藥建議介入紀錄與統計（依月份）</p>
        </div>

        <Card>
          <CardContent className="pt-4">
            <label className="text-sm font-medium mb-2 block">選擇月份</label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger>
                <SelectValue placeholder="選擇月份" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <EmptyState
          icon={BarChart3}
          title="本月尚無用藥建議介入記錄"
          description="當藥師送出用藥建議並完成分類後，這裡會自動彙總統計。"
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">藥事統計（管理者）</h1>
          <p className="text-muted-foreground text-sm mt-1">用藥建議介入紀錄與統計（依月份）</p>
        </div>
        <div className="w-full max-w-[260px]">
          <label className="text-sm font-medium mb-2 block">選擇月份</label>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger>
              <SelectValue placeholder="選擇月份" />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-[var(--color-brand)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總介入數</CardTitle>
            <TrendingUp className="h-5 w-5 text-[var(--color-brand)]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[var(--color-brand)]">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">本月累計</p>
          </CardContent>
        </Card>

        {Object.values(PHARMACY_ADVICE_CATEGORIES).map((cat) => (
          <Card key={cat.key} className="border-l-4" style={{ borderLeftColor: PHARMACY_ADVICE_CATEGORY_COLORS[cat.label] || '#999' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{cat.label}</CardTitle>
              <Badge variant="outline" className="text-xs">
                {(cat.codes || []).length} 細項
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: PHARMACY_ADVICE_CATEGORY_COLORS[cat.label] || '#111' }}>
                {categoryCountMap[cat.label] || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">本月累計</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Category chart + acceptance rate */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-[var(--color-brand)]" />
              類別分佈
            </CardTitle>
            <CardDescription>四大類介入數量</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryChartData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={48} label={{ position: 'top', fontSize: 13, fontWeight: 700 }}>
                  {categoryChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Acceptance rate */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleDot className="h-5 w-5 text-[var(--color-brand)]" />
              醫師回應統計
            </CardTitle>
            <CardDescription>本月建議接受率</CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const acc = stats.byAcceptance || { accepted: 0, rejected: 0, pending: 0 };
              const rate = stats.total > 0 ? Math.round((acc.accepted / stats.total) * 100) : 0;
              return (
                <div className="flex flex-col items-center">
                  <div className="relative w-32 h-32 mb-3">
                    <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#16a34a" strokeWidth="10"
                        strokeDasharray={`${rate * 3.14} ${314 - rate * 3.14}`}
                        strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold text-[#16a34a]">{rate}%</span>
                      <span className="text-xs text-muted-foreground">接受率</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 w-full text-center">
                    <div className="rounded-lg bg-green-50 border border-green-200 py-2">
                      <div className="text-lg font-bold text-green-700">{acc.accepted}</div>
                      <div className="text-xs text-green-600">已接受</div>
                    </div>
                    <div className="rounded-lg bg-red-50 border border-red-200 py-2">
                      <div className="text-lg font-bold text-red-700">{acc.rejected}</div>
                      <div className="text-xs text-red-600">未接受</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 border border-gray-200 py-2">
                      <div className="text-lg font-bold text-gray-600">{acc.pending}</div>
                      <div className="text-xs text-gray-500">未填</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top codes — vertical histogram */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-[var(--color-brand)]" />
              Top 10 介入代碼
            </CardTitle>
            <CardDescription>依本月數量排序</CardDescription>
          </CardHeader>
          <CardContent>
            {topCodes.length === 0 ? (
              <EmptyState icon={Tag} title="尚無代碼統計" description="建立用藥建議介入記錄後會自動統計。" />
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topCodes} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="code" tick={{ fontSize: 11 }} interval={0} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload }: { active?: boolean; payload?: Array<{ payload?: typeof topCodes[number] }> }) => {
                      if (!active || !payload?.[0]?.payload) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-white border rounded-lg shadow-lg p-3 text-sm">
                          <p className="font-semibold">{d.name}</p>
                          <p className="font-bold mt-1">{d.count} 筆</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={32} label={{ position: 'top', fontSize: 13, fontWeight: 700 }}>
                    {topCodes.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top pharmacists */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-[var(--color-brand)]" />
              Top 10 藥師
            </CardTitle>
            <CardDescription>依本月介入數量排序</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPharmacists.length === 0 ? (
              <EmptyState icon={UserIcon} title="尚無藥師統計" description="建立用藥建議介入記錄後會自動統計。" />
            ) : (
              <div className="space-y-2">
                {topPharmacists.map((p, idx) => (
                  <div key={`${p.pharmacistName}-${idx}`} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <Badge className="bg-[var(--color-brand)] text-white">{idx + 1}</Badge>
                      <div>
                        <div className="font-medium">{p.pharmacistName}</div>
                        <div className="text-xs text-muted-foreground">本月介入</div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-[var(--color-brand)]">{p.count}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default AdminStatisticsPage;

