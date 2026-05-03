import { type LabData } from '../lib/api';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LabTrendData } from './lab-trend-chart';
import { getLabTrends } from '../lib/api/lab-data';
import {
  groupLabData,
  SECTION_ORDER,
  SECTION_META,
  type RenderItem,
  type SectionId,
} from './lab-data-display/sections';
import { LabSection } from './lab-data-display/LabSection';
import { OtherSection } from './lab-data-display/OtherSection';
import { LabDisplayFilterContext } from './lab-data-display/LabItem';
import { getValue } from './lab-data-display/helpers';

// Lazy-load recharts-backed trend chart (H4: keep 411 KB charts-*.js off the critical path)
const LabTrendChart = lazy(() =>
  import('./lab-trend-chart').then((m) => ({ default: m.LabTrendChart }))
);

interface LabDataDisplayProps {
  labData: LabData | undefined;
  patientId?: string;
}

function toFiniteNumber(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  if (typeof input === 'string' && input.trim() !== '') {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (input && typeof input === 'object' && 'value' in input) {
    return toFiniteNumber((input as { value?: unknown }).value);
  }

  return undefined;
}

function getTrendPointMeta(input: unknown): Pick<LabTrendData, 'scrValue' | 'weightUsed' | 'weightTimestamp' | 'weightSource'> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const record = input as Record<string, unknown>;
  return {
    scrValue: toFiniteNumber(record.scrValue),
    weightUsed: toFiniteNumber(record.weightUsed),
    weightTimestamp: typeof record.weightTimestamp === 'string' ? record.weightTimestamp : undefined,
    weightSource: typeof record.weightSource === 'string' ? record.weightSource : undefined,
  };
}

export function LabDataDisplay({ labData, patientId }: LabDataDisplayProps) {
  const { t } = useTranslation('labs');
  const [selectedLab, setSelectedLab] = useState<{
    name: string;
    nameChinese: string;
    unit: string;
    trendData: LabTrendData[];
    referenceRange?: string;
  } | null>(null);
  const [, setTrendLoading] = useState(false);
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [hideMissing, setHideMissing] = useState(false);

  // Resolve a lab key (e.g. "Na") to its localised label, falling back to the
  // raw key when the dictionary doesn't list it.
  const labLabel = (key: string): string => t(`fields.${key}`, { defaultValue: key });

  // Data-driven grouping: replaces the old hand-written metric whitelists.
  const sections = useMemo(
    () => groupLabData(labData ?? null),
    [labData],
  );

  // A section counts as "visible" if any of its items has a real numeric value.
  // Used to decide whether to render the legend / empty-state banner.
  const hasAnyVisibleSection = useMemo(() => {
    for (const items of sections.values()) {
      for (const item of items) {
        if (getValue(labData ?? null, item.category, item.itemName) !== undefined) {
          return true;
        }
      }
    }
    return false;
  }, [sections, labData]);

  const handleLabClick = async (
    labName: string,
    category: string,
    value: number | undefined,
    unit: string,
    refRange?: string,
  ) => {
    if (value === undefined || !patientId) return;

    setTrendLoading(true);
    try {
      const response = await getLabTrends(patientId, { category, item: labName });
      const trendData: LabTrendData[] = [];
      const snapshots = response.trends || [];
      for (const snapshot of snapshots) {
        const categoryData = (snapshot as unknown as Record<string, unknown>)[category];
        const labItem = categoryData && typeof categoryData === 'object'
          ? (categoryData as unknown as Record<string, unknown>)[labName]
          : undefined;
        const trendValue = toFiniteNumber(labItem);
        if (trendValue !== undefined) {
          trendData.push({
            date: snapshot.timestamp,
            value: trendValue,
            ...getTrendPointMeta(labItem),
          });
        }
      }
      if (trendData.length === 0) {
        trendData.push({
          date: t('display.currentLabel'),
          value,
        });
      }

      setSelectedLab({
        name: labName,
        nameChinese: labLabel(labName),
        unit,
        trendData,
        referenceRange: refRange,
      });
    } catch (err) {
      console.error(t('display.loadTrendErrorLog'), err);
      setSelectedLab({
        name: labName,
        nameChinese: labLabel(labName),
        unit,
        trendData: [{ date: t('display.currentLabel'), value }],
        referenceRange: refRange,
      });
    } finally {
      setTrendLoading(false);
    }
  };

  return (
    <>
      <LabDisplayFilterContext.Provider value={{ onlyAbnormal, hideMissing, timestamp: labData?.timestamp }}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                onlyAbnormal
                  ? 'border-brand bg-brand text-white'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-brand/40'
              }`}
              aria-pressed={onlyAbnormal}
              onClick={() => setOnlyAbnormal((prev) => !prev)}
            >
              {t('display.filterAbnormal')}
            </button>
            <button
              type="button"
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                hideMissing
                  ? 'border-brand bg-brand text-white'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-brand/40'
              }`}
              aria-pressed={hideMissing}
              onClick={() => setHideMissing((prev) => !prev)}
            >
              {t('display.filterHideMissing')}
            </button>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">{t('display.filterEfficiency')}</span>
        </div>

        {!hasAnyVisibleSection && (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('display.noVisibleItems')}
          </div>
        )}

        {SECTION_ORDER.map((sid: SectionId) => {
          const items: RenderItem[] = sections.get(sid) ?? [];
          if (items.length === 0) return null;
          const meta = SECTION_META[sid];
          if (sid === 'other') {
            return (
              <OtherSection
                key={sid}
                title={meta.title}
                items={items}
                labData={labData ?? null}
                onLabClick={handleLabClick}
              />
            );
          }
          return (
            <LabSection
              key={sid}
              title={meta.title}
              subtitle={meta.subtitle}
              variant={meta.variant}
              items={items}
              labData={labData ?? null}
              onLabClick={handleLabClick}
            />
          );
        })}

        {hasAnyVisibleSection && (
          <div className="flex items-center gap-2 pt-0.5">
            <div className="h-4 w-1 rounded-full bg-red-500"></div>
            <span className="text-[11px] text-muted-foreground">{t('display.legend')}</span>
          </div>
        )}
      </div>
      </LabDisplayFilterContext.Provider>

      {selectedLab && (
        <Suspense fallback={null}>
          <LabTrendChart
            isOpen={true}
            onClose={() => setSelectedLab(null)}
            labName={selectedLab.name}
            labNameChinese={selectedLab.nameChinese}
            unit={selectedLab.unit}
            trendData={selectedLab.trendData}
            referenceRange={selectedLab.referenceRange}
          />
        </Suspense>
      )}
    </>
  );
}
