/**
 * "其他檢驗" (Other Labs) section renderer — Step 2 of the lab-display
 * refactor (see `docs/lab-display-refactor-plan.md`).
 *
 * Buckets RenderItems by `subGroup` (U / ST / PF / misc) and renders each
 * non-empty bucket under an h4 sub-heading, matching the existing
 * `{/* 其他檢驗 *\/}` block in `lab-data-display.tsx` (lines ~1268–1317).
 */

import { type JSX } from 'react';
import { type LabData } from '../../lib/api';
import { type RenderItem } from './sections';
import { LabItem } from './LabItem';
import {
  getItem,
  getValue,
  getUnit,
  isAbnormal as isAbnormalFn,
  getDirection,
  getRefRange,
} from './helpers';

// Match the existing grid constants from lab-data-display.tsx (lines 187-192).
const compactGridClass = 'grid';
const compactGridStyle = {
  gridTemplateColumns:
    'repeat(auto-fit, minmax(var(--metric-card-size, 124px), var(--metric-card-size, 124px)))',
  gap: 'var(--metric-card-gap, 10px)',
  justifyContent: 'start',
} as const;

type SubGroupKey = 'U' | 'ST' | 'PF' | 'misc';

const SUB_GROUP_LABEL: Record<SubGroupKey, string> = {
  U: '尿液檢查',
  ST: '糞便檢查',
  PF: '胸腹水分析',
  misc: '其他',
};

// Sub-group order: U → ST → PF → misc.
const SUB_GROUP_ORDER: SubGroupKey[] = ['U', 'ST', 'PF', 'misc'];

export interface OtherSectionProps {
  title: string;
  items: RenderItem[];
  labData: LabData | null | undefined;
  onLabClick: (
    labName: string,
    category: string,
    value: number | undefined,
    unit: string,
    refRange?: string,
  ) => void;
}

export function OtherSection({
  title,
  items,
  labData,
  onLabClick,
}: OtherSectionProps): JSX.Element | null {
  if (items.length === 0) return null;

  // Bucket by subGroup (default to 'misc' if unset — should not happen for
  // 'other' section items produced by groupLabData, but defensive).
  const buckets: Record<SubGroupKey, RenderItem[]> = {
    U: [],
    ST: [],
    PF: [],
    misc: [],
  };
  for (const item of items) {
    const sub: SubGroupKey = item.subGroup ?? 'misc';
    buckets[sub].push(item);
  }

  const visibleGroups = SUB_GROUP_ORDER.filter((key) => buckets[key].length > 0);
  if (visibleGroups.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-brand">{title}</h3>
      {visibleGroups.map((key) => (
        <div key={key} className="space-y-1.5">
          <h4 className="text-[11px] font-medium tracking-wide text-slate-500 dark:text-slate-400">
            {SUB_GROUP_LABEL[key]}
          </h4>
          <div className={compactGridClass} style={compactGridStyle}>
            {buckets[key].map((item) => {
              const defaultUnit = item.unit || '';
              const unit = getUnit(labData, item.category, item.itemName, defaultUnit);
              const value = getValue(labData, item.category, item.itemName);
              const refRange = getRefRange(labData, item.category, item.itemName);
              return (
                <LabItem
                  key={item.key}
                  labName={item.itemName}
                  label={item.label}
                  value={getItem(labData, item.category, item.itemName)}
                  unit={unit}
                  isAbnormal={isAbnormalFn(labData, item.category, item.itemName)}
                  abnormalDirection={getDirection(labData, item.category, item.itemName)}
                  onClick={() =>
                    onLabClick(item.itemName, String(item.category), value, unit, refRange)
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
