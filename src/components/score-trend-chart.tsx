import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Dot, Tooltip, type TooltipProps } from 'recharts';
import { Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import type { ScoreEntry } from '@/lib/api/scores';

export interface ScoreTrendChartProps {
  isOpen: boolean;
  onClose: () => void;
  scoreType: 'pain' | 'rass';
  trendData: { date: string; value: number }[];
  scoreEntries: ScoreEntry[];
  onDeleteEntry?: (scoreId: string) => Promise<void>;
}

export function ScoreTrendChart({
  isOpen,
  onClose,
  scoreType,
  trendData,
  scoreEntries,
  onDeleteEntry,
}: ScoreTrendChartProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const labName = scoreType === 'pain' ? 'Pain Score' : 'RASS Score';
  const labNameChinese = scoreType === 'pain' ? '疼痛分數' : '鎮靜分數';
  const unit = scoreType === 'pain' ? '分 (0-10)' : '分 (-5~+4)';

  // Y axis range
  const values = trendData.map(d => d.value);
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 1;
  const baseRange = Math.max(maxValue - minValue, 1);
  const padding = baseRange * 0.2;
  const yMin = Math.floor(minValue - padding);
  const yMax = Math.ceil(maxValue + padding);

  const handleDelete = async (scoreId: string) => {
    if (!onDeleteEntry) return;
    setDeletingId(scoreId);
    try {
      await onDeleteEntry(scoreId);
    } finally {
      setDeletingId(null);
    }
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
          </DialogDescription>
        </DialogHeader>

        {/* Chart */}
        <div className="mt-4 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={trendData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 14, fill: '#6b7280' }}
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
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-md">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
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

        {/* History table */}
        {scoreEntries.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">歷史紀錄</h4>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">時間</th>
                    <th className="px-3 py-2 text-center font-medium text-slate-600 dark:text-slate-400">分數</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-400">記錄者</th>
                    {onDeleteEntry && (
                      <th className="px-3 py-2 text-center font-medium text-slate-600 dark:text-slate-400 w-16">操作</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {scoreEntries.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                        {new Date(entry.timestamp).toLocaleString('zh-TW', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold">{entry.value}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{entry.recordedBy}</td>
                      {onDeleteEntry && (
                        <td className="px-3 py-2 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                            disabled={deletingId === entry.id}
                            onClick={() => handleDelete(entry.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
