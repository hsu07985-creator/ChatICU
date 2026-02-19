import { useCallback, useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { LoadingSpinner, ErrorDisplay, EmptyState } from '../../components/ui/state-display';
import { BarChart3, TrendingUp, Tag, User as UserIcon } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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
        <h1>藥事統計（管理者）</h1>
        <LoadingSpinner text="載入統計資料中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1>藥事統計（管理者）</h1>
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
          <h1>藥事統計（管理者）</h1>
          <p className="text-muted-foreground mt-1">用藥建議介入紀錄與統計（依月份）</p>
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
          <h1>藥事統計（管理者）</h1>
          <p className="text-muted-foreground mt-1">用藥建議介入紀錄與統計（依月份）</p>
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
        <Card className="border-[#7f265b]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">總介入數</CardTitle>
            <TrendingUp className="h-5 w-5 text-[#7f265b]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#7f265b]">{stats.total}</div>
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

      {/* Category chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[#7f265b]" />
            類別分佈
          </CardTitle>
          <CardDescription>四大類介入數量</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={categoryChartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="category" tick={{ fontSize: 12 }} angle={-10} textAnchor="end" interval={0} height={60} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#7f265b" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top codes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-[#7f265b]" />
              Top 10 介入代碼
            </CardTitle>
            <CardDescription>依本月數量排序</CardDescription>
          </CardHeader>
          <CardContent>
            {topCodes.length === 0 ? (
              <EmptyState icon={Tag} title="尚無代碼統計" description="建立用藥建議介入記錄後會自動統計。" />
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topCodes} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#7f265b" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top pharmacists */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-[#7f265b]" />
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
                      <Badge className="bg-[#7f265b] text-white">{idx + 1}</Badge>
                      <div>
                        <div className="font-medium">{p.pharmacistName}</div>
                        <div className="text-xs text-muted-foreground">本月介入</div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-[#7f265b]">{p.count}</div>
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

