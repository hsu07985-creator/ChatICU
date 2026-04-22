import { useMemo } from 'react';
import type { LabData } from '../../lib/api/lab-data';
import { LabItem } from './LabItem';
import {
  INFLAMMATION_META,
  computeAll,
  extractInputTimestamps,
  formatIndex,
  type InflammationInputs,
  type InflammationKey,
} from './inflammation-indices';

interface Props {
  labData: LabData;
}

const INDEX_ORDER: InflammationKey[] = ['NLR', 'PLR', 'SIRI', 'SII'];

function earliestTimestamp(timestamps: Array<string | null>): string | null {
  const valid = timestamps.filter((t): t is string => !!t);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (new Date(a).getTime() < new Date(b).getTime() ? a : b));
}

function formatTimeRange(ts: Record<keyof InflammationInputs, string | null>): string | null {
  const all = Object.values(ts).filter((t): t is string => !!t);
  if (all.length === 0) return null;
  const sorted = [...all].sort();
  const fmt = (s: string) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  };
  const first = fmt(sorted[0]);
  const last = fmt(sorted[sorted.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

export function InflammationIndicesPanel({ labData }: Props) {
  const computed = useMemo(() => computeAll(labData), [labData]);
  const timestamps = useMemo(() => extractInputTimestamps(labData), [labData]);
  const panelTs = earliestTimestamp(Object.values(timestamps)) ?? undefined;
  const timeRangeLabel = formatTimeRange(timestamps);

  const rawItems: Array<{ label: string; value: number | null; unit: string; ts: string | null }> = [
    { label: 'WBC', value: computed.inputs.wbc, unit: '10³/μL', ts: timestamps.wbc },
    { label: 'Segment', value: computed.inputs.segmentPct, unit: '%', ts: timestamps.segmentPct },
    { label: 'Lymph', value: computed.inputs.lymphPct, unit: '%', ts: timestamps.lymphPct },
    { label: 'Mono', value: computed.inputs.monoPct, unit: '%', ts: timestamps.monoPct },
    { label: 'PLT', value: computed.inputs.plt, unit: '10³/μL', ts: timestamps.plt },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">發炎指數</h3>
          {timeRangeLabel && (
            <span className="text-xs text-slate-500 dark:text-slate-400">採樣時間：{timeRangeLabel}</span>
          )}
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}
        >
          {INDEX_ORDER.map((key) => {
            const meta = INFLAMMATION_META[key];
            const result = computed[key];
            const display = formatIndex(result.value, key);
            return (
              <LabItem
                key={key}
                labName={key}
                label={meta.label}
                value={display === '-' ? null : { value: display, _ts: panelTs }}
                unit={meta.unit}
              />
            );
          })}
        </div>
        {INDEX_ORDER.some((k) => computed[k].missing.length > 0) && (
          <ul className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {INDEX_ORDER.map((key) => {
              const miss = computed[key].missing;
              if (miss.length === 0) return null;
              return (
                <li key={key}>
                  <span className="font-semibold">{key}</span> 無法計算：缺 {miss.join('、')}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">原始資料</h4>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}
        >
          {rawItems.map((item) => (
            <LabItem
              key={item.label}
              labName={item.label}
              label={item.label}
              value={item.value === null ? null : { value: item.value, _ts: item.ts ?? undefined }}
              unit={item.unit}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
        <p className="font-semibold text-slate-700 dark:text-slate-200">計算公式</p>
        <ul className="space-y-0.5">
          <li>ANC = WBC × Segment% / 100　　ALC = WBC × Lymph% / 100　　AMC = WBC × Mono% / 100</li>
          {INDEX_ORDER.map((k) => (
            <li key={k}>
              <span className="font-semibold">{INFLAMMATION_META[k].label}</span>（{INFLAMMATION_META[k].fullName}）＝ {INFLAMMATION_META[k].formula}
              {INFLAMMATION_META[k].unit && `，單位 ${INFLAMMATION_META[k].unit}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
