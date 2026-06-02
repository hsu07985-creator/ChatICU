// Advice-statistics charts block, extracted from
// src/pages/pharmacy/advice-statistics.tsx. Renders the donut (category
// distribution), the accept-rate gauge, the per-category accept-rate bars, and
// the per-subitem histogram. Pure presentational: all numbers come pre-computed
// from computeAdviceStats(). Behavior-preserving.

import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { CircleDot } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Label,
} from 'recharts';
import type { AdviceStats, AdviceBarDatum } from '../../lib/pharmacy/advice-stats';

export interface AdviceChartsProps {
  stats: AdviceStats;
}

export function AdviceCharts({ stats }: AdviceChartsProps) {
  const { t } = useTranslation('pharmacy');
  const {
    pieData,
    barData,
    totalAdvices,
    acceptRate,
    acceptedCount,
    rejectedCount,
    categoryAcceptRates,
  } = stats;

  const renderBarTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload?: AdviceBarDatum }>;
  }) => {
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
              {categoryAcceptRates.map((cat) => (
                <div key={cat.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium truncate pr-2">{t(cat.labelKey ?? cat.label)}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {cat.total > 0 ? `${cat.accepted}/${cat.total}` : '—'}
                    </span>
                  </div>
                  <div className="h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${cat.rate}%`, backgroundColor: cat.color }}
                    />
                  </div>
                  {cat.total > 0 && (
                    <div className="text-right text-xs font-medium mt-0.5" style={{ color: cat.color }}>
                      {cat.rate}%
                    </div>
                  )}
                </div>
              ))}
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
  );
}
