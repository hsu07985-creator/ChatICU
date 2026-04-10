import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Dot, Tooltip, ReferenceArea, type TooltipProps } from 'recharts';

export interface LabTrendData {
  date: string;
  value: number;
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

function formatChartDate(dateStr: string): string {
  if (!dateStr || dateStr === '目前') return dateStr;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}

function parseReferenceRange(range?: string): { low?: number; high?: number } | null {
  if (!range) return null;
  const trimmed = range.trim();

  // "3.5-5.0" format
  const rangeMatch = trimmed.match(/^([\d.]+)\s*[-–~]\s*([\d.]+)/);
  if (rangeMatch) {
    return { low: parseFloat(rangeMatch[1]), high: parseFloat(rangeMatch[2]) };
  }

  // "≤25" / "<25" → upper bound only
  const ltMatch = trimmed.match(/^[<≤]\s*([\d.]+)/);
  if (ltMatch) {
    return { high: parseFloat(ltMatch[1]) };
  }

  // "≥19" / ">19" → lower bound only
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
  // 計算 Y 軸範圍
  const values = trendData.map(d => d.value);
  const refBounds = parseReferenceRange(referenceRange);
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

        {/* 折線圖 */}
        <div className="mt-4 h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={trendData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              {refBounds && (
                <ReferenceArea
                  y1={refBounds.low ?? yMin}
                  y2={refBounds.high ?? yMax}
                  fill="#10b981"
                  fillOpacity={0.08}
                  stroke="#10b981"
                  strokeOpacity={0.2}
                  strokeDasharray="4 4"
                />
              )}
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                tick={{ fontSize: 12, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
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
                  style: { fontSize: 14, fill: '#6b7280' }
                }}
              />
              <Tooltip
                content={({ active, payload, label }: TooltipProps<number, string>) => {
                  if (!active || !payload?.[0]) return null;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md">
                      <p className="text-xs text-slate-500">{formatChartDate(label ?? '')}</p>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-brand)' }}>
                        {payload[0].value} {unit}
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-brand)"
                strokeWidth={2}
                dot={(props: any) => {
                  const { cx, cy, index } = props;
                  return (
                    <Dot
                      key={`dot-${index}`}
                      cx={cx}
                      cy={cy}
                      r={6}
                      fill="var(--color-brand)"
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 8, fill: 'var(--color-brand)', stroke: '#ffffff', strokeWidth: 2 }}
                label={({ x, y, value, index }: any) => (
                  <text
                    key={`label-${index}`}
                    x={x}
                    y={y - 12}
                    textAnchor="middle"
                    fill="#374151"
                    fontSize={12}
                    fontWeight={600}
                  >
                    {value}
                  </text>
                )}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
