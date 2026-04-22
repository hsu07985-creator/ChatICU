/**
 * LabItem card component — copied verbatim from `lab-data-display.tsx` as
 * Step 2 of the lab-display refactor (see `docs/lab-display-refactor-plan.md`).
 *
 * Rendering, styling and prop names are intentionally identical to the old
 * in-file `LabItem`. Step 3 will switch the main file to import from here and
 * delete the local copy. Until then, both copies coexist.
 */

import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// Filter context (mirrors the one declared inside lab-data-display.tsx). Kept
// local to this module so the new component tree is self-contained; Step 3
// will unify the two.
// ---------------------------------------------------------------------------

export interface LabFilterState {
  onlyAbnormal: boolean;
  hideMissing: boolean;
  timestamp?: string;
}

export const LabDisplayFilterContext = createContext<LabFilterState>({
  onlyAbnormal: false,
  hideMissing: false,
});

// ---------------------------------------------------------------------------
// Private helpers used only by LabItem (copied verbatim).
// ---------------------------------------------------------------------------

function toDisplayText(input: unknown): string {
  if (input === null || input === undefined) {
    return '-';
  }

  if (typeof input === 'number') {
    return Number.isFinite(input) ? String(input) : '-';
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed === '' ? '-' : trimmed;
  }

  if (input && typeof input === 'object' && 'value' in input) {
    return toDisplayText((input as { value?: unknown }).value);
  }

  return '-';
}

function getItemTimestamp(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  if (typeof record._ts === 'string') return record._ts;
  return undefined;
}

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

// ---------------------------------------------------------------------------
// LabItem component (prop shape identical to the old one).
// ---------------------------------------------------------------------------

export interface LabItemProps {
  labName: string;
  label: string;
  value: unknown;
  unit: string;
  isAbnormal?: boolean;
  abnormalDirection?: 'high' | 'low' | 'normal';
  onClick?: () => void;
  isOptional?: boolean;
}

export function LabItem({ labName, label, value, unit, isAbnormal, abnormalDirection, onClick, isOptional }: LabItemProps) {
  // `labName` kept for API parity with the old implementation; not currently rendered.
  void labName;
  const { hideMissing, onlyAbnormal, timestamp } = useContext(LabDisplayFilterContext);
  const displayValue = toDisplayText(value);
  const hasValue = displayValue !== '-';
  const itemTimestamp = getItemTimestamp(value) || timestamp;
  const canOpenTrend = hasValue && !!onClick;
  const isMissing = !hasValue;
  const valueToneClass = isMissing
    ? 'font-medium text-slate-400 dark:text-slate-500'
    : isAbnormal
      ? abnormalDirection === 'low'
        ? 'font-semibold text-blue-600'
        : 'font-semibold text-red-600'
      : 'font-semibold text-slate-900 dark:text-slate-100';

  if (hideMissing && isMissing) {
    return null;
  }

  if (onlyAbnormal && !isAbnormal) {
    return null;
  }

  return (
    <div
      className={`group relative flex aspect-square flex-col rounded-xl border px-2.5 py-2 ${
        isOptional ? 'border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/70 dark:border-amber-700/60 dark:from-amber-950/40 dark:to-orange-950/30' : 'border-slate-200 dark:border-slate-700 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800'
      } ${
        isAbnormal
          ? abnormalDirection === 'low'
            ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-sky-50/70 dark:border-blue-500 dark:from-blue-950/40 dark:to-sky-950/30'
            : 'border-red-400 bg-gradient-to-br from-red-50 to-rose-50/70 dark:border-red-500 dark:from-red-950/40 dark:to-rose-950/30'
          : ''
      } ${
        canOpenTrend ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-sm' : ''
      }`}
      onClick={canOpenTrend ? onClick : undefined}
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
          className={`leading-tight tracking-tight break-words ${valueToneClass}`}
          style={{
            fontSize: (() => {
              const len = displayValue.length;
              const isNumeric = /^-?\d+(?:\.\d+)?[+\-]?$/.test(displayValue.trim());
              if (len >= 10) return '0.7rem';
              if (len >= 7) return '0.8rem';
              if (!isNumeric) return '0.88rem';
              return 'calc(var(--metric-card-value-size) + 0.15rem)';
            })(),
          }}
        >
          {displayValue}
        </span>
        {unit && (
          <span
            className={`mt-0.5 max-w-full break-words leading-tight ${isMissing ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}
            style={{ fontSize: 'calc(var(--metric-card-unit-size) + 0.12rem)' }}
          >
            {unit}
          </span>
        )}
      </div>
      {itemTimestamp && (
        <span
          className="mt-auto text-center leading-none text-slate-400 dark:text-slate-500"
          style={{ fontSize: '0.55rem' }}
        >
          {formatShortTimestamp(itemTimestamp)}
        </span>
      )}
    </div>
  );
}
