/**
 * Generic lab section renderer — Step 2 of the lab-display refactor
 * (see `docs/lab-display-refactor-plan.md`).
 *
 * Given a `RenderItem[]` produced by `groupLabData()`, renders a titled grid
 * of `<LabItem />` cards matching the existing layout of hand-written sections
 * (e.g. 血液學檢查) in `lab-data-display.tsx`.
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

export interface LabSectionProps {
  title: string;
  subtitle?: string;
  /**
   * `'optional'` = amber header color + every LabItem rendered with
   * `isOptional` (amber card styling). Mirrors the old "甲狀腺與荷爾蒙
   * （選擇性追蹤）" treatment. Default = `'default'`.
   */
  variant?: 'default' | 'optional';
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

export function LabSection({
  title,
  subtitle,
  variant = 'default',
  items,
  labData,
  onLabClick,
}: LabSectionProps): JSX.Element | null {
  if (items.length === 0) return null;

  const isOptionalSection = variant === 'optional';
  const headerColorClass = isOptionalSection ? 'text-[#f59e0b]' : 'text-brand';

  return (
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold tracking-wide ${headerColorClass}`}>
        {title}
        {subtitle && (
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
            {subtitle}
          </span>
        )}
      </h3>
      <div className={compactGridClass} style={compactGridStyle}>
        {items.map((item) => {
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
              isOptional={isOptionalSection ? true : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
