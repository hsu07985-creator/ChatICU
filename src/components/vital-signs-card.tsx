function formatShortTimestamp(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}

interface VitalSignCardProps {
  label: string;
  value?: number | string | null;
  unit: string;
  onClick?: () => void;
  isAbnormal?: boolean;
  secondaryValue?: string; // 用於顯示如 "120/80" 的血壓值
  timestamp?: string;
}

export function VitalSignCard({ label, value, unit, onClick, isAbnormal, secondaryValue, timestamp }: VitalSignCardProps) {
  const hasSecondaryValue = typeof secondaryValue === 'string' && secondaryValue.trim() !== '';
  const normalizedValue =
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
      ? '-'
      : String(value);
  const displayValue = hasSecondaryValue ? secondaryValue : normalizedValue;
  const isMissing = displayValue === '-';
  const canClick = typeof onClick === 'function' && displayValue !== '-';
  const valueToneClass = isMissing
    ? 'font-medium text-slate-400'
    : isAbnormal
      ? 'font-semibold text-[#d97706]'
      : 'font-semibold text-[#0f172a]';

  return (
    <div
      className={`group relative flex aspect-square flex-col rounded-xl border px-2.5 py-2 ${
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
      <div className="flex items-start gap-1">
        <p
          className="font-semibold leading-tight tracking-tight text-slate-500"
          style={{ fontSize: 'calc(var(--metric-card-label-size) + 0.1rem)' }}
        >
          {label}
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span
          className={`leading-none tracking-tight ${valueToneClass}`}
          style={{ fontSize: 'calc(var(--metric-card-value-size) + 0.3rem)' }}
        >
          {displayValue}
        </span>
        {unit && (
          <span
            className={`mt-0.5 leading-tight ${isMissing ? 'text-slate-400' : 'text-[#64748b]'}`}
            style={{ fontSize: 'calc(var(--metric-card-unit-size) + 0.12rem)' }}
          >
            {unit}
          </span>
        )}
      </div>
      {timestamp && (
        <span
          className="mt-auto text-center leading-none text-slate-400"
          style={{ fontSize: '0.55rem' }}
        >
          {formatShortTimestamp(timestamp)}
        </span>
      )}
    </div>
  );
}
