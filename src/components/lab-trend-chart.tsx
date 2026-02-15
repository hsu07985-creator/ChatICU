import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Dot } from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';

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
  currentValue: number;
  trendData: LabTrendData[];
  referenceRange: string;
}

export function LabTrendChart({
  isOpen,
  onClose,
  labName,
  labNameChinese,
  unit,
  currentValue,
  trendData,
  referenceRange
}: LabTrendChartProps) {
  // 計算變化量和變化率
  const calculateChange = () => {
    if (trendData.length < 2) {
      return { changeValue: 0, changePercent: 0, isIncrease: false };
    }
    
    const previousValue = trendData[trendData.length - 2].value;
    const changeValue = currentValue - previousValue;
    const changePercent = previousValue !== 0 ? ((changeValue / previousValue) * 100) : 0;
    const isIncrease = changeValue > 0;
    
    return { changeValue, changePercent, isIncrease };
  };

  const { changeValue, changePercent, isIncrease } = calculateChange();

  // 計算 Y 軸範圍
  const values = trendData.map(d => d.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = (maxValue - minValue) * 0.2;
  const yMin = Math.max(0, Math.floor(minValue - padding));
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

        {/* 統計資訊區 */}
        <div className="grid grid-cols-4 gap-4 mt-6">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">目前數值</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">{currentValue}</span>
              <span className="text-sm text-muted-foreground">{unit}</span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">變化量</p>
            <div className="flex items-center gap-2">
              {changeValue !== 0 && (
                isIncrease ? (
                  <TrendingUp className="h-5 w-5 text-red-500" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-green-500" />
                )
              )}
              <span className={`text-3xl font-semibold ${
                changeValue > 0 ? 'text-red-500' : changeValue < 0 ? 'text-green-500' : ''
              }`}>
                {changeValue > 0 ? '+' : ''}{changeValue.toFixed(1)}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">變化率</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-semibold ${
                changePercent > 0 ? 'text-red-500' : changePercent < 0 ? 'text-green-500' : ''
              }`}>
                {changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">參考範圍</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">{referenceRange}</span>
              <span className="text-sm text-muted-foreground">{unit}</span>
            </div>
          </div>
        </div>

        {/* 折線圖 */}
        <div className="mt-8 h-[400px]">
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
                stroke="#7f265b"
                strokeWidth={2}
                dot={(props: any) => {
                  const { cx, cy, index } = props;
                  return (
                    <Dot
                      key={`dot-${index}`}
                      cx={cx}
                      cy={cy}
                      r={6}
                      fill="#7f265b"
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 8, fill: '#7f265b', stroke: '#ffffff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </DialogContent>
    </Dialog>
  );
}