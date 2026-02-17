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
  const canClick = typeof onClick === 'function' && displayValue !== '-';

  return (
    <div
      className={`group relative flex aspect-square flex-col rounded-xl border px-2 py-1.5 ${
        isAbnormal
          ? 'border-[#f59e0b] bg-gradient-to-br from-orange-50 to-rose-50/70'
          : 'border-[#e5e7eb] bg-gradient-to-br from-white to-slate-50'
      } ${
        canClick
          ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-[#7f265b]/45 hover:shadow-sm'
          : 'cursor-default'
      }`}
      onClick={canClick ? onClick : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {canClick && <TrendingUp className="h-3 w-3 text-[#7f265b] opacity-70" />}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className={`text-xl font-semibold leading-none tracking-tight ${isAbnormal ? 'text-[#d97706]' : 'text-[#0f172a]'}`}>
          {displayValue}
        </span>
        {unit && <span className="mt-0.5 text-[9px] leading-tight text-[#64748b]">{unit}</span>}
      </div>
    </div>
  );
}
