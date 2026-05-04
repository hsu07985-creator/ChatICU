import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LabData } from '../../lib/api/lab-data';
import { getLabTrends } from '../../lib/api/lab-data';
import { LabItem } from './LabItem';
import {
  INFLAMMATION_META,
  computeAll,
  extractInputTimestamps,
  formatIndex,
  type InflammationInputs,
  type InflammationKey,
} from './inflammation-indices';

const LabTrendChart = lazy(() =>
  import('../lab-trend-chart').then((m) => ({ default: m.LabTrendChart }))
);

interface Props {
  labData: LabData;
  patientId?: string;
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

export function InflammationIndicesPanel({ labData, patientId }: Props) {
  const { t } = useTranslation('labs');
  const computed = useMemo(() => computeAll(labData), [labData]);
  const timestamps = useMemo(() => extractInputTimestamps(labData), [labData]);
  const panelTs = earliestTimestamp(Object.values(timestamps)) ?? undefined;
  const timeRangeLabel = formatTimeRange(timestamps);
  const [selectedTrend, setSelectedTrend] = useState<{
    key: InflammationKey;
    trendData: Array<{ date: string; value: number }>;
  } | null>(null);

  const handleOpenTrend = async (key: InflammationKey) => {
    const fallbackTrendData =
      computed[key].value !== null
        ? [{ date: panelTs ?? labData.timestamp ?? '目前', value: computed[key].value }]
        : [];

    setSelectedTrend({ key, trendData: fallbackTrendData });

    if (!patientId) {
      return;
    }

    try {
      const response = await getLabTrends(patientId, { category: 'hematology' });
      const trendData = response.trends
        .map((snapshot) => {
          const snapshotComputed = computeAll(snapshot as LabData);
          const value = snapshotComputed[key].value;
          if (value === null || !snapshot.timestamp) {
            return null;
          }
          return {
            date: snapshot.timestamp,
            value,
          };
        })
        .filter((point): point is { date: string; value: number } => point !== null);

      setSelectedTrend({
        key,
        trendData: trendData.length > 0 ? trendData : fallbackTrendData,
      });
    } catch (error) {
      console.error(`Failed to load ${key} trend data:`, error);
    }
  };

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
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('inflammation.panelTitle')}</h3>
          {timeRangeLabel && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('inflammation.samplingTime', { range: timeRangeLabel })}</span>
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
                onClick={display === '-' ? undefined : () => void handleOpenTrend(key)}
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
                  <span className="font-semibold">{key}</span> {t('inflammation.missingPrefix', { fields: miss.join('、') })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('inflammation.rawDataTitle')}</h4>
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
        <p className="font-semibold text-slate-700 dark:text-slate-200">{t('inflammation.formulaTitle')}</p>
        <ul className="space-y-0.5">
          <li>{t('inflammation.absoluteCounts')}</li>
          {INDEX_ORDER.map((k) => (
            <li key={k}>
              <span className="font-semibold">{INFLAMMATION_META[k].label}</span>
              {t('inflammation.formulaLine', { fullName: INFLAMMATION_META[k].fullName, formula: INFLAMMATION_META[k].formula })}
              {INFLAMMATION_META[k].unit && t('inflammation.formulaUnitSuffix', { unit: INFLAMMATION_META[k].unit })}
            </li>
          ))}
        </ul>
      </section>

      {selectedTrend && (
        <Suspense fallback={null}>
          <LabTrendChart
            isOpen={true}
            onClose={() => setSelectedTrend(null)}
            labName={selectedTrend.key}
            labNameChinese={INFLAMMATION_META[selectedTrend.key].fullName}
            unit={INFLAMMATION_META[selectedTrend.key].unit}
            trendData={selectedTrend.trendData}
            valueDecimals={2}
          />
        </Suspense>
      )}
    </div>
  );
}
