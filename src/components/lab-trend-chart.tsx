import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Dot } from 'recharts';

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
}

export function LabTrendChart({
  isOpen,
  onClose,
  labName,
  labNameChinese,
  unit,
  trendData
}: LabTrendChartProps) {
  // 計算 Y 軸範圍
  const values = trendData.map(d => d.value);
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values) : 1;
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
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
