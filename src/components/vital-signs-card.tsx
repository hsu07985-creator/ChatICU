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
  abnormalDirection?: 'high' | 'low' | 'normal';
  secondaryValue?: string;
  timestamp?: string;
}

import { memo } from 'react';

export const VitalSignCard = memo(function VitalSignCard({ label, value, unit, onClick, isAbnormal, abnormalDirection, secondaryValue, timestamp }: VitalSignCardProps) {
  const hasSecondaryValue = typeof secondaryValue === 'string' && secondaryValue.trim() !== '';
  const normalizedValue =
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
      ? '-'
      : String(value);
  const displayValue = hasSecondaryValue ? secondaryValue : normalizedValue;
  const isMissing = displayValue === '-';
  const canClick = typeof onClick === 'function' && displayValue !== '-';
  const valueToneClass = isMissing
    ? 'font-medium text-slate-400 dark:text-slate-500'
    : isAbnormal
      ? abnormalDirection === 'low'
        ? 'font-semibold text-blue-600 dark:text-blue-400'
        : 'font-semibold text-red-600 dark:text-red-400'
      : 'font-semibold text-[#0f172a] dark:text-slate-100';

  return (
    <div
      className={`group relative flex aspect-square flex-col rounded-xl border px-2.5 py-2 ${
        isAbnormal
          ? abnormalDirection === 'low'
            ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-sky-50/70 dark:from-blue-950/40 dark:to-sky-950/30'
            : 'border-red-400 bg-gradient-to-br from-red-50 to-rose-50/70 dark:from-red-950/40 dark:to-rose-950/30'
          : 'border-border bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800'
      } ${
        canClick
          ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-sm'
          : 'cursor-default'
      }`}
      onClick={canClick ? onClick : undefined}
    >
      <div className="flex items-start gap-1">
        <p
          className="font-semibold leading-tight tracking-tight text-slate-500 dark:text-slate-400"
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
            className={`mt-0.5 leading-tight ${isMissing ? 'text-slate-400 dark:text-slate-500' : 'text-[#64748b] dark:text-slate-400'}`}
            style={{ fontSize: 'calc(var(--metric-card-unit-size) + 0.12rem)' }}
          >
            {unit}
          </span>
        )}
      </div>
      {timestamp && (
        <span
          className="mt-auto text-center leading-none text-slate-400 dark:text-slate-500"
          style={{ fontSize: '0.55rem' }}
        >
          {formatShortTimestamp(timestamp)}
        </span>
      )}
    </div>
  );
});
