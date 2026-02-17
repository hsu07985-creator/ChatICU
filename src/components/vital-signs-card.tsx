import { TrendingUp } from 'lucide-react';

interface VitalSignCardProps {
  label: string;
  value?: number | string | null;
  unit: string;
  onClick?: () => void;
  isAbnormal?: boolean;
  secondaryValue?: string; // 用於顯示如 "120/80" 的血壓值
}

export function VitalSignCard({ label, value, unit, onClick, isAbnormal, secondaryValue }: VitalSignCardProps) {
  const hasSecondaryValue = typeof secondaryValue === 'string' && secondaryValue.trim() !== '';
  const normalizedValue =
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
      ? '-'
      : String(value);
  const displayValue = hasSecondaryValue ? secondaryValue : normalizedValue;
  const canClick = typeof onClick === 'function';

  return (
    <div
      className={`bg-white p-4 rounded-lg border-2 ${
        isAbnormal
          ? 'border-[#f59e0b] hover:border-[#f59e0b]'
          : 'border-[#e5e7eb] hover:border-[#7f265b]'
      } transition-colors ${canClick ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}
      onClick={canClick ? onClick : undefined}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {canClick && <TrendingUp className="h-3.5 w-3.5 text-[#7f265b] opacity-60" />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${isAbnormal ? 'text-[#f59e0b]' : 'text-[#1a1a1a]'}`}>
          {displayValue}
        </span>
        <span className="text-sm text-[#6b7280]">{unit}</span>
      </div>
    </div>
  );
}
