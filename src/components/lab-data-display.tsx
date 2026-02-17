import { type LabData } from '../lib/api';
import { useState } from 'react';
import { LabTrendChart, type LabTrendData } from './lab-trend-chart';
import { TrendingUp } from 'lucide-react';
import { getLabTrends } from '../lib/api/lab-data';

const labChineseNames: Record<string, string> = {
  Na: '\u9209', K: '\u9240', Ca: '\u9223', freeCa: '\u6E38\u96E2\u9223', Mg: '\u93C2',
  WBC: '\u767D\u8840\u7403', RBC: '\u7D05\u8840\u7403', Hb: '\u8840\u7D05\u7D20', PLT: '\u8840\u5C0F\u677F',
  Alb: '\u767D\u86CB\u767D', CRP: 'C\u53CD\u61C9\u86CB\u767D', PCT: '\u964D\u9223\u7D20\u539F',
  DDimer: 'D-\u4E8C\u805A\u9AD4', pH: '\u9178\u9E7C\u503C', PCO2: '\u4E8C\u6C27\u5316\u78B3\u5206\u58D3',
  PO2: '\u6C27\u5206\u58D3', HCO3: '\u78B3\u9178\u6C2B\u6839', Lactate: '\u4E73\u9178',
  AST: '\u5929\u9580\u51AC\u80FA\u9178\u8F49\u80FA\u9176', ALT: '\u4E19\u80FA\u9178\u8F49\u80FA\u9176', TBil: '\u7E3D\u81BD\u7D05\u7D20',
  INR: '\u570B\u969B\u6A19\u6E96\u5316\u6BD4\u503C', BUN: '\u8840\u6DB2\u5C3F\u7D20\u6C2E', Scr: '\u808C\u9178\u9150',
  eGFR: '\u814E\u7D72\u7403\u904E\u6FFE\u7387', Clcr: '\u808C\u9178\u9150\u6E05\u9664\u7387',
};

interface LabDataDisplayProps {
  labData: LabData | undefined;
  patientId?: string;
}

interface LabItemProps {
  labName: string;
  label: string;
  value: unknown;
  unit: string;
  isAbnormal?: boolean;
  onClick?: () => void;
  isOptional?: boolean; // 選擇性追蹤項目使用粉紅色背景
}

const compactGridClass = 'grid gap-1 [grid-template-columns:repeat(auto-fill,minmax(96px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]';

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

function LabItem({ labName, label, value, unit, isAbnormal, onClick, isOptional }: LabItemProps) {
  const displayValue = toDisplayText(value);
  const hasValue = displayValue !== '-';
  const canOpenTrend = hasValue && !!onClick;

  return (
    <div
      className={`group relative flex aspect-square flex-col rounded-lg border px-1.5 py-1 ${
        isOptional ? 'border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/70' : 'border-slate-200 bg-gradient-to-br from-white to-slate-50'
      } ${
        isAbnormal ? 'border-orange-400 bg-gradient-to-br from-orange-50 to-rose-50/70' : ''
      } ${
        canOpenTrend ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-[#7f265b]/45 hover:shadow-sm' : ''
      }`}
      onClick={canOpenTrend ? onClick : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[8px] font-semibold uppercase tracking-tight text-slate-500">{label}</p>
        {canOpenTrend && <TrendingUp className="h-2.5 w-2.5 shrink-0 text-[#7f265b] opacity-70" />}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className={`text-lg font-semibold leading-none tracking-tight ${isAbnormal ? 'text-orange-700' : 'text-slate-900'}`}>
          {displayValue}
        </span>
        {unit && (
          <span className="mt-0.5 max-w-full break-words text-[8px] leading-tight text-slate-500">
            {unit}
          </span>
        )}
      </div>
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
      <div className="space-y-2.5">
        {/* 固定追蹤項目 - 電解質 */}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-[#7f265b]">電解質與礦物質</h3>
          <div className={compactGridClass}>
            <LabItem
              labName="Na"
              label="Na"
              value={getValue('biochemistry', 'Na')}
              unit={getUnit('biochemistry', 'Na', 'mEq/L')}
              isAbnormal={isAbnormal('biochemistry', 'Na')}
              onClick={() => handleLabClick('Na', 'biochemistry', getValue('biochemistry', 'Na'), getUnit('biochemistry', 'Na', 'mEq/L'))}
            />
            <LabItem
              labName="K"
              label="K"
              value={getValue('biochemistry', 'K')}
              unit={getUnit('biochemistry', 'K', 'mEq/L')}
              isAbnormal={isAbnormal('biochemistry', 'K')}
              onClick={() => handleLabClick('K', 'biochemistry', getValue('biochemistry', 'K'), getUnit('biochemistry', 'K', 'mEq/L'))}
            />
            <LabItem
              labName="Ca"
              label="Ca"
              value={getValue('biochemistry', 'Ca')}
              unit={getUnit('biochemistry', 'Ca', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Ca')}
              onClick={() => handleLabClick('Ca', 'biochemistry', getValue('biochemistry', 'Ca'), getUnit('biochemistry', 'Ca', 'mg/dL'))}
            />
            <LabItem
              labName="freeCa"
              label="free Ca"
              value={getValue('biochemistry', 'freeCa')}
              unit={getUnit('biochemistry', 'freeCa', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'freeCa')}
              onClick={() => handleLabClick('freeCa', 'biochemistry', getValue('biochemistry', 'freeCa'), getUnit('biochemistry', 'freeCa', 'mg/dL'))}
            />
            <LabItem
              labName="Mg"
              label="Mg"
              value={getValue('biochemistry', 'Mg')}
              unit={getUnit('biochemistry', 'Mg', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Mg')}
              onClick={() => handleLabClick('Mg', 'biochemistry', getValue('biochemistry', 'Mg'), getUnit('biochemistry', 'Mg', 'mg/dL'))}
            />
          </div>
        </div>

        {/* 血液學檢查 */}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-[#7f265b]">血液學檢查</h3>
          <div className={compactGridClass}>
            <LabItem
              labName="WBC"
              label="WBC"
              value={getValue('hematology', 'WBC')}
              unit={getUnit('hematology', 'WBC', '10³/μL')}
              isAbnormal={isAbnormal('hematology', 'WBC')}
              onClick={() => handleLabClick('WBC', 'hematology', getValue('hematology', 'WBC'), getUnit('hematology', 'WBC', '10³/μL'))}
            />
            <LabItem
              labName="RBC"
              label="RBC"
              value={getValue('hematology', 'RBC')}
              unit={getUnit('hematology', 'RBC', '10⁶/μL')}
              isAbnormal={isAbnormal('hematology', 'RBC')}
              onClick={() => handleLabClick('RBC', 'hematology', getValue('hematology', 'RBC'), getUnit('hematology', 'RBC', '10⁶/μL'))}
            />
            <LabItem
              labName="Hb"
              label="Hb"
              value={getValue('hematology', 'Hb')}
              unit={getUnit('hematology', 'Hb', 'g/dL')}
              isAbnormal={isAbnormal('hematology', 'Hb')}
              onClick={() => handleLabClick('Hb', 'hematology', getValue('hematology', 'Hb'), getUnit('hematology', 'Hb', 'g/dL'))}
            />
            <LabItem
              labName="PLT"
              label="PLT"
              value={getValue('hematology', 'PLT')}
              unit={getUnit('hematology', 'PLT', '10³/μL')}
              isAbnormal={isAbnormal('hematology', 'PLT')}
              onClick={() => handleLabClick('PLT', 'hematology', getValue('hematology', 'PLT'), getUnit('hematology', 'PLT', '10³/μL'))}
            />
          </div>
        </div>

        {/* 生化與炎症指標 */}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-[#7f265b]">生化與炎症指標</h3>
          <div className={compactGridClass}>
            <LabItem
              labName="Alb"
              label="Alb"
              value={getValue('biochemistry', 'Alb')}
              unit={getUnit('biochemistry', 'Alb', 'g/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Alb')}
              onClick={() => handleLabClick('Alb', 'biochemistry', getValue('biochemistry', 'Alb'), getUnit('biochemistry', 'Alb', 'g/dL'))}
            />
            <LabItem
              labName="CRP"
              label="CRP"
              value={getValue('inflammatory', 'CRP')}
              unit={getUnit('inflammatory', 'CRP', 'mg/L')}
              isAbnormal={isAbnormal('inflammatory', 'CRP')}
              onClick={() => handleLabClick('CRP', 'inflammatory', getValue('inflammatory', 'CRP'), getUnit('inflammatory', 'CRP', 'mg/L'))}
            />
            <LabItem
              labName="PCT"
              label="PCT"
              value={getValue('inflammatory', 'PCT')}
              unit={getUnit('inflammatory', 'PCT', 'ng/mL')}
              isAbnormal={isAbnormal('inflammatory', 'PCT')}
              onClick={() => handleLabClick('PCT', 'inflammatory', getValue('inflammatory', 'PCT'), getUnit('inflammatory', 'PCT', 'ng/mL'))}
            />
            <LabItem
              labName="DDimer"
              label="D-dimer"
              value={getValue('coagulation', 'DDimer')}
              unit={getUnit('coagulation', 'DDimer', 'μg/mL')}
              isAbnormal={isAbnormal('coagulation', 'DDimer')}
              onClick={() => handleLabClick('DDimer', 'coagulation', getValue('coagulation', 'DDimer'), getUnit('coagulation', 'DDimer', 'μg/mL'))}
            />
          </div>
        </div>

        {/* 動脈血氣體分析 */}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-[#7f265b]">動脈血氣體分析</h3>
          <div className={compactGridClass}>
            <LabItem
              labName="pH"
              label="pH"
              value={getValue('bloodGas', 'pH')}
              unit={getUnit('bloodGas', 'pH', '')}
              isAbnormal={isAbnormal('bloodGas', 'pH')}
              onClick={() => handleLabClick('pH', 'bloodGas', getValue('bloodGas', 'pH'), getUnit('bloodGas', 'pH', ''))}
            />
            <LabItem
              labName="PCO2"
              label="PCO₂"
              value={getValue('bloodGas', 'PCO2')}
              unit={getUnit('bloodGas', 'PCO2', 'mmHg')}
              isAbnormal={isAbnormal('bloodGas', 'PCO2')}
              onClick={() => handleLabClick('PCO2', 'bloodGas', getValue('bloodGas', 'PCO2'), getUnit('bloodGas', 'PCO2', 'mmHg'))}
            />
            <LabItem
              labName="PO2"
              label="PO₂"
              value={getValue('bloodGas', 'PO2')}
              unit={getUnit('bloodGas', 'PO2', 'mmHg')}
              isAbnormal={isAbnormal('bloodGas', 'PO2')}
              onClick={() => handleLabClick('PO2', 'bloodGas', getValue('bloodGas', 'PO2'), getUnit('bloodGas', 'PO2', 'mmHg'))}
            />
            <LabItem
              labName="HCO3"
              label="HCO₃"
              value={getValue('bloodGas', 'HCO3')}
              unit={getUnit('bloodGas', 'HCO3', 'mEq/L')}
              isAbnormal={isAbnormal('bloodGas', 'HCO3')}
              onClick={() => handleLabClick('HCO3', 'bloodGas', getValue('bloodGas', 'HCO3'), getUnit('bloodGas', 'HCO3', 'mEq/L'))}
            />
            <LabItem
              labName="Lactate"
              label="Lactate"
              value={getValue('bloodGas', 'Lactate')}
              unit={getUnit('bloodGas', 'Lactate', 'mmol/L')}
              isAbnormal={isAbnormal('bloodGas', 'Lactate')}
              onClick={() => handleLabClick('Lactate', 'bloodGas', getValue('bloodGas', 'Lactate'), getUnit('bloodGas', 'Lactate', 'mmol/L'))}
            />
          </div>
        </div>

        {/* 肝腎功能 */}
        <div className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-[#7f265b]">肝腎功能</h3>
          <div className={compactGridClass}>
            <LabItem
              labName="AST"
              label="AST"
              value={getValue('biochemistry', 'AST')}
              unit={getUnit('biochemistry', 'AST', 'U/L')}
              isAbnormal={isAbnormal('biochemistry', 'AST')}
              onClick={() => handleLabClick('AST', 'biochemistry', getValue('biochemistry', 'AST'), getUnit('biochemistry', 'AST', 'U/L'))}
            />
            <LabItem
              labName="ALT"
              label="ALT"
              value={getValue('biochemistry', 'ALT')}
              unit={getUnit('biochemistry', 'ALT', 'U/L')}
              isAbnormal={isAbnormal('biochemistry', 'ALT')}
              onClick={() => handleLabClick('ALT', 'biochemistry', getValue('biochemistry', 'ALT'), getUnit('biochemistry', 'ALT', 'U/L'))}
            />
            <LabItem
              labName="TBil"
              label="T-bil"
              value={getValue('biochemistry', 'TBil')}
              unit={getUnit('biochemistry', 'TBil', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'TBil')}
              onClick={() => handleLabClick('TBil', 'biochemistry', getValue('biochemistry', 'TBil'), getUnit('biochemistry', 'TBil', 'mg/dL'))}
            />
            <LabItem
              labName="INR"
              label="INR"
              value={getValue('coagulation', 'INR')}
              unit={getUnit('coagulation', 'INR', '')}
              isAbnormal={isAbnormal('coagulation', 'INR')}
              onClick={() => handleLabClick('INR', 'coagulation', getValue('coagulation', 'INR'), getUnit('coagulation', 'INR', ''))}
            />
            <LabItem
              labName="BUN"
              label="BUN"
              value={getValue('biochemistry', 'BUN')}
              unit={getUnit('biochemistry', 'BUN', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'BUN')}
              onClick={() => handleLabClick('BUN', 'biochemistry', getValue('biochemistry', 'BUN'), getUnit('biochemistry', 'BUN', 'mg/dL'))}
            />
            <LabItem
              labName="Scr"
              label="Scr"
              value={getValue('biochemistry', 'Scr')}
              unit={getUnit('biochemistry', 'Scr', 'mg/dL')}
              isAbnormal={isAbnormal('biochemistry', 'Scr')}
              onClick={() => handleLabClick('Scr', 'biochemistry', getValue('biochemistry', 'Scr'), getUnit('biochemistry', 'Scr', 'mg/dL'))}
            />
            <LabItem
              labName="eGFR"
              label="eGFR"
              value={getValue('biochemistry', 'eGFR')}
              unit={getUnit('biochemistry', 'eGFR', 'mL/min')}
              isAbnormal={isAbnormal('biochemistry', 'eGFR')}
              onClick={() => handleLabClick('eGFR', 'biochemistry', getValue('biochemistry', 'eGFR'), getUnit('biochemistry', 'eGFR', 'mL/min/1.73m²'))}
            />
            <LabItem
              labName="Clcr"
              label="Clcr"
              value={getValue('biochemistry', 'Clcr')}
              unit={getUnit('biochemistry', 'Clcr', 'mL/min')}
              isAbnormal={isAbnormal('biochemistry', 'Clcr')}
              onClick={() => handleLabClick('Clcr', 'biochemistry', getValue('biochemistry', 'Clcr'), getUnit('biochemistry', 'Clcr', 'mL/min'))}
            />
          </div>
        </div>

        {/* 選擇性追蹤項目 - 心臟標記 */}
        {labData?.cardiac && Object.keys(labData.cardiac).length > 0 && (
          <div className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">心臟標記（選擇性追蹤）</h3>
            <div className={compactGridClass}>
              {getValue('cardiac', 'TnT') !== undefined && (
                <LabItem
                  labName="TnT"
                  label="Tn-T"
                  value={getValue('cardiac', 'TnT')}
                  unit={getUnit('cardiac', 'TnT', 'ng/mL')}
                  isAbnormal={isAbnormal('cardiac', 'TnT')}
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
                  onClick={() => handleLabClick('NTproBNP', 'cardiac', getValue('cardiac', 'NTproBNP'), getUnit('cardiac', 'NTproBNP', 'pg/mL'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        {/* 選擇性追蹤項目 - 血脂與代謝 */}
        {labData?.lipid && Object.keys(labData.lipid).length > 0 && (
          <div className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">血脂與代謝（選擇性追蹤）</h3>
            <div className={compactGridClass}>
              {getValue('lipid', 'TCHO') !== undefined && (
                <LabItem
                  labName="TCHO"
                  label="T-CHO"
                  value={getValue('lipid', 'TCHO')}
                  unit={getUnit('lipid', 'TCHO', 'mg/dL')}
                  isAbnormal={isAbnormal('lipid', 'TCHO')}
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
                  onClick={() => handleLabClick('P', 'lipid', getValue('lipid', 'P'), getUnit('lipid', 'P', 'mg/dL'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        {/* 選擇性追蹤項目 - 其他 */}
        {labData?.other && Object.keys(labData.other).length > 0 && (
          <div className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">其他檢驗（選擇性追蹤）</h3>
            <div className={compactGridClass}>
              {getValue('other', 'HbA1C') !== undefined && (
                <LabItem
                  labName="HbA1C"
                  label="HbA1C"
                  value={getValue('other', 'HbA1C')}
                  unit={getUnit('other', 'HbA1C', '%')}
                  isAbnormal={isAbnormal('other', 'HbA1C')}
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
                  onClick={() => handleLabClick('Lipase', 'other', getValue('other', 'Lipase'), getUnit('other', 'Lipase', 'U/L'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        {/* 選擇性追蹤項目 - 甲狀腺與荷爾蒙 */}
        {((labData?.thyroid && Object.keys(labData.thyroid).length > 0) || (labData?.hormone && Object.keys(labData.hormone).length > 0)) && (
          <div className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-[#f59e0b]">甲狀腺與荷爾蒙（選擇性追蹤）</h3>
            <div className={compactGridClass}>
              {getValue('thyroid', 'TSH') !== undefined && (
                <LabItem
                  labName="TSH"
                  label="TSH"
                  value={getValue('thyroid', 'TSH')}
                  unit={getUnit('thyroid', 'TSH', 'μIU/mL')}
                  isAbnormal={isAbnormal('thyroid', 'TSH')}
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
                  onClick={() => handleLabClick('Cortisol', 'hormone', getValue('hormone', 'Cortisol'), getUnit('hormone', 'Cortisol', 'μg/dL'))}
                  isOptional={true}
                />
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <div className="h-4 w-1 rounded-full bg-orange-500"></div>
          <span className="text-[11px] text-muted-foreground">橘框=異常值 • 點擊=歷史趨勢</span>
        </div>
      </div>

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
