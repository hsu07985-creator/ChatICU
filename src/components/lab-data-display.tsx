import { type LabData } from '../lib/api';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { LabTrendData } from './lab-trend-chart';
import { getLabTrends } from '../lib/api/lab-data';
import {
  groupLabData,
  SECTION_ORDER,
  SECTION_TITLE,
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

const labChineseNames: Record<string, string> = {
  Na: '鈉', K: '鉀', Ca: '鈣', freeCa: '游離鈣', Mg: '鎂',
  Cl: '氯', CO2: '二氧化碳', Phos: '磷',
  WBC: '白血球', RBC: '紅血球', Hb: '血紅素', PLT: '血小板',
  Hct: '血比容', Segment: '嗜中性球', Lymph: '淋巴球', Mono: '單核球', Band: '帶狀嗜中性球',
  Alb: '白蛋白', CRP: 'C反應蛋白', PCT: '降鈣素原',
  DDimer: 'D-二聚體', NSE: '神經元特異性烯醇化酶',
  Ferritin: '鐵蛋白', NH3: '血氨', Amylase: '澱粉酶', Lipase: '脂肪酶',
  pH: '酸鹼值', PCO2: '二氧化碳分壓',
  PO2: '氧分壓', HCO3: '碳酸氫根', Lactate: '乳酸',
  BE: '鹼剩餘', SaO2: '動脈血氧飽和度', SO2C: '靜脈血氧飽和度',
  AST: '天門冬胺酸轉胺酶', ALT: '丙胺酸轉胺酶', TBil: '總膽紅素', DBil: '直接膽紅素', AlkP: '鹼性磷酸酶', rGT: '丙麩氨轉肽酶',
  INR: '國際標準化比值', BUN: '血液尿素氮', Scr: '肌酸酐',
  eGFR: '腎絲球過濾率', Clcr: '肌酸酐清除率',
  Glucose: '血糖', LDH: '乳酸脫氫酶', TnT: '肌鈣蛋白T',
  Uric: '尿酸',
  TSH: '促甲狀腺激素', freeT4: '游離甲狀腺素',
  TCHO: '總膽固醇', TG: '三酸甘油酯', LDLC: '低密度脂蛋白', HDLC: '高密度脂蛋白',
  HbA1C: '糖化血色素', NTproBNP: 'N端腦利鈉肽前體',
  CK: '肌酸激酶', CKMB: '肌酸激酶同工酶',
  PT: '凝血酶原時間', aPTT: '活化部分凝血酶原時間', Fibrinogen: '纖維蛋白原',
};

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

export function LabDataDisplay({ labData, patientId }: LabDataDisplayProps) {
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
          });
        }
      }
      if (trendData.length === 0) {
        trendData.push({
          date: '目前',
          value,
        });
      }

      setSelectedLab({
        name: labName,
        nameChinese: labChineseNames[labName] || labName,
        unit,
        trendData,
        referenceRange: refRange,
      });
    } catch (err) {
      console.error('Failed to load trend data:', err);
      setSelectedLab({
        name: labName,
        nameChinese: labChineseNames[labName] || labName,
        unit,
        trendData: [{ date: '目前', value }],
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
              只看異常
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
              隱藏無資料
            </button>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">高效率篩選</span>
        </div>

        {!hasAnyVisibleSection && (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            目前篩選條件下沒有可顯示的檢驗項目
          </div>
        )}

        {SECTION_ORDER.map((sid: SectionId) => {
          const items: RenderItem[] = sections.get(sid) ?? [];
          if (items.length === 0) return null;
          if (sid === 'other') {
            return (
              <OtherSection
                key={sid}
                title={SECTION_TITLE[sid]}
                items={items}
                labData={labData ?? null}
                onLabClick={handleLabClick}
              />
            );
          }
          return (
            <LabSection
              key={sid}
              title={SECTION_TITLE[sid]}
              items={items}
              labData={labData ?? null}
              onLabClick={handleLabClick}
            />
          );
        })}

        {hasAnyVisibleSection && (
          <div className="flex items-center gap-2 pt-0.5">
            <div className="h-4 w-1 rounded-full bg-red-500"></div>
            <span className="text-[11px] text-muted-foreground">紅框=偏高 • 藍框=偏低 • 點擊=歷史趨勢</span>
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
