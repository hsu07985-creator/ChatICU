import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Dot,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  type TooltipProps,
} from 'recharts';

export interface LabTrendData {
  date: string;
  value: number;
  scrValue?: number;
  weightUsed?: number;
  weightTimestamp?: string;
  weightSource?: string;
}

export interface LabTrendChartProps {
  isOpen: boolean;
  onClose: () => void;
  labName: string;
  labNameChinese: string;
  unit: string;
  trendData: LabTrendData[];
  referenceRange?: string;
}

type WindowDays = 7 | 30 | 90 | null;

const WINDOW_OPTIONS: { label: string; value: WindowDays }[] = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
  { label: '全部', value: null },
];

function formatDateShort(dateStr: string): string {
  if (!dateStr || dateStr === '目前') return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function formatDateFull(dateStr: string): string {
  if (!dateStr || dateStr === '目前') return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

function formatWeightSource(source?: string): string {
  switch (source) {
    case 'vital_signs':
      return '歷史體重';
    case 'initial_backfill':
      return '首筆體重回補';
    case 'patient_profile':
      return '病人主檔體重';
    default:
      return source ?? '';
  }
}

function parseReferenceRange(range?: string): { low?: number; high?: number } | null {
  if (!range) return null;
  const trimmed = range.trim();

  const rangeMatch = trimmed.match(/^([\d.]+)\s*[-–~]\s*([\d.]+)/);
  if (rangeMatch) {
    return { low: parseFloat(rangeMatch[1]), high: parseFloat(rangeMatch[2]) };
  }

  const ltMatch = trimmed.match(/^[<≤]\s*([\d.]+)/);
  if (ltMatch) {
    return { high: parseFloat(ltMatch[1]) };
  }

  const gtMatch = trimmed.match(/^[>≥]\s*([\d.]+)/);
  if (gtMatch) {
    return { low: parseFloat(gtMatch[1]) };
  }

  return null;
}

export function LabTrendChart({
  isOpen,
  onClose,
  labName,
  labNameChinese,
  unit,
  trendData,
  referenceRange,
}: LabTrendChartProps) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);

  const refBounds = useMemo(() => parseReferenceRange(referenceRange), [referenceRange]);

  const filteredData = useMemo(() => {
    if (windowDays === null) return trendData;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const kept = trendData.filter((d) => {
      const t = new Date(d.date).getTime();
      return isNaN(t) ? true : t >= cutoff;
    });
    return kept.length > 0 ? kept : trendData;
  }, [trendData, windowDays]);

  const values = filteredData.map((d) => d.value);
  const allValues = [
    ...values,
    ...(refBounds?.low !== undefined ? [refBounds.low] : []),
    ...(refBounds?.high !== undefined ? [refBounds.high] : []),
  ];
  const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 1;
  const baseRange = Math.max(maxValue - minValue, 1);
  const padding = baseRange * 0.2;
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  const dotColor = (value: number): string => {
    if (refBounds?.high !== undefined && value > refBounds.high) return '#dc2626';
    if (refBounds?.low !== undefined && value < refBounds.low) return '#2563eb';
    return '#94a3b8';
  };

  const dotRadius = (value: number): number => {
    if (refBounds?.high !== undefined && value > refBounds.high) return 6;
    if (refBounds?.low !== undefined && value < refBounds.low) return 6;
    return 4;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {labNameChinese} ({labName})
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            歷史趨勢分析
            {refBounds && (
              <span className="ml-2 text-emerald-600">
                參考範圍: {referenceRange} {unit}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-500">顯示區間：</span>
          {WINDOW_OPTIONS.map((opt) => {
            const active = windowDays === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setWindowDays(opt.value)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? 'bg-brand text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          <span className="ml-2 text-xs text-slate-400">共 {filteredData.length} 筆</span>
        </div>

        <div className="mt-3 h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={filteredData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              {refBounds && (
                <ReferenceArea
                  y1={refBounds.low ?? yMin}
                  y2={refBounds.high ?? yMax}
                  fill="#10b981"
                  fillOpacity={0.08}
                  stroke="none"
                />
              )}
              {refBounds?.low !== undefined && (
                <ReferenceLine
                  y={refBounds.low}
                  stroke="#10b981"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                />
              )}
              {refBounds?.high !== undefined && (
                <ReferenceLine
                  y={refBounds.high}
                  stroke="#10b981"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                />
              )}
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={{ fontSize: 12, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                minTickGap={20}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fontSize: 14, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                label={{
                  value: unit,
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 14, fill: '#6b7280' },
                }}
              />
              <Tooltip
                content={({ active, payload, label }: TooltipProps<number, string>) => {
                  if (!active || !payload?.[0]) return null;
                  const val = payload[0].value as number;
                  const point = payload[0].payload as LabTrendData | undefined;
                  const color = dotColor(val);
                  const status =
                    refBounds === null
                      ? null
                      : refBounds?.high !== undefined && val > refBounds.high
                        ? '偏高'
                        : refBounds?.low !== undefined && val < refBounds.low
                          ? '偏低'
                          : '正常';
                  return (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-md">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{formatDateFull(label ?? '')}</p>
                      <p className="text-sm font-semibold" style={{ color }}>
                        {val} {unit}{status ? ` · ${status}` : ''}
                      </p>
                      {labName === 'Clcr' && point && (
                        <div className="mt-1.5 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {typeof point.scrValue === 'number' && (
                            <p>Scr: {point.scrValue} mg/dL</p>
                          )}
                          {typeof point.weightUsed === 'number' && (
                            <p>使用體重: {point.weightUsed} kg</p>
                          )}
                          {point.weightTimestamp && (
                            <p>體重時間: {formatDateFull(point.weightTimestamp)}</p>
                          )}
                          {point.weightSource && (
                            <p>體重來源: {formatWeightSource(point.weightSource)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#6b7280"
                strokeWidth={1.5}
                dot={(props: any) => {
                  const { cx, cy, index, payload } = props;
                  const v = payload?.value as number;
                  return (
                    <Dot
                      key={`dot-${index}`}
                      cx={cx}
                      cy={cy}
                      r={dotRadius(v)}
                      fill={dotColor(v)}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  );
                }}
                activeDot={{ r: 8, stroke: '#ffffff', strokeWidth: 2 }}
                label={({ x, y, value, index }: any) => {
                  const v = value as number;
                  const isAbnormal =
                    (refBounds?.high !== undefined && v > refBounds.high) ||
                    (refBounds?.low !== undefined && v < refBounds.low);
                  const isExtreme =
                    values.length > 0 && (v === Math.max(...values) || v === Math.min(...values));
                  const isLatest = index === filteredData.length - 1;
                  if (!isAbnormal && !isExtreme && !isLatest) return <g key={`lbl-${index}`} />;
                  return (
                    <text
                      key={`label-${index}`}
                      x={x}
                      y={y - 10}
                      textAnchor="middle"
                      fill={isAbnormal ? dotColor(v) : '#374151'}
                      fontSize={11}
                      fontWeight={600}
                    >
                      {v}
                    </text>
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
