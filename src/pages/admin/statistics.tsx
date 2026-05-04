import { useCallback, useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { LoadingSpinner, ErrorDisplay, EmptyState } from '../../components/ui/state-display';
import { BarChart3, TrendingUp, Tag, User as UserIcon, CircleDot, CheckCircle2, XCircle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { getAdviceRecordStats, type AdviceRecordStats } from '../../lib/api/pharmacy';
import { PHARMACY_ADVICE_CATEGORIES, getAdviceCategoryColor } from '../../lib/pharmacy-master-data';

export function AdminStatisticsPage() {
  const { t } = useTranslation('admin');
  const { t: tp } = useTranslation('pharmacy');
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
      const label = t('stats.monthLabel', { year: date.getFullYear(), month: date.getMonth() + 1 });
      options.push({ value, label });
    }
    return options;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await getAdviceRecordStats({ month: selectedMonth });
      setStats(resp);
    } catch (err) {
      console.error(t('stats.loadFail'), err);
      setError(t('stats.errorMessage'));
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
      category: tp(cat.labelKey ?? cat.label),
      count: categoryCountMap[cat.label] || 0,
      color: getAdviceCategoryColor(cat.key),
    }));
  }, [categoryCountMap, tp]);

  const topCodes = useMemo(() => {
    const rows = [...(stats?.byCode || [])];
    rows.sort((a, b) => b.count - a.count);
    return rows.slice(0, 10).map((r) => ({
      code: r.code,
      name: `${r.code} ${tp(`adviceCodes.${r.code}`, { defaultValue: r.label })}`,
      count: r.count,
      color: getAdviceCategoryColor(r.category),
    }));
  }, [stats?.byCode, tp]);

  const topPharmacists = useMemo(() => {
    return (stats?.byPharmacist || []).slice(0, 10);
  }, [stats?.byPharmacist]);

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
        <LoadingSpinner text={t('stats.loading')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
        <ErrorDisplay
          type="server"
          title={t('stats.errorTitle')}
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
          <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('stats.subtitle')}</p>
        </div>

        <Card>
          <CardContent className="pt-4">
            <label className="text-sm font-medium mb-2 block">{t('stats.selectMonth')}</label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger>
                <SelectValue placeholder={t('stats.selectMonth')} />
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
          title={t('stats.emptyTitle')}
          description={t('stats.emptyDesc')}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('stats.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('stats.subtitle')}</p>
        </div>
        <div className="w-full max-w-[260px]">
          <label className="text-sm font-medium mb-2 block">{t('stats.selectMonth')}</label>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger>
              <SelectValue placeholder={t('stats.selectMonth')} />
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
        <Card className="border-brand">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('stats.totalCard')}</CardTitle>
            <TrendingUp className="h-5 w-5 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">{t('stats.monthlyTotal')}</p>
          </CardContent>
        </Card>

        {Object.values(PHARMACY_ADVICE_CATEGORIES).map((cat) => (
          <Card key={cat.key} className="border-l-4" style={{ borderLeftColor: getAdviceCategoryColor(cat.key) }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{tp(cat.labelKey ?? cat.label)}</CardTitle>
              <Badge variant="outline" className="text-xs">
                {t('stats.subitemCount', { count: (cat.codes || []).length })}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: getAdviceCategoryColor(cat.key) }}>
                {categoryCountMap[cat.label] || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t('stats.monthlyTotal')}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Category chart + acceptance rate */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-brand" />
              {t('stats.categoryDistribution')}
            </CardTitle>
            <CardDescription>{t('stats.categoryDistributionDesc')}</CardDescription>
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
              <CircleDot className="h-5 w-5 text-brand" />
              {t('stats.doctorResponse')}
            </CardTitle>
            <CardDescription>{t('stats.monthlyAcceptRate')}</CardDescription>
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
                      <span className="text-xs text-muted-foreground">{t('stats.acceptRate')}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 w-full text-center">
                    <div className="rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 py-2">
                      <div className="text-lg font-bold text-green-700 dark:text-green-300">{acc.accepted}</div>
                      <div className="text-xs text-green-600 dark:text-green-400">{t('stats.accepted')}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 py-2">
                      <div className="text-lg font-bold text-red-700 dark:text-red-300">{acc.rejected}</div>
                      <div className="text-xs text-red-600 dark:text-red-400">{t('stats.rejected')}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 py-2">
                      <div className="text-lg font-bold text-gray-600 dark:text-gray-400">{acc.pending}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t('stats.pending')}</div>
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
              <Tag className="h-5 w-5 text-brand" />
              {t('stats.topCodes')}
            </CardTitle>
            <CardDescription>{t('stats.topCodesDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {topCodes.length === 0 ? (
              <EmptyState icon={Tag} title={t('stats.noCodesTitle')} description={t('stats.noCodesDesc')} />
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
                        <div className="bg-white dark:bg-slate-900 border dark:border-slate-700 rounded-lg shadow-lg p-3 text-sm">
                          <p className="font-semibold">{d.name}</p>
                          <p className="font-bold mt-1">{t('stats.tooltipCount', { count: d.count })}</p>
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
              <UserIcon className="h-5 w-5 text-brand" />
              {t('stats.topPharmacists')}
            </CardTitle>
            <CardDescription>{t('stats.topPharmacistsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPharmacists.length === 0 ? (
              <EmptyState icon={UserIcon} title={t('stats.noPharmacistTitle')} description={t('stats.noCodesDesc')} />
            ) : (
              <div className="space-y-2">
                {topPharmacists.map((p, idx) => (
                  <div key={`${p.pharmacistName}-${idx}`} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <Badge className="bg-brand text-white">{idx + 1}</Badge>
                      <div>
                        <div className="font-medium">{p.pharmacistName}</div>
                        <div className="text-xs text-muted-foreground">{t('stats.monthlyIntervention')}</div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-brand">{p.count}</div>
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

