import { type LabData } from '../lib/api';
import { createContext, useContext, useState } from 'react';
import { LabTrendChart, type LabTrendData } from './lab-trend-chart';
import { getLabTrends } from '../lib/api/lab-data';

const labChineseNames: Record<string, string> = {
  Na: '鈉', K: '鉀', Ca: '鈣', freeCa: '游離鈣', Mg: '鎂',
  Cl: '氯', CO2: '二氧化碳', Phos: '磷',
  WBC: '白血球', RBC: '紅血球', Hb: '血紅素', PLT: '血小板',
  Hct: '血比容', Segment: '嗜中性球', Lymph: '淋巴球', Mono: '單核球', Band: '帶狀嗜中性球',
  Alb: '白蛋白', CRP: 'C反應蛋白', PCT: '降鈣素原',
  DDimer: 'D-二聚體', 'IL-6': '介白素-6', NSE: '神經元特異性烯醇化酶',
  pH: '酸鹼值', PCO2: '二氧化碳分壓',
  PO2: '氧分壓', HCO3: '碳酸氫根', Lactate: '乳酸',
  BE: '鹼剩餘', SaO2: '動脈血氧飽和度',
  AST: '天門冬胺酸轉胺酶', ALT: '丙胺酸轉胺酶', TBil: '總膽紅素', DBil: '直接膽紅素',
  INR: '國際標準化比值', BUN: '血液尿素氮', Scr: '肌酸酐',
  eGFR: '腎絲球過濾率', Clcr: '肌酸酐清除率',
  Glucose: '血糖', LDH: '乳酸脫氫酶', 'Troponin-I': '肌鈣蛋白I',
  Uric: '尿酸', Osmolality: '滲透壓',
  PT: '凝血酶原時間', aPTT: '活化部分凝血酶原時間', Fibrinogen: '纖維蛋白原',
};

interface LabDataDisplayProps {
  labData: LabData | undefined;
  patientId?: string;
}

type LabMetricDescriptor = {
  category: keyof LabData;
  itemName: string;
};

interface LabItemProps {
  labName: string;
  label: string;
  value: unknown;
  unit: string;
  isAbnormal?: boolean;
  abnormalDirection?: 'high' | 'low' | 'normal';
  onClick?: () => void;
  isOptional?: boolean;
}

interface LabFilterState {
  onlyAbnormal: boolean;
  hideMissing: boolean;
  timestamp?: string;
}

const LabDisplayFilterContext = createContext<LabFilterState>({
  onlyAbnormal: false,
  hideMissing: false,
});

const ELECTROLYTES_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'biochemistry', itemName: 'Na' },
  { category: 'biochemistry', itemName: 'K' },
  { category: 'biochemistry', itemName: 'Ca' },
  { category: 'biochemistry', itemName: 'freeCa' },
  { category: 'biochemistry', itemName: 'Mg' },
  { category: 'biochemistry', itemName: 'Cl' },
  { category: 'biochemistry', itemName: 'Phos' },
];

const HEMATOLOGY_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'hematology', itemName: 'WBC' },
  { category: 'hematology', itemName: 'RBC' },
  { category: 'hematology', itemName: 'Hb' },
  { category: 'hematology', itemName: 'Hct' },
  { category: 'hematology', itemName: 'PLT' },
  { category: 'hematology', itemName: 'Segment' },
  { category: 'hematology', itemName: 'Lymph' },
  { category: 'hematology', itemName: 'Mono' },
  { category: 'hematology', itemName: 'Band' },
];

const INFLAMMATORY_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'biochemistry', itemName: 'Alb' },
  { category: 'bloodGas', itemName: 'Lactate' },
  { category: 'inflammatory', itemName: 'CRP' },
  { category: 'inflammatory', itemName: 'PCT' },
  { category: 'coagulation', itemName: 'DDimer' },
  { category: 'inflammatory', itemName: 'IL-6' },
];

const ABG_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'bloodGas', itemName: 'pH' },
  { category: 'bloodGas', itemName: 'PCO2' },
  { category: 'bloodGas', itemName: 'PO2' },
  { category: 'bloodGas', itemName: 'HCO3' },
  { category: 'bloodGas', itemName: 'BE' },
  { category: 'bloodGas', itemName: 'SaO2' },
];

const LIVER_RENAL_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'biochemistry', itemName: 'AST' },
  { category: 'biochemistry', itemName: 'ALT' },
  { category: 'biochemistry', itemName: 'TBil' },
  { category: 'biochemistry', itemName: 'DBil' },
  { category: 'coagulation', itemName: 'INR' },
  { category: 'biochemistry', itemName: 'BUN' },
  { category: 'biochemistry', itemName: 'Scr' },
  { category: 'biochemistry', itemName: 'eGFR' },
  { category: 'biochemistry', itemName: 'Clcr' },
];

const COAGULATION_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'coagulation', itemName: 'PT' },
  { category: 'coagulation', itemName: 'aPTT' },
  { category: 'coagulation', itemName: 'Fibrinogen' },
];

const BIOCHEM_EXTRA_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'biochemistry', itemName: 'Glucose' },
  { category: 'biochemistry', itemName: 'LDH' },
  { category: 'biochemistry', itemName: 'Troponin-I' },
  { category: 'biochemistry', itemName: 'Uric' },
  { category: 'biochemistry', itemName: 'Osmolality' },
];

const CARDIAC_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'cardiac', itemName: 'TnT' },
  { category: 'cardiac', itemName: 'CKMB' },
  { category: 'cardiac', itemName: 'CK' },
  { category: 'cardiac', itemName: 'NTproBNP' },
];

const LIPID_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'lipid', itemName: 'TCHO' },
  { category: 'lipid', itemName: 'TG' },
  { category: 'lipid', itemName: 'LDLC' },
  { category: 'lipid', itemName: 'HDLC' },
  { category: 'lipid', itemName: 'UA' },
  { category: 'lipid', itemName: 'P' },
];

const OTHER_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'other', itemName: 'HbA1C' },
  { category: 'other', itemName: 'LDH' },
  { category: 'other', itemName: 'NH3' },
  { category: 'other', itemName: 'Amylase' },
  { category: 'other', itemName: 'Lipase' },
];

const THYROID_HORMONE_METRICS: readonly LabMetricDescriptor[] = [
  { category: 'thyroid', itemName: 'TSH' },
  { category: 'thyroid', itemName: 'freeT4' },
  { category: 'hormone', itemName: 'Cortisol' },
];

const compactGridClass = 'grid';
const compactGridStyle = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(var(--metric-card-size, 124px), var(--metric-card-size, 124px)))',
  gap: 'var(--metric-card-gap, 10px)',
  justifyContent: 'start',
} as const;

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

function getUnitFromItem(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  if (typeof record.unit === 'string' && record.unit.trim() !== '') {
    return record.unit;
  }

  if ('value' in record) {
    return getUnitFromItem(record.value);
  }

  return undefined;
}

function getAbnormalFlag(input: unknown): boolean {
  if (!input || typeof input !== 'object') {
    return false;
  }

  const record = input as Record<string, unknown>;
  if (typeof record.isAbnormal === 'boolean') {
    return record.isAbnormal;
  }

  if ('value' in record) {
    return getAbnormalFlag(record.value);
  }

  return false;
}

function getReferenceRange(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  if (typeof record.referenceRange === 'string' && record.referenceRange.trim() !== '') {
    return record.referenceRange;
  }
  if ('value' in record) return getReferenceRange(record.value);
  return undefined;
}

/** 判斷值相對於 referenceRange 的方向: 'high' | 'low' | 'normal' */
function getAbnormalDirection(
  value: number | undefined,
  referenceRange: string | undefined,
  isAbnormal: boolean,
): 'high' | 'low' | 'normal' {
  if (!isAbnormal || value === undefined) return 'normal';
  if (!referenceRange) return 'high'; // 預設偏高

  const trimmed = referenceRange.trim();

  // "<5" 格式 → 超過上限 = high
  const ltMatch = trimmed.match(/^<\s*([\d.]+)/);
  if (ltMatch) {
    return value >= parseFloat(ltMatch[1]) ? 'high' : 'normal';
  }

  // ">60" 格式 → 低於下限 = low
  const gtMatch = trimmed.match(/^>\s*([\d.]+)/);
  if (gtMatch) {
    return value <= parseFloat(gtMatch[1]) ? 'low' : 'normal';
  }

  // "3.5-5.0" 格式
  const rangeMatch = trimmed.match(/^([\d.]+)\s*[-–~]\s*([\d.]+)/);
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1]);
    const high = parseFloat(rangeMatch[2]);
    if (value < low) return 'low';
    if (value > high) return 'high';
    return 'normal';
  }

  return 'high'; // fallback
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

function LabItem({ labName, label, value, unit, isAbnormal, abnormalDirection, onClick, isOptional }: LabItemProps) {
  const { hideMissing, onlyAbnormal, timestamp } = useContext(LabDisplayFilterContext);
  const displayValue = toDisplayText(value);
  const hasValue = displayValue !== '-';
  const canOpenTrend = hasValue && !!onClick;
  const isMissing = !hasValue;
  const valueToneClass = isMissing
    ? 'font-medium text-slate-400'
    : isAbnormal
      ? abnormalDirection === 'low'
        ? 'font-semibold text-blue-600'
        : 'font-semibold text-red-600'
      : 'font-semibold text-slate-900';

  if (hideMissing && isMissing) {
    return null;
  }

  if (onlyAbnormal && !isAbnormal) {
    return null;
  }

  return (
    <div
      className={`group relative flex aspect-square flex-col rounded-xl border px-2.5 py-2 ${
        isOptional ? 'border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/70' : 'border-slate-200 bg-gradient-to-br from-white to-slate-50'
      } ${
        isAbnormal
          ? abnormalDirection === 'low'
            ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-sky-50/70'
            : 'border-red-400 bg-gradient-to-br from-red-50 to-rose-50/70'
          : ''
      } ${
        canOpenTrend ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-sm' : ''
      }`}
      onClick={canOpenTrend ? onClick : undefined}
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
            className={`mt-0.5 max-w-full break-words leading-tight ${isMissing ? 'text-slate-400' : 'text-slate-500'}`}
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

export function LabDataDisplay({ labData, patientId }: LabDataDisplayProps) {
  const [selectedLab, setSelectedLab] = useState<{
    name: string;
    nameChinese: string;
    unit: string;
    trendData: LabTrendData[];
  } | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [hideMissing, setHideMissing] = useState(false);

  // 輔助函數：從類別和項目名稱取得 LabItem
  const getItem = (category: keyof LabData | undefined, itemName: string): unknown => {
    if (!labData || !category) return undefined;
    const cat = labData[category];
    if (!cat || typeof cat !== 'object') return undefined;
    return (cat as unknown as Record<string, unknown>)[itemName];
  };

  // 輔助函數：取得數值
  const getValue = (category: keyof LabData, itemName: string): number | undefined => {
    const item = getItem(category, itemName);
    return toFiniteNumber(item);
  };

  // 輔助函數：取得單位
  const getUnit = (category: keyof LabData, itemName: string, defaultUnit: string): string => {
    const item = getItem(category, itemName);
    return getUnitFromItem(item) || defaultUnit;
  };

  // 輔助函數：檢查是否異常
  const isAbnormal = (category: keyof LabData, itemName: string): boolean => {
    const item = getItem(category, itemName);
    return getAbnormalFlag(item);
  };

  // 輔助函數：取得異常方向
  const getDirection = (category: keyof LabData, itemName: string): 'high' | 'low' | 'normal' => {
    const item = getItem(category, itemName);
    const val = toFiniteNumber(item);
    const ref = getReferenceRange(item);
    const abnormal = getAbnormalFlag(item);
    return getAbnormalDirection(val, ref, abnormal);
  };

  const hasVisibleMetrics = (
    metrics: readonly LabMetricDescriptor[],
    options?: { requireValue?: boolean },
  ): boolean => {
    return metrics.some(({ category, itemName }) => {
      const value = getValue(category, itemName);
      const abnormal = isAbnormal(category, itemName);

      if (options?.requireValue && value === undefined) {
        return false;
      }
      if (hideMissing && value === undefined) {
        return false;
      }
      if (onlyAbnormal && !abnormal) {
        return false;
      }
      return true;
    });
  };

  const showElectrolytes = hasVisibleMetrics(ELECTROLYTES_METRICS);
  const showHematology = hasVisibleMetrics(HEMATOLOGY_METRICS);
  const showInflammatory = hasVisibleMetrics(INFLAMMATORY_METRICS);
  const showAbg = hasVisibleMetrics(ABG_METRICS);
  const showLiverRenal = hasVisibleMetrics(LIVER_RENAL_METRICS);
  const showCoagulation = hasVisibleMetrics(COAGULATION_METRICS);
  const showBiochemExtra = hasVisibleMetrics(BIOCHEM_EXTRA_METRICS);
  const showCardiac = Boolean(labData?.cardiac && Object.keys(labData.cardiac).length > 0) && hasVisibleMetrics(CARDIAC_METRICS, { requireValue: true });
  const showLipid = Boolean(labData?.lipid && Object.keys(labData.lipid).length > 0) && hasVisibleMetrics(LIPID_METRICS, { requireValue: true });
  const showOther = Boolean(labData?.other && Object.keys(labData.other).length > 0) && hasVisibleMetrics(OTHER_METRICS, { requireValue: true });
  const showThyroidHormone = Boolean(((labData?.thyroid && Object.keys(labData.thyroid).length > 0) || (labData?.hormone && Object.keys(labData.hormone).length > 0)) && hasVisibleMetrics(THYROID_HORMONE_METRICS, { requireValue: true }));
  const hasAnyVisibleSection = showElectrolytes || showHematology || showInflammatory || showAbg || showLiverRenal || showCoagulation || showBiochemExtra || showCardiac || showLipid || showOther || showThyroidHormone;

  const handleLabClick = async (labName: string, category: string, value: number | undefined, unit: string) => {
    if (value === undefined || !patientId) return;

    setTrendLoading(true);
    try {
      const response = await getLabTrends(patientId, { days: 7 });
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
      });
    } catch (err) {
      console.error('Failed to load trend data:', err);
      setSelectedLab({
        name: labName,
        nameChinese: labChineseNames[labName] || labName,
        unit,
        trendData: [{ date: '目前', value }],
      });
    } finally {
      setTrendLoading(false);
    }
  };

  return (
    <>
      <LabDisplayFilterContext.Provider value={{ onlyAbnormal, hideMissing, timestamp: labData?.timestamp }}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                onlyAbnormal
                  ? 'border-brand bg-brand text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-brand/40'
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
                  : 'border-slate-300 bg-white text-slate-700 hover:border-brand/40'
              }`}
              aria-pressed={hideMissing}
              onClick={() => setHideMissing((prev) => !prev)}
            >
              隱藏無資料
            </button>
          </div>
          <span className="text-xs text-slate-500">高效率篩選</span>
        </div>

        {!hasAnyVisibleSection && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            目前篩選條件下沒有可顯示的檢驗項目
          </div>
        )}

        {/* 固定追蹤項目 - 電解質 */}
        <div className={showElectrolytes ? 'space-y-2' : 'hidden'}>
          <h3 className="text-xs font-semibold tracking-wide text-brand">電解質與礦物質</h3>
          <div className={compactGridClass} style={compactGridStyle}>
            <LabItem
              labName="Na"
              label="Na"
              value={getValue('biochemistry', 'Na')}
              unit={getUnit('biochemistry', 'Na', 'mEq/L')}
              isAbnormal={isAbnormal('biochemistry', 'Na')}
              abnormalDirection={getDirection('biochemistry', 'Na')}
              onClick={() => handleLabClick('Na', 'biochemistry', getValue('biochemistry', 'Na'), getUnit('biochemistry', 'Na', 'mEq/L'))}
            />
            <LabItem
              labName="K"
              label="K"
              value={getValue('biochemistry', 'K')}
              unit={getUnit('biochemistry', 'K', 'mEq/L')}
              isAbnormal={isAbnormal('biochemistry', 'K')}
              abnormalDirection={getDirection('biochemistry', 'K')}
              onClick={() => handleLabClick('K', 'biochemistry', getValue('biochemistry', 'K'), getUnit('biochemistry', 'K', 'mEq/L'))}
            />
            <LabItem
              labName="Ca"
              label="Ca"
              value={getValue('biochemistry', 'Ca')}
              unit={getUnit('biochemistry', 'Ca', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Ca')}
              abnormalDirection={getDirection('biochemistry', 'Ca')}
              onClick={() => handleLabClick('Ca', 'biochemistry', getValue('biochemistry', 'Ca'), getUnit('biochemistry', 'Ca', 'mg/dL'))}
            />
            <LabItem
              labName="freeCa"
              label="free Ca"
              value={getValue('biochemistry', 'freeCa')}
              unit={getUnit('biochemistry', 'freeCa', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'freeCa')}
              abnormalDirection={getDirection('biochemistry', 'freeCa')}
              onClick={() => handleLabClick('freeCa', 'biochemistry', getValue('biochemistry', 'freeCa'), getUnit('biochemistry', 'freeCa', 'mg/dL'))}
            />
            <LabItem
              labName="Mg"
              label="Mg"
              value={getValue('biochemistry', 'Mg')}
              unit={getUnit('biochemistry', 'Mg', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Mg')}
              abnormalDirection={getDirection('biochemistry', 'Mg')}
              onClick={() => handleLabClick('Mg', 'biochemistry', getValue('biochemistry', 'Mg'), getUnit('biochemistry', 'Mg', 'mg/dL'))}
            />
            <LabItem
              labName="Cl"
              label="Cl"
              value={getValue('biochemistry', 'Cl')}
              unit={getUnit('biochemistry', 'Cl', 'mmol/L')}
              isAbnormal={isAbnormal('biochemistry', 'Cl')}
              abnormalDirection={getDirection('biochemistry', 'Cl')}
              onClick={() => handleLabClick('Cl', 'biochemistry', getValue('biochemistry', 'Cl'), getUnit('biochemistry', 'Cl', 'mmol/L'))}
            />
            <LabItem
              labName="Phos"
              label="P"
              value={getValue('biochemistry', 'Phos')}
              unit={getUnit('biochemistry', 'Phos', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Phos')}
              abnormalDirection={getDirection('biochemistry', 'Phos')}
              onClick={() => handleLabClick('Phos', 'biochemistry', getValue('biochemistry', 'Phos'), getUnit('biochemistry', 'Phos', 'mg/dL'))}
            />
          </div>
        </div>

        {/* 血液學檢查 */}
        <div className={showHematology ? 'space-y-2' : 'hidden'}>
          <h3 className="text-xs font-semibold tracking-wide text-brand">血液學檢查</h3>
          <div className={compactGridClass} style={compactGridStyle}>
            <LabItem
              labName="WBC"
              label="WBC"
              value={getValue('hematology', 'WBC')}
              unit={getUnit('hematology', 'WBC', '10³/μL')}
              isAbnormal={isAbnormal('hematology', 'WBC')}
              abnormalDirection={getDirection('hematology', 'WBC')}
              onClick={() => handleLabClick('WBC', 'hematology', getValue('hematology', 'WBC'), getUnit('hematology', 'WBC', '10³/μL'))}
            />
            <LabItem
              labName="RBC"
              label="RBC"
              value={getValue('hematology', 'RBC')}
              unit={getUnit('hematology', 'RBC', '10⁶/μL')}
              isAbnormal={isAbnormal('hematology', 'RBC')}
              abnormalDirection={getDirection('hematology', 'RBC')}
              onClick={() => handleLabClick('RBC', 'hematology', getValue('hematology', 'RBC'), getUnit('hematology', 'RBC', '10⁶/μL'))}
            />
            <LabItem
              labName="Hb"
              label="Hb"
              value={getValue('hematology', 'Hb')}
              unit={getUnit('hematology', 'Hb', 'g/dL')}
              isAbnormal={isAbnormal('hematology', 'Hb')}
              abnormalDirection={getDirection('hematology', 'Hb')}
              onClick={() => handleLabClick('Hb', 'hematology', getValue('hematology', 'Hb'), getUnit('hematology', 'Hb', 'g/dL'))}
            />
            <LabItem
              labName="Hct"
              label="Hct"
              value={getValue('hematology', 'Hct')}
              unit={getUnit('hematology', 'Hct', '%')}
              isAbnormal={isAbnormal('hematology', 'Hct')}
              abnormalDirection={getDirection('hematology', 'Hct')}
              onClick={() => handleLabClick('Hct', 'hematology', getValue('hematology', 'Hct'), getUnit('hematology', 'Hct', '%'))}
            />
            <LabItem
              labName="PLT"
              label="PLT"
              value={getValue('hematology', 'PLT')}
              unit={getUnit('hematology', 'PLT', '10³/μL')}
              isAbnormal={isAbnormal('hematology', 'PLT')}
              abnormalDirection={getDirection('hematology', 'PLT')}
              onClick={() => handleLabClick('PLT', 'hematology', getValue('hematology', 'PLT'), getUnit('hematology', 'PLT', '10³/μL'))}
            />
            <LabItem
              labName="Segment"
              label="Seg"
              value={getValue('hematology', 'Segment')}
              unit={getUnit('hematology', 'Segment', '%')}
              isAbnormal={isAbnormal('hematology', 'Segment')}
              abnormalDirection={getDirection('hematology', 'Segment')}
              onClick={() => handleLabClick('Segment', 'hematology', getValue('hematology', 'Segment'), getUnit('hematology', 'Segment', '%'))}
            />
            <LabItem
              labName="Lymph"
              label="Lymph"
              value={getValue('hematology', 'Lymph')}
              unit={getUnit('hematology', 'Lymph', '%')}
              isAbnormal={isAbnormal('hematology', 'Lymph')}
              abnormalDirection={getDirection('hematology', 'Lymph')}
              onClick={() => handleLabClick('Lymph', 'hematology', getValue('hematology', 'Lymph'), getUnit('hematology', 'Lymph', '%'))}
            />
            <LabItem
              labName="Mono"
              label="Mono"
              value={getValue('hematology', 'Mono')}
              unit={getUnit('hematology', 'Mono', '%')}
              isAbnormal={isAbnormal('hematology', 'Mono')}
              abnormalDirection={getDirection('hematology', 'Mono')}
              onClick={() => handleLabClick('Mono', 'hematology', getValue('hematology', 'Mono'), getUnit('hematology', 'Mono', '%'))}
            />
            <LabItem
              labName="Band"
              label="Band"
              value={getValue('hematology', 'Band')}
              unit={getUnit('hematology', 'Band', '%')}
              isAbnormal={isAbnormal('hematology', 'Band')}
              abnormalDirection={getDirection('hematology', 'Band')}
              onClick={() => handleLabClick('Band', 'hematology', getValue('hematology', 'Band'), getUnit('hematology', 'Band', '%'))}
            />
          </div>
        </div>

        {/* 生化與炎症指標 */}
        <div className={showInflammatory ? 'space-y-2' : 'hidden'}>
          <h3 className="text-xs font-semibold tracking-wide text-brand">生化與炎症指標</h3>
          <div className={compactGridClass} style={compactGridStyle}>
            <LabItem
              labName="Alb"
              label="Alb"
              value={getValue('biochemistry', 'Alb')}
              unit={getUnit('biochemistry', 'Alb', 'g/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Alb')}
              abnormalDirection={getDirection('biochemistry', 'Alb')}
              onClick={() => handleLabClick('Alb', 'biochemistry', getValue('biochemistry', 'Alb'), getUnit('biochemistry', 'Alb', 'g/dL'))}
            />
            <LabItem
              labName="Lactate"
              label="Lactate"
              value={getValue('bloodGas', 'Lactate')}
              unit={getUnit('bloodGas', 'Lactate', 'mmol/L')}
              isAbnormal={isAbnormal('bloodGas', 'Lactate')}
              abnormalDirection={getDirection('bloodGas', 'Lactate')}
              onClick={() => handleLabClick('Lactate', 'bloodGas', getValue('bloodGas', 'Lactate'), getUnit('bloodGas', 'Lactate', 'mmol/L'))}
            />
            <LabItem
              labName="CRP"
              label="CRP"
              value={getValue('inflammatory', 'CRP')}
              unit={getUnit('inflammatory', 'CRP', 'mg/L')}
              isAbnormal={isAbnormal('inflammatory', 'CRP')}
              abnormalDirection={getDirection('inflammatory', 'CRP')}
              onClick={() => handleLabClick('CRP', 'inflammatory', getValue('inflammatory', 'CRP'), getUnit('inflammatory', 'CRP', 'mg/L'))}
            />
            <LabItem
              labName="PCT"
              label="PCT"
              value={getValue('inflammatory', 'PCT')}
              unit={getUnit('inflammatory', 'PCT', 'ng/mL')}
              isAbnormal={isAbnormal('inflammatory', 'PCT')}
              abnormalDirection={getDirection('inflammatory', 'PCT')}
              onClick={() => handleLabClick('PCT', 'inflammatory', getValue('inflammatory', 'PCT'), getUnit('inflammatory', 'PCT', 'ng/mL'))}
            />
            <LabItem
              labName="DDimer"
              label="D-dimer"
              value={getValue('coagulation', 'DDimer')}
              unit={getUnit('coagulation', 'DDimer', 'μg/mL')}
              isAbnormal={isAbnormal('coagulation', 'DDimer')}
              abnormalDirection={getDirection('coagulation', 'DDimer')}
              onClick={() => handleLabClick('DDimer', 'coagulation', getValue('coagulation', 'DDimer'), getUnit('coagulation', 'DDimer', 'μg/mL'))}
            />
            <LabItem
              labName="IL-6"
              label="IL-6"
              value={getValue('inflammatory', 'IL-6')}
              unit={getUnit('inflammatory', 'IL-6', 'pg/mL')}
              isAbnormal={isAbnormal('inflammatory', 'IL-6')}
              abnormalDirection={getDirection('inflammatory', 'IL-6')}
              onClick={() => handleLabClick('IL-6', 'inflammatory', getValue('inflammatory', 'IL-6'), getUnit('inflammatory', 'IL-6', 'pg/mL'))}
            />
          </div>
        </div>

        {/* 動脈血氣體分析 */}
        <div className={showAbg ? 'space-y-2' : 'hidden'}>
          <h3 className="text-xs font-semibold tracking-wide text-brand">動脈血氣體分析</h3>
          <div className={compactGridClass} style={compactGridStyle}>
            <LabItem
              labName="pH"
              label="pH"
              value={getValue('bloodGas', 'pH')}
              unit={getUnit('bloodGas', 'pH', '')}
              isAbnormal={isAbnormal('bloodGas', 'pH')}
              abnormalDirection={getDirection('bloodGas', 'pH')}
              onClick={() => handleLabClick('pH', 'bloodGas', getValue('bloodGas', 'pH'), getUnit('bloodGas', 'pH', ''))}
            />
            <LabItem
              labName="PCO2"
              label="PCO₂"
              value={getValue('bloodGas', 'PCO2')}
              unit={getUnit('bloodGas', 'PCO2', 'mmHg')}
              isAbnormal={isAbnormal('bloodGas', 'PCO2')}
              abnormalDirection={getDirection('bloodGas', 'PCO2')}
              onClick={() => handleLabClick('PCO2', 'bloodGas', getValue('bloodGas', 'PCO2'), getUnit('bloodGas', 'PCO2', 'mmHg'))}
            />
            <LabItem
              labName="PO2"
              label="PO₂"
              value={getValue('bloodGas', 'PO2')}
              unit={getUnit('bloodGas', 'PO2', 'mmHg')}
              isAbnormal={isAbnormal('bloodGas', 'PO2')}
              abnormalDirection={getDirection('bloodGas', 'PO2')}
              onClick={() => handleLabClick('PO2', 'bloodGas', getValue('bloodGas', 'PO2'), getUnit('bloodGas', 'PO2', 'mmHg'))}
            />
            <LabItem
              labName="HCO3"
              label="HCO₃"
              value={getValue('bloodGas', 'HCO3')}
              unit={getUnit('bloodGas', 'HCO3', 'mEq/L')}
              isAbnormal={isAbnormal('bloodGas', 'HCO3')}
              abnormalDirection={getDirection('bloodGas', 'HCO3')}
              onClick={() => handleLabClick('HCO3', 'bloodGas', getValue('bloodGas', 'HCO3'), getUnit('bloodGas', 'HCO3', 'mEq/L'))}
            />
            <LabItem
              labName="BE"
              label="BE"
              value={getValue('bloodGas', 'BE')}
              unit={getUnit('bloodGas', 'BE', 'mmol/L')}
              isAbnormal={isAbnormal('bloodGas', 'BE')}
              abnormalDirection={getDirection('bloodGas', 'BE')}
              onClick={() => handleLabClick('BE', 'bloodGas', getValue('bloodGas', 'BE'), getUnit('bloodGas', 'BE', 'mmol/L'))}
            />
            <LabItem
              labName="SaO2"
              label="SaO₂"
              value={getValue('bloodGas', 'SaO2')}
              unit={getUnit('bloodGas', 'SaO2', '%')}
              isAbnormal={isAbnormal('bloodGas', 'SaO2')}
              abnormalDirection={getDirection('bloodGas', 'SaO2')}
              onClick={() => handleLabClick('SaO2', 'bloodGas', getValue('bloodGas', 'SaO2'), getUnit('bloodGas', 'SaO2', '%'))}
            />
          </div>
        </div>

        {/* 肝腎功能 */}
        <div className={showLiverRenal ? 'space-y-2' : 'hidden'}>
          <h3 className="text-xs font-semibold tracking-wide text-brand">肝腎功能</h3>
          <div className={compactGridClass} style={compactGridStyle}>
            <LabItem
              labName="AST"
              label="AST"
              value={getValue('biochemistry', 'AST')}
              unit={getUnit('biochemistry', 'AST', 'U/L')}
              isAbnormal={isAbnormal('biochemistry', 'AST')}
              abnormalDirection={getDirection('biochemistry', 'AST')}
              onClick={() => handleLabClick('AST', 'biochemistry', getValue('biochemistry', 'AST'), getUnit('biochemistry', 'AST', 'U/L'))}
            />
            <LabItem
              labName="ALT"
              label="ALT"
              value={getValue('biochemistry', 'ALT')}
              unit={getUnit('biochemistry', 'ALT', 'U/L')}
              isAbnormal={isAbnormal('biochemistry', 'ALT')}
              abnormalDirection={getDirection('biochemistry', 'ALT')}
              onClick={() => handleLabClick('ALT', 'biochemistry', getValue('biochemistry', 'ALT'), getUnit('biochemistry', 'ALT', 'U/L'))}
            />
            <LabItem
              labName="TBil"
              label="T-bil"
              value={getValue('biochemistry', 'TBil')}
              unit={getUnit('biochemistry', 'TBil', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'TBil')}
              abnormalDirection={getDirection('biochemistry', 'TBil')}
              onClick={() => handleLabClick('TBil', 'biochemistry', getValue('biochemistry', 'TBil'), getUnit('biochemistry', 'TBil', 'mg/dL'))}
            />
            <LabItem
              labName="DBil"
              label="D-bil"
              value={getValue('biochemistry', 'DBil')}
              unit={getUnit('biochemistry', 'DBil', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'DBil')}
              abnormalDirection={getDirection('biochemistry', 'DBil')}
              onClick={() => handleLabClick('DBil', 'biochemistry', getValue('biochemistry', 'DBil'), getUnit('biochemistry', 'DBil', 'mg/dL'))}
            />
            <LabItem
              labName="INR"
              label="INR"
              value={getValue('coagulation', 'INR')}
              unit={getUnit('coagulation', 'INR', '')}
              isAbnormal={isAbnormal('coagulation', 'INR')}
              abnormalDirection={getDirection('coagulation', 'INR')}
              onClick={() => handleLabClick('INR', 'coagulation', getValue('coagulation', 'INR'), getUnit('coagulation', 'INR', ''))}
            />
            <LabItem
              labName="BUN"
              label="BUN"
              value={getValue('biochemistry', 'BUN')}
              unit={getUnit('biochemistry', 'BUN', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'BUN')}
              abnormalDirection={getDirection('biochemistry', 'BUN')}
              onClick={() => handleLabClick('BUN', 'biochemistry', getValue('biochemistry', 'BUN'), getUnit('biochemistry', 'BUN', 'mg/dL'))}
            />
            <LabItem
              labName="Scr"
              label="Scr"
              value={getValue('biochemistry', 'Scr')}
              unit={getUnit('biochemistry', 'Scr', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Scr')}
              abnormalDirection={getDirection('biochemistry', 'Scr')}
              onClick={() => handleLabClick('Scr', 'biochemistry', getValue('biochemistry', 'Scr'), getUnit('biochemistry', 'Scr', 'mg/dL'))}
            />
            <LabItem
              labName="eGFR"
              label="eGFR"
              value={getValue('biochemistry', 'eGFR')}
              unit={getUnit('biochemistry', 'eGFR', 'mL/min')}
              isAbnormal={isAbnormal('biochemistry', 'eGFR')}
              abnormalDirection={getDirection('biochemistry', 'eGFR')}
              onClick={() => handleLabClick('eGFR', 'biochemistry', getValue('biochemistry', 'eGFR'), getUnit('biochemistry', 'eGFR', 'mL/min/1.73m²'))}
            />
            <LabItem
              labName="Clcr"
              label="Clcr"
              value={getValue('biochemistry', 'Clcr')}
              unit={getUnit('biochemistry', 'Clcr', 'mL/min')}
              isAbnormal={isAbnormal('biochemistry', 'Clcr')}
              abnormalDirection={getDirection('biochemistry', 'Clcr')}
              onClick={() => handleLabClick('Clcr', 'biochemistry', getValue('biochemistry', 'Clcr'), getUnit('biochemistry', 'Clcr', 'mL/min'))}
            />
          </div>
        </div>

        {/* 凝血功能 */}
        <div className={showCoagulation ? 'space-y-2' : 'hidden'}>
          <h3 className="text-xs font-semibold tracking-wide text-brand">凝血功能</h3>
          <div className={compactGridClass} style={compactGridStyle}>
            <LabItem
              labName="PT"
              label="PT"
              value={getValue('coagulation', 'PT')}
              unit={getUnit('coagulation', 'PT', 'sec')}
              isAbnormal={isAbnormal('coagulation', 'PT')}
              abnormalDirection={getDirection('coagulation', 'PT')}
              onClick={() => handleLabClick('PT', 'coagulation', getValue('coagulation', 'PT'), getUnit('coagulation', 'PT', 'sec'))}
            />
            <LabItem
              labName="aPTT"
              label="aPTT"
              value={getValue('coagulation', 'aPTT')}
              unit={getUnit('coagulation', 'aPTT', 'sec')}
              isAbnormal={isAbnormal('coagulation', 'aPTT')}
              abnormalDirection={getDirection('coagulation', 'aPTT')}
              onClick={() => handleLabClick('aPTT', 'coagulation', getValue('coagulation', 'aPTT'), getUnit('coagulation', 'aPTT', 'sec'))}
            />
            <LabItem
              labName="Fibrinogen"
              label="Fibrinogen"
              value={getValue('coagulation', 'Fibrinogen')}
              unit={getUnit('coagulation', 'Fibrinogen', 'g/L')}
              isAbnormal={isAbnormal('coagulation', 'Fibrinogen')}
              abnormalDirection={getDirection('coagulation', 'Fibrinogen')}
              onClick={() => handleLabClick('Fibrinogen', 'coagulation', getValue('coagulation', 'Fibrinogen'), getUnit('coagulation', 'Fibrinogen', 'g/L'))}
            />
          </div>
        </div>

        {/* 其他生化 */}
        <div className={showBiochemExtra ? 'space-y-2' : 'hidden'}>
          <h3 className="text-xs font-semibold tracking-wide text-brand">其他生化</h3>
          <div className={compactGridClass} style={compactGridStyle}>
            <LabItem
              labName="Glucose"
              label="Glucose"
              value={getValue('biochemistry', 'Glucose')}
              unit={getUnit('biochemistry', 'Glucose', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Glucose')}
              abnormalDirection={getDirection('biochemistry', 'Glucose')}
              onClick={() => handleLabClick('Glucose', 'biochemistry', getValue('biochemistry', 'Glucose'), getUnit('biochemistry', 'Glucose', 'mg/dL'))}
            />
            <LabItem
              labName="LDH"
              label="LDH"
              value={getValue('biochemistry', 'LDH')}
              unit={getUnit('biochemistry', 'LDH', 'U/L')}
              isAbnormal={isAbnormal('biochemistry', 'LDH')}
              abnormalDirection={getDirection('biochemistry', 'LDH')}
              onClick={() => handleLabClick('LDH', 'biochemistry', getValue('biochemistry', 'LDH'), getUnit('biochemistry', 'LDH', 'U/L'))}
            />
            <LabItem
              labName="Troponin-I"
              label="Tn-I"
              value={getValue('biochemistry', 'Troponin-I')}
              unit={getUnit('biochemistry', 'Troponin-I', 'ng/mL')}
              isAbnormal={isAbnormal('biochemistry', 'Troponin-I')}
              abnormalDirection={getDirection('biochemistry', 'Troponin-I')}
              onClick={() => handleLabClick('Troponin-I', 'biochemistry', getValue('biochemistry', 'Troponin-I'), getUnit('biochemistry', 'Troponin-I', 'ng/mL'))}
            />
            <LabItem
              labName="Uric"
              label="Uric Acid"
              value={getValue('biochemistry', 'Uric')}
              unit={getUnit('biochemistry', 'Uric', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Uric')}
              abnormalDirection={getDirection('biochemistry', 'Uric')}
              onClick={() => handleLabClick('Uric', 'biochemistry', getValue('biochemistry', 'Uric'), getUnit('biochemistry', 'Uric', 'mg/dL'))}
            />
            <LabItem
              labName="Osmolality"
              label="Osm"
              value={getValue('biochemistry', 'Osmolality')}
              unit={getUnit('biochemistry', 'Osmolality', 'mOsm/kg')}
              isAbnormal={isAbnormal('biochemistry', 'Osmolality')}
              abnormalDirection={getDirection('biochemistry', 'Osmolality')}
              onClick={() => handleLabClick('Osmolality', 'biochemistry', getValue('biochemistry', 'Osmolality'), getUnit('biochemistry', 'Osmolality', 'mOsm/kg'))}
            />
          </div>
        </div>

        {/* 選擇性追蹤項目 - 心臟標記 */}
        {showCardiac && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">心臟標記（選擇性追蹤）</h3>
            <div className={compactGridClass} style={compactGridStyle}>
              {getValue('cardiac', 'TnT') !== undefined && (
                <LabItem
                  labName="TnT"
                  label="Tn-T"
                  value={getValue('cardiac', 'TnT')}
                  unit={getUnit('cardiac', 'TnT', 'ng/mL')}
                  isAbnormal={isAbnormal('cardiac', 'TnT')}
              abnormalDirection={getDirection('cardiac', 'TnT')}
                  onClick={() => handleLabClick('TnT', 'cardiac', getValue('cardiac', 'TnT'), getUnit('cardiac', 'TnT', 'ng/mL'))}
                  isOptional={true}
                />
              )}

              {getValue('cardiac', 'CKMB') !== undefined && (
                <LabItem
                  labName="CKMB"
                  label="CK-MB"
                  value={getValue('cardiac', 'CKMB')}
                  unit={getUnit('cardiac', 'CKMB', 'U/L')}
                  isAbnormal={isAbnormal('cardiac', 'CKMB')}
              abnormalDirection={getDirection('cardiac', 'CKMB')}
                  onClick={() => handleLabClick('CKMB', 'cardiac', getValue('cardiac', 'CKMB'), getUnit('cardiac', 'CKMB', 'U/L'))}
                  isOptional={true}
                />
              )}

              {getValue('cardiac', 'CK') !== undefined && (
                <LabItem
                  labName="CK"
                  label="CK"
                  value={getValue('cardiac', 'CK')}
                  unit={getUnit('cardiac', 'CK', 'U/L')}
                  isAbnormal={isAbnormal('cardiac', 'CK')}
              abnormalDirection={getDirection('cardiac', 'CK')}
                  onClick={() => handleLabClick('CK', 'cardiac', getValue('cardiac', 'CK'), getUnit('cardiac', 'CK', 'U/L'))}
                  isOptional={true}
                />
              )}

              {getValue('cardiac', 'NTproBNP') !== undefined && (
                <LabItem
                  labName="NTproBNP"
                  label="NT-proBNP"
                  value={getValue('cardiac', 'NTproBNP')}
                  unit={getUnit('cardiac', 'NTproBNP', 'pg/mL')}
                  isAbnormal={isAbnormal('cardiac', 'NTproBNP')}
              abnormalDirection={getDirection('cardiac', 'NTproBNP')}
                  onClick={() => handleLabClick('NTproBNP', 'cardiac', getValue('cardiac', 'NTproBNP'), getUnit('cardiac', 'NTproBNP', 'pg/mL'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        {/* 選擇性追蹤項目 - 血脂與代謝 */}
        {showLipid && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">血脂與代謝（選擇性追蹤）</h3>
            <div className={compactGridClass} style={compactGridStyle}>
              {getValue('lipid', 'TCHO') !== undefined && (
                <LabItem
                  labName="TCHO"
                  label="T-CHO"
                  value={getValue('lipid', 'TCHO')}
                  unit={getUnit('lipid', 'TCHO', 'mg/dL')}
                  isAbnormal={isAbnormal('lipid', 'TCHO')}
              abnormalDirection={getDirection('lipid', 'TCHO')}
                  onClick={() => handleLabClick('TCHO', 'lipid', getValue('lipid', 'TCHO'), getUnit('lipid', 'TCHO', 'mg/dL'))}
                  isOptional={true}
                />
              )}

              {getValue('lipid', 'TG') !== undefined && (
                <LabItem
                  labName="TG"
                  label="TG"
                  value={getValue('lipid', 'TG')}
                  unit={getUnit('lipid', 'TG', 'mg/dL')}
                  isAbnormal={isAbnormal('lipid', 'TG')}
              abnormalDirection={getDirection('lipid', 'TG')}
                  onClick={() => handleLabClick('TG', 'lipid', getValue('lipid', 'TG'), getUnit('lipid', 'TG', 'mg/dL'))}
                  isOptional={true}
                />
              )}

              {getValue('lipid', 'LDLC') !== undefined && (
                <LabItem
                  labName="LDLC"
                  label="LDL-C"
                  value={getValue('lipid', 'LDLC')}
                  unit={getUnit('lipid', 'LDLC', 'mg/dL')}
                  isAbnormal={isAbnormal('lipid', 'LDLC')}
              abnormalDirection={getDirection('lipid', 'LDLC')}
                  onClick={() => handleLabClick('LDLC', 'lipid', getValue('lipid', 'LDLC'), getUnit('lipid', 'LDLC', 'mg/dL'))}
                  isOptional={true}
                />
              )}

              {getValue('lipid', 'HDLC') !== undefined && (
                <LabItem
                  labName="HDLC"
                  label="HDL-C"
                  value={getValue('lipid', 'HDLC')}
                  unit={getUnit('lipid', 'HDLC', 'mg/dL')}
                  isAbnormal={isAbnormal('lipid', 'HDLC')}
              abnormalDirection={getDirection('lipid', 'HDLC')}
                  onClick={() => handleLabClick('HDLC', 'lipid', getValue('lipid', 'HDLC'), getUnit('lipid', 'HDLC', 'mg/dL'))}
                  isOptional={true}
                />
              )}

              {getValue('lipid', 'UA') !== undefined && (
                <LabItem
                  labName="UA"
                  label="UA"
                  value={getValue('lipid', 'UA')}
                  unit={getUnit('lipid', 'UA', 'mg/dL')}
                  isAbnormal={isAbnormal('lipid', 'UA')}
              abnormalDirection={getDirection('lipid', 'UA')}
                  onClick={() => handleLabClick('UA', 'lipid', getValue('lipid', 'UA'), getUnit('lipid', 'UA', 'mg/dL'))}
                  isOptional={true}
                />
              )}

              {getValue('lipid', 'P') !== undefined && (
                <LabItem
                  labName="P"
                  label="P"
                  value={getValue('lipid', 'P')}
                  unit={getUnit('lipid', 'P', 'mg/dL')}
                  isAbnormal={isAbnormal('lipid', 'P')}
              abnormalDirection={getDirection('lipid', 'P')}
                  onClick={() => handleLabClick('P', 'lipid', getValue('lipid', 'P'), getUnit('lipid', 'P', 'mg/dL'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        {/* 選擇性追蹤項目 - 其他 */}
        {showOther && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">其他檢驗（選擇性追蹤）</h3>
            <div className={compactGridClass} style={compactGridStyle}>
              {getValue('other', 'HbA1C') !== undefined && (
                <LabItem
                  labName="HbA1C"
                  label="HbA1C"
                  value={getValue('other', 'HbA1C')}
                  unit={getUnit('other', 'HbA1C', '%')}
                  isAbnormal={isAbnormal('other', 'HbA1C')}
              abnormalDirection={getDirection('other', 'HbA1C')}
                  onClick={() => handleLabClick('HbA1C', 'other', getValue('other', 'HbA1C'), getUnit('other', 'HbA1C', '%'))}
                  isOptional={true}
                />
              )}

              {getValue('other', 'LDH') !== undefined && (
                <LabItem
                  labName="LDH"
                  label="LDH"
                  value={getValue('other', 'LDH')}
                  unit={getUnit('other', 'LDH', 'U/L')}
                  isAbnormal={isAbnormal('other', 'LDH')}
              abnormalDirection={getDirection('other', 'LDH')}
                  onClick={() => handleLabClick('LDH', 'other', getValue('other', 'LDH'), getUnit('other', 'LDH', 'U/L'))}
                  isOptional={true}
                />
              )}

              {getValue('other', 'NH3') !== undefined && (
                <LabItem
                  labName="NH3"
                  label="NH₃"
                  value={getValue('other', 'NH3')}
                  unit={getUnit('other', 'NH3', 'μg/dL')}
                  isAbnormal={isAbnormal('other', 'NH3')}
              abnormalDirection={getDirection('other', 'NH3')}
                  onClick={() => handleLabClick('NH3', 'other', getValue('other', 'NH3'), getUnit('other', 'NH3', 'μg/dL'))}
                  isOptional={true}
                />
              )}

              {getValue('other', 'Amylase') !== undefined && (
                <LabItem
                  labName="Amylase"
                  label="Amylase"
                  value={getValue('other', 'Amylase')}
                  unit={getUnit('other', 'Amylase', 'U/L')}
                  isAbnormal={isAbnormal('other', 'Amylase')}
              abnormalDirection={getDirection('other', 'Amylase')}
                  onClick={() => handleLabClick('Amylase', 'other', getValue('other', 'Amylase'), getUnit('other', 'Amylase', 'U/L'))}
                  isOptional={true}
                />
              )}

              {getValue('other', 'Lipase') !== undefined && (
                <LabItem
                  labName="Lipase"
                  label="Lipase"
                  value={getValue('other', 'Lipase')}
                  unit={getUnit('other', 'Lipase', 'U/L')}
                  isAbnormal={isAbnormal('other', 'Lipase')}
              abnormalDirection={getDirection('other', 'Lipase')}
                  onClick={() => handleLabClick('Lipase', 'other', getValue('other', 'Lipase'), getUnit('other', 'Lipase', 'U/L'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        {/* 選擇性追蹤項目 - 甲狀腺與荷爾蒙 */}
        {showThyroidHormone && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">甲狀腺與荷爾蒙（選擇性追蹤）</h3>
            <div className={compactGridClass} style={compactGridStyle}>
              {getValue('thyroid', 'TSH') !== undefined && (
                <LabItem
                  labName="TSH"
                  label="TSH"
                  value={getValue('thyroid', 'TSH')}
                  unit={getUnit('thyroid', 'TSH', 'μIU/mL')}
                  isAbnormal={isAbnormal('thyroid', 'TSH')}
              abnormalDirection={getDirection('thyroid', 'TSH')}
                  onClick={() => handleLabClick('TSH', 'thyroid', getValue('thyroid', 'TSH'), getUnit('thyroid', 'TSH', 'μIU/mL'))}
                  isOptional={true}
                />
              )}

              {getValue('thyroid', 'freeT4') !== undefined && (
                <LabItem
                  labName="freeT4"
                  label="free T4"
                  value={getValue('thyroid', 'freeT4')}
                  unit={getUnit('thyroid', 'freeT4', 'ng/dL')}
                  isAbnormal={isAbnormal('thyroid', 'freeT4')}
              abnormalDirection={getDirection('thyroid', 'freeT4')}
                  onClick={() => handleLabClick('freeT4', 'thyroid', getValue('thyroid', 'freeT4'), getUnit('thyroid', 'freeT4', 'ng/dL'))}
                  isOptional={true}
                />
              )}

              {getValue('hormone', 'Cortisol') !== undefined && (
                <LabItem
                  labName="Cortisol"
                  label="Cortisol"
                  value={getValue('hormone', 'Cortisol')}
                  unit={getUnit('hormone', 'Cortisol', 'μg/dL')}
                  isAbnormal={isAbnormal('hormone', 'Cortisol')}
              abnormalDirection={getDirection('hormone', 'Cortisol')}
                  onClick={() => handleLabClick('Cortisol', 'hormone', getValue('hormone', 'Cortisol'), getUnit('hormone', 'Cortisol', 'μg/dL'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        {hasAnyVisibleSection && (
          <div className="flex items-center gap-2 pt-0.5">
            <div className="h-4 w-1 rounded-full bg-red-500"></div>
            <span className="text-[11px] text-muted-foreground">紅框=偏高 • 藍框=偏低 • 點擊=歷史趨勢</span>
          </div>
        )}
      </div>
      </LabDisplayFilterContext.Provider>

      {selectedLab && (
        <LabTrendChart
          isOpen={true}
          onClose={() => setSelectedLab(null)}
          labName={selectedLab.name}
          labNameChinese={selectedLab.nameChinese}
          unit={selectedLab.unit}
          trendData={selectedLab.trendData}
        />
      )}
    </>
  );
}
