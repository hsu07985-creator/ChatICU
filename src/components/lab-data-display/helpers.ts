/**
 * Pure lookup helpers for the lab-data display.
 *
 * Extracted as Step 2 of the lab-display refactor (see
 * `docs/lab-display-refactor-plan.md`). Behavior must match the in-closure
 * helpers currently defined inside `lab-data-display.tsx` 1:1 — the difference
 * is that these functions take `labData` as their first argument instead of
 * closing over it.
 */

import { type LabData } from '../../lib/api';

// ---------------------------------------------------------------------------
// Low-level value coercion / introspection (copied verbatim from the
// module-level helpers in lab-data-display.tsx). These stay private to this
// module — only the higher-level wrappers below are consumed by new components.
// ---------------------------------------------------------------------------

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
  isAbnormalFlag: boolean,
): 'high' | 'low' | 'normal' {
  if (!isAbnormalFlag || value === undefined) return 'normal';
  if (!referenceRange) return 'high'; // 預設偏高

  const trimmed = referenceRange.trim();

  // "<5" / "≤5" 格式 → 超過上限 = high
  const ltMatch = trimmed.match(/^[<≤]\s*([\d.]+)/);
  if (ltMatch) {
    return value >= parseFloat(ltMatch[1]) ? 'high' : 'normal';
  }

  // ">60" / "≥60" 格式 → 低於下限 = low
  const gtMatch = trimmed.match(/^[>≥]\s*([\d.]+)/);
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

// ---------------------------------------------------------------------------
// Public lookup helpers (pure; accept labData as first arg)
// ---------------------------------------------------------------------------

/** Retrieve the raw LabItem payload for `labData[category][itemName]`. */
export function getItem(
  labData: LabData | null | undefined,
  category: keyof LabData,
  itemName: string,
): unknown {
  if (!labData || !category) return undefined;
  const cat = (labData as unknown as Record<string, unknown>)[category as string];
  if (!cat || typeof cat !== 'object') return undefined;
  return (cat as Record<string, unknown>)[itemName];
}

/** Extract the numeric value of a lab item (if finite). */
export function getValue(
  labData: LabData | null | undefined,
  category: keyof LabData,
  itemName: string,
): number | undefined {
  const item = getItem(labData, category, itemName);
  return toFiniteNumber(item);
}

/** Extract the unit string for a lab item, falling back to `defaultUnit`. */
export function getUnit(
  labData: LabData | null | undefined,
  category: keyof LabData,
  itemName: string,
  defaultUnit: string,
): string {
  const item = getItem(labData, category, itemName);
  return getUnitFromItem(item) || defaultUnit;
}

/** Whether the backend flagged this lab item as abnormal. */
export function isAbnormal(
  labData: LabData | null | undefined,
  category: keyof LabData,
  itemName: string,
): boolean {
  const item = getItem(labData, category, itemName);
  return getAbnormalFlag(item);
}

/** Direction of abnormality ('high' | 'low' | 'normal'). */
export function getDirection(
  labData: LabData | null | undefined,
  category: keyof LabData,
  itemName: string,
): 'high' | 'low' | 'normal' {
  const item = getItem(labData, category, itemName);
  const val = toFiniteNumber(item);
  const ref = getReferenceRange(item);
  const abnormal = getAbnormalFlag(item);
  return getAbnormalDirection(val, ref, abnormal);
}

/** Textual reference range as reported by the backend (e.g. "3.5-5.0"). */
export function getRefRange(
  labData: LabData | null | undefined,
  category: keyof LabData,
  itemName: string,
): string | undefined {
  const item = getItem(labData, category, itemName);
  return getReferenceRange(item);
}
